// Discovers every public repository of each configured owner and brings the cache up
// to date, touching only what actually changed.
//
// Three collection modes per repository, cheapest first:
//   skipped      - pushed_at is unchanged since the cached copy, so nothing is fetched
//   incremental  - new commits only, via `since`, merged into the cached history
//   full         - the whole history, for a repository with no usable cache
//
// A repository whose history was rewritten (force-push) fails the incremental check and
// falls back to a full resync, so ghosts cannot accumulate.
const cfg = $('Build Plan').first().json;
const STATUS_FILE = 'collector-status.json';
const API = 'https://api.github.com';
const httpGet = this.helpers.httpRequest.bind(this.helpers);

// --- secrets ---------------------------------------------------------------------------------
// Both secrets are read here, at request time, and never travel in a node's output. The Build Plan
// node deliberately does not carry them: n8n persists failed executions, and an Authorization
// header sitting in an item is a token sitting in the execution table.
// biome-ignore lint/style/useNodejsImportProtocol: n8n's sandbox allowlist is the bare name `crypto`; `node:crypto` is not what NODE_FUNCTION_ALLOW_BUILTIN matches.
const crypto = require('crypto');
const pipeToken = typeof $env !== 'undefined' ? $env.MNEMORA_PIPE_TOKEN || '' : '';
const ghToken = typeof $env !== 'undefined' ? $env.COLLECT_010_GITHUB_TOKEN || '' : '';
const ghHeaders = { Accept: 'application/vnd.github+json', 'User-Agent': 'mnemora-collector' };
if (ghToken) ghHeaders.Authorization = `Bearer ${ghToken}`;

// The write pipe is authenticated by a signature, not by a reusable token: the request carries a
// timestamp and an HMAC over `ts.action.identity`, and persist verifies it. A captured request
// therefore proves nothing an hour later, and the stored execution contains no secret at all.
function pipeAuth(action, identity) {
  const ts = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', pipeToken)
    .update(`${ts}.${action}.${identity}`)
    .digest('hex');
  return {
    'Content-Type': 'application/json',
    'X-Mnemora-Timestamp': String(ts),
    'X-Mnemora-Signature': signature,
  };
}

// Tracks GitHub's remaining quota from response headers so the run can stop early
// instead of burning the last calls and then failing on every remaining repository.
let budget = null;
// Counted so the run can report what it cost. Headers tell us what remains; this tells us what
// we spent, which is the number a monthly budget question actually asks for.
let apiCalls = 0;
async function get(url, qs) {
  apiCalls++;
  let res;
  try {
    res = await httpGet({
      url,
      qs,
      headers: ghHeaders,
      json: true,
      timeout: 30000,
      returnFullResponse: true,
    });
  } catch (e) {
    // Rethrow a string, not the error object: an n8n/axios error carries `config.headers`, which is
    // exactly the secret we just stopped putting in items. The status and path are enough to debug.
    const status = e?.statusCode || e?.httpCode;
    const detail = status ? String(status) : String(e?.message || e);
    throw new Error(`collect-010: GET ${url} failed: ${detail}`);
  }
  const h = res.headers || {};
  const raw = h['x-ratelimit-remaining'] !== undefined ? h['x-ratelimit-remaining'] : h['X-RateLimit-Remaining'];
  if (raw !== undefined && raw !== null && !Number.isNaN(Number(raw))) budget = Number(raw);
  return res.body;
}

// --- the pipe ------------------------------------------------------------------------------
// Each record is posted the moment its repository finishes, not queued for a later node. The
// reason is a failure mode: if this node is killed by the task timeout halfway through a run,
// everything still sitting in its output is lost — including the cursors of repositories that were
// fully fetched. Posting inside the loop bounds that loss to the repository in flight, because the
// database is already current for every repository before it.
//
// Retries mirror what the HTTP node used to provide: three attempts, two seconds apart. A record
// that still cannot be persisted throws, failing the run loudly rather than looking successful.
const PIPE_URL = 'http://n8n:5678/webhook/mnemora-commits';
const pipeResults = [];
async function pipe(payload, label) {
  let lastError = null;
  // n8n's webhook body is re-parsed by persist, so the signature binds the payload's *shape and
  // identity*, not its bytes: a single record signs as `record`, a batch or archive list as `batch`.
  // Body tampering is not the threat model here — credential reuse is.
  const single = payload && typeof payload === 'object' && !Array.isArray(payload) && payload.repository_id != null;
  const action = payload && Array.isArray(payload.archived_repository_ids) ? 'archive' : 'records';
  const identity = single ? 'record' : 'batch';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await this.helpers.httpRequest({
        method: 'POST',
        url: PIPE_URL,
        body: payload,
        headers: pipeAuth(action, identity),
        json: true,
        timeout: 30000,
      });
      pipeResults.push({ label, response: res || {} });
      return res || {};
    } catch (e) {
      lastError = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`pipe: ${label} failed after 3 attempts: ${lastError?.message}`);
}

// --- previous state, read from the database by the node before this one ------------
// The database is the source of truth for "what do we already have". The cache files are an
// export, not an input: moving or deleting them changes nothing about what this run decides.
// A row's pushed_at_utc answers "did this move since we last looked", which is the whole
// question the files used to answer.
const existing = {};
const known = [];
for (const item of $('Read State').all()) {
  const row = item.json || {};
  if (row.repository_id === undefined || row.repository_id === null || row.repository_id === '') continue;
  known.push(row);
  existing[String(row.full_name || '').toLowerCase()] = row;
}

// --- discovery ----------------------------------------------------------------
const repos = [];
// Every id the listing returned, including forks and archived repositories that the filters
// below drop. Archive detection compares against this, not against `repos`, or a filtered-out
// fork would look like a repository that vanished upstream.
const listedIds = new Set();
for (const owner of cfg.owners) {
  for (let page = 1; page <= 20; page++) {
    const batch = await get(`${API}/users/${owner}/repos`, { per_page: 100, page, sort: 'full_name' });
    const list = Array.isArray(batch) ? batch : [];
    for (const repo of list) {
      if (repo.id) listedIds.add(repo.id);
      if (repo.visibility !== 'public') continue;
      if (repo.fork && !cfg.includeForks) continue;
      if (repo.archived && !cfg.includeArchived) continue;
      repos.push(repo);
    }
    if (list.length < 100) break;
  }
}

// --- per repository -----------------------------------------------------------
const out = [];
// Records that must reach the database but must not touch the cache export: skipped
// repositories (no commit list) and failed fetches (would replace good data with nothing).
// Kept separate so the export branch's item order stays 1:1 with the files it writes.
const status = [];
// A repository with no row, or a row still marked pending, is a cold-start fetch: it has never
// been collected. These are the expensive ones, so a run takes only so many.
let coldFetched = 0;
const coldCap = Number(cfg.maxNewPerRun) > 0 ? Number(cfg.maxNewPerRun) : Infinity;

// Spend of the run-wide page budget (not per repository); shared across the loop below.
let pagesSpentTotal = 0;
let anchorRestarts = 0;

for (const repo of repos) {
  const fullName = repo.full_name;
  const cacheFile = `github-public-cache__${String(fullName).toLowerCase().replace('/', '__')}.json`;
  const prev = existing[String(fullName).toLowerCase()] || null;
  const nowIso = new Date().toISOString();
  // Per-repository stopwatch. Without it a slow run is indistinguishable from a big one.
  const repoStartedAt = Date.now();
  const isColdStart = !prev || prev.source_state === 'pending';

  // Cold-start budget reached: record it as pending so the database knows the repository exists
  // and is owed a collection, and so the dashboard can tell "not yet collected" from "empty".
  // Nothing is fetched, nothing is pruned, and the next run picks it up.
  if (isColdStart && coldFetched >= coldCap) {
    await pipe({
      repository_id: repo.id, full_name: fullName, visibility: repo.visibility,
      default_branch: repo.default_branch, description: repo.description || null,
      is_fork: !!repo.fork, is_archived: !!repo.archived, html_url: repo.html_url,
      pushed_at_utc: repo.pushed_at, languages_bytes: (prev?.languages_bytes) || {},
      history: cfg.history, commit_count: 0, collection: 'pending',
      source_state: 'pending',
      source_error: 'pending: cold-start budget reached, not yet collected',
      refreshed_at_utc: nowIso, commits_omitted: true, cache_file: cacheFile,
    }, `${fullName} (pending)`);
    status.push({
      cache_file: cacheFile, full_name: fullName, collection: 'pending',
      refreshed_at_utc: nowIso, data_changed_at_utc: null, commit_count: 0,
      source_state: 'pending', source_error: 'cold-start budget reached',
      ms: Date.now() - repoStartedAt,
    });
    continue;
  }
  if (isColdStart) coldFetched++;

  // 0. Out of quota: stop spending, keep whatever is already cached.
  if (budget !== null && budget <= cfg.rateReserve) {
    status.push({
      cache_file: cacheFile,
      full_name: fullName,
      collection: 'deferred',
      refreshed_at_utc: nowIso,
      data_changed_at_utc: prev ? prev.data_changed_at_utc || prev.refreshed_at_utc : null,
      commit_count: prev ? prev.commit_count : 0,
      source_state: prev ? prev.source_state : 'error',
      source_error: 'deferred: rate-limit reserve reached, cache left untouched',
      ms: Date.now() - repoStartedAt,
    });
    continue;
  }

  // Compare instants, not strings: Postgres renders timestamptz as `2026-10-18 01:09:49+00`
  // while GitHub sends `2026-10-18T01:09:49Z`. String comparison never matches, which quietly
  // turned every "skipped" into a full refetch — 24 repositories and ~95 API calls per run.
  const sameInstant = (a, b) => {
    if (a === null || a === undefined || b === null || b === undefined) return !a && !b;
    const ta = new Date(a).getTime();
    const tb = new Date(b).getTime();
    if (Number.isNaN(ta) || Number.isNaN(tb)) return String(a) === String(b);
    return ta === tb;
  };
  const reuse = () =>
    prev &&
    Number(prev.repository_id) === repo.id &&
    prev.history === cfg.history &&
    prev.default_branch === repo.default_branch &&
    sameInstant(prev.pushed_at_utc, repo.pushed_at) &&
    !cfg.forceFull;

  // 1. Unchanged since the database was last refreshed: fetch nothing at all.
  if (reuse() && !prev.source_error) {
    // The record still goes to the pipeline, so refreshed_at_utc advances and the dashboard
    // can show "checked 2 minutes ago" honestly. Two flags keep that safe and non-destructive:
    //   commits_omitted    - the database must not prune rows for a list we never sent
    //   skip_cache_write   - the cache export must not be replaced with a hollow record
    let prevLanguages = prev.languages_bytes || {};
    if (typeof prevLanguages === 'string') {
      try { prevLanguages = JSON.parse(prevLanguages); } catch (_e) { prevLanguages = {}; }
    }
    await pipe({
      repository_id: repo.id,
      full_name: fullName,
      visibility: repo.visibility,
      default_branch: repo.default_branch,
      description: repo.description || null,
      is_fork: !!repo.fork,
      is_archived: !!repo.archived,
      html_url: repo.html_url,
      pushed_at_utc: repo.pushed_at,
      languages_bytes: prevLanguages,
      history: cfg.history,
      commit_count: Number(prev.commit_count) || 0,
      collection: 'skipped',
      source_state: prev.source_state || 'complete',
      source_error: prev.source_error || null,
      refreshed_at_utc: nowIso,
      commits_omitted: true,
      skip_cache_write: true,
      cache_file: cacheFile,
    }, `${fullName} (skipped)`);
    status.push({
      cache_file: cacheFile,
      full_name: fullName,
      collection: 'skipped',
      refreshed_at_utc: nowIso,
      data_changed_at_utc: prev.data_changed_at_utc || prev.refreshed_at_utc,
      commit_count: Number(prev.commit_count) || 0,
      source_state: prev.source_state,
      source_error: prev.source_error || null,
      ms: Date.now() - repoStartedAt,
    });
    continue;
  }

  // The run's page budget is spent: leave this repository untouched and let the next run take it.
  // Placed after the skip branch on purpose — an unchanged repository still costs nothing and must
  // still be reported as skipped, budget or no budget.
  if (pagesSpentTotal >= cfg.maxPagesPerRun) {
    status.push({
      cache_file: cacheFile,
      full_name: fullName,
      collection: 'deferred',
      refreshed_at_utc: nowIso,
      data_changed_at_utc: prev ? prev.data_changed_at_utc || prev.refreshed_at_utc : null,
      commit_count: prev ? prev.commit_count : 0,
      source_state: prev ? prev.source_state : 'pending',
      source_error: 'deferred: run page budget spent, cache left untouched',
      ms: Date.now() - repoStartedAt,
    });
    continue;
  }

  let languages = (prev?.languages_bytes) || {};
  let commits = [];
  let state = 'complete';
  let error = null;
  let pages = 0;
  let mode = 'full';
  let preserved = false;

  // A crawl that stopped at the page budget leaves a cursor behind. The next run continues from
  // it instead of re-reading pages it already has — without this, a repository larger than the
  // budget could never finish: every run read pages 1..N, stopped at N, and marked itself partial
  // forever. The crawl id groups the runs of one crawl, so pruning can tell "seen earlier in this
  // crawl" from "not seen at all".
  const openCrawl = !!(prev?.commit_crawl_id && Number(prev.commit_page_cursor) > 0);
  let crawlId = openCrawl ? prev.commit_crawl_id : `${$execution.id || 'run'}-${repo.id}`;
  let crawlStartedAt = openCrawl && prev.commit_crawl_started_at_utc
    ? prev.commit_crawl_started_at_utc
    : nowIso;
  let startPage = openCrawl ? Number(prev.commit_page_cursor) + 1 : 1;
  let lastPage = openCrawl ? Number(prev.commit_page_cursor) : 0;
  // Oldest commit confirmed by this crawl. It is the anchor the next run verifies before trusting
  // a page number: positions in a commit list are not stable, shas are.
  let boundarySha = openCrawl ? prev.commit_boundary_sha || null : null;
  let anchorCheck = openCrawl ? 'unchecked' : 'new-crawl';
  let reachedEnd = false;
  let pagesThisRun = 0;

  try {
    // Trust the cursor only if the commit it stopped at is still where the list says it is.
    //
    // Pages are positions, so a force-push that shortens history moves every commit above our
    // anchor up by the number of commits removed — and resuming at cursor + 1 would step over
    // commits we never fetched. Reading the cursor page and looking for the anchor costs one call
    // and catches that. It does NOT restart when commits are merely added at the top: those push
    // the anchor down, re-covering a few already-seen commits (deduped by sha) but never skipping.
    if (openCrawl && prev.commit_boundary_sha) {
      const anchorPage = await get(`${API}/repos/${fullName}/commits`, {
        per_page: 100,
        page: Number(prev.commit_page_cursor),
        ...(cfg.since ? { since: cfg.since } : {}),
      });
      const list = Array.isArray(anchorPage) ? anchorPage : [];
      if (list.some((c) => c?.sha === prev.commit_boundary_sha)) {
        anchorCheck = 'anchor-holds';
      } else {
        anchorCheck = 'anchor-lost-restarted';
        // Start over rather than skip: a new crawl id means the rows this crawl confirms will be
        // the ones the eventual prune keeps.
        crawlId = `${$execution.id || 'run'}-${repo.id}-r${Date.now()}`;
        crawlStartedAt = nowIso;
        startPage = 1;
        lastPage = 0;
        boundarySha = null;
      }
    }

    languages = (await get(`${API}/repos/${fullName}/languages`)) || languages;
  } catch (e) {
    state = 'partial';
    error = `languages: ${e.message}`;
  }

  // Incremental is only valid when the previous copy covers the same history mode.
  // D2 (operator decision): a changed repository is re-collected in full. Merging is no
  // longer this node's job — the commits live as rows in the database, and prune-on-complete
  // keeps that list honest after a history rewrite. Incremental `since` returns when the
  // call budget justifies the extra reconciliation rule, not before.
  const canIncrement = false;

  try {
    if (canIncrement) {
      mode = 'incremental';
      // Overlap by an hour: author date and committer date can disagree, and a push
      // can land commits slightly out of order. Duplicates are removed by sha below.
      const newest = prev.commits.map((c) => c.committed_at_utc).filter(Boolean).sort().pop();
      const since = new Date(new Date(newest).getTime() - 3600 * 1000).toISOString();
      const fetched = [];
      for (let page = 1; page <= cfg.maxCommitPages; page++) {
        const raw = await get(`${API}/repos/${fullName}/commits`, { per_page: 100, page, since });
        const list = Array.isArray(raw) ? raw : [];
        pages = page;
        fetched.push(...list.filter((c) => c?.sha));
        if (list.length < 100) break;
      }
      // Rewrite detection: the cached head must still exist upstream. If it does not,
      // history was rewritten and a merge would keep commits GitHub no longer has.
      const cachedHead = prev.commits[0]?.sha;
      const stillPresent = !cachedHead || fetched.some((c) => c.sha === cachedHead);
      if (!stillPresent) {
        mode = 'full';
        state = 'partial';
        error = 'history rewritten upstream; re-collected in full';
        commits = [];
      } else {
        commits = fetched;
      }
    }

    if (mode === 'full') {
      // Absolute page numbers, budget counted per run: page 51 is allowed on a later run even
      // though the budget is 50. A short page means we reached the oldest commit.
      for (let page = startPage; ; page++) {
        if (pagesThisRun >= cfg.maxCommitPages) {
          state = 'partial';
          error =
            `commits: per-repository page budget of ${cfg.maxCommitPages} spent at page ${lastPage}; ` +
            `resumes from page ${lastPage + 1} next run`;
          break;
        }
        // A run-wide ceiling, so one run cannot spend all its time on whichever repositories
        // happen to be large. Whatever is left is persisted with a cursor and picked up next run.
        if (pagesSpentTotal >= cfg.maxPagesPerRun) {
          state = 'partial';
          error =
            `commits: run page budget of ${cfg.maxPagesPerRun} spent at page ${lastPage}; ` +
            `resumes from page ${lastPage + 1} next run`;
          break;
        }
        const qs = { per_page: 100, page };
        if (cfg.since) qs.since = cfg.since;
        const raw = await get(`${API}/repos/${fullName}/commits`, qs);
        const list = Array.isArray(raw) ? raw : [];
        pagesThisRun++;
        pagesSpentTotal++;
        pages = page;
        lastPage = page;
        commits.push(...list.filter((c) => c?.sha));
        if (list.length < 100) {
          reachedEnd = true;
          break;
        }
      }
    }
  } catch (e) {
    const empty = /empty/i.test(String(e.message || ''));
    state = empty ? 'empty' : 'error';
    error = `commits: ${e.message}`;
    commits = [];
    // Preserve last-known-good: a failed fetch must never replace real history with
    // an empty list. The record is marked stale and the file is left on disk as-is.
    if (prev && Array.isArray(prev.commits) && prev.commits.length) {
      preserved = true;
      state = 'stale';
    }
  }

  const shape = (c) => ({
    sha: c.sha,
    html_url: c.html_url,
    message: (c.commit?.message ? c.commit.message : '').split('\n')[0],
    author: {
      login: c.author ? c.author.login : null,
      name: c.commit?.author ? c.commit.author.name : null,
      email: c.commit?.author ? c.commit.author.email : null,
    },
    authored_at_utc: c.commit?.author ? c.commit.author.date : null,
    committed_at_utc: c.commit?.committer ? c.commit.committer.date : null,
  });

  // Merge: incremental results join the cached history, deduped by sha, newest first.
  let detail;
  if (mode === 'incremental' && prev && !error) {
    const bySha = new Map();
    for (const c of prev.commits) bySha.set(c.sha, c);
    for (const c of commits) bySha.set(c.sha, shape(c));
    detail = [...bySha.values()].sort((a, b) =>
      String(b.committed_at_utc || '').localeCompare(String(a.committed_at_utc || '')),
    );
  } else {
    detail = commits.map(shape);
  }

  const authored = detail.map((c) => c.authored_at_utc).filter(Boolean).sort();
  const periodStart = authored.length ? authored[0] : (prev?.period_start_utc) || cfg.since;

  if (preserved) {
    status.push({
      cache_file: cacheFile,
      full_name: fullName,
      collection: 'stale',
      refreshed_at_utc: nowIso,
      data_changed_at_utc: prev.data_changed_at_utc || prev.refreshed_at_utc,
      commit_count: prev.commit_count,
      source_state: state,
      source_error: error,
      ms: Date.now() - repoStartedAt,
    });
    continue;
  }

  // 'complete' now means "this crawl reached the oldest commit", not "this run stopped".
  // A crawl that ends without either a short page or the oldest page is not complete, whatever
  // the earlier state said.
  const crawlComplete = state === 'complete' && reachedEnd;
  if (state === 'complete' && !crawlComplete) {
    state = 'partial';
    error = error || `commits: crawl stopped at page ${lastPage} without reaching the end`;
  }

  // The total is only knowable when a crawl finishes: rows this crawl already confirmed in earlier
  // runs, plus what this run fetched. Counting every stored row instead would double-count commits
  // that already existed from a previous crawl, since they are upserted rather than added again.
  // On a fresh crawl crawl_rows is 0, so this run's pages are the whole history. A partial run
  // reports the count the database already holds, so the number never dips to "the pages I read
  // this hour".
  // The oldest commit this run saw is the oldest the crawl has confirmed so far, because pages are
  // walked newest to oldest.
  if (commits.length) boundarySha = commits[commits.length - 1].sha;

  const commitTotal = crawlComplete
    ? commits.length + Number((prev?.crawl_rows) || 0)
    : Number((prev?.commit_count) || 0);

  const record = {
      repository_id: repo.id,
      full_name: fullName,
      visibility: repo.visibility,
      default_branch: repo.default_branch,
      description: repo.description || null,
      is_fork: !!repo.fork,
      is_archived: !!repo.archived,
      html_url: repo.html_url,
      pushed_at_utc: repo.pushed_at,
      languages_bytes: languages,
      history: cfg.history,
      period_start_utc: periodStart,
      period_end_utc: cfg.until,
      // Which crawl these commits belong to, whether it finished, and where to resume.
      commit_crawl_id: crawlId,
      commit_crawl_complete: crawlComplete,
      commit_page_cursor: crawlComplete ? 0 : lastPage,
      commit_boundary_sha: crawlComplete ? null : boundarySha,
      commit_anchor_check: anchorCheck,
      commit_crawl_started_at_utc: crawlStartedAt,
      commit_page_started_at: startPage,
      commit_pages_fetched: pages,
      commit_count: commitTotal,
      commit_count_definition:
        'Commits returned by the GitHub REST commits endpoint for the default branch, newest first; not an authored-contribution count.',
      collection: mode,
      source_state: state,
      source_error: error,
      refreshed_at_utc: nowIso,
      data_changed_at_utc: nowIso,
      cache_file: cacheFile,
    commits: detail,
  };

  // Persisted here, the moment this repository is done — see the pipe helper for why.
  await pipe(record, fullName);

  // Failed or stale records are persisted but never exported: a hollow record must not replace the
  // cache file that still holds the repository's last good history.
  if (state !== 'error' && state !== 'stale') out.push({ json: record });

  if (anchorCheck === 'anchor-lost-restarted') anchorRestarts++;

  status.push({
    cache_file: cacheFile,
    full_name: fullName,
    anchor_check: anchorCheck,
    collection: mode,
    refreshed_at_utc: nowIso,
    data_changed_at_utc: nowIso,
    commit_count: detail.length,
    source_state: state,
    source_error: error,
    commit_pages: pages,
    ms: Date.now() - repoStartedAt,
  });
}

// --- archived repositories ----------------------------------------------------
// Rows we know about, under an owner we just listed, that the listing no longer contains.
// They are archived by the database, never deleted, so their commits survive as history
// (decision D3). Only live rows are sent: re-archiving an archived row is a no-op anyway.
const ownerPrefixes = cfg.owners.map((o) => `${String(o).toLowerCase()}/`);
const archivedIds = known
  .filter((row) => !row.archived_at_utc)
  .filter((row) => ownerPrefixes.some((prefix) => String(row.full_name || '').toLowerCase().startsWith(prefix)))
  .filter((row) => !listedIds.has(Number(row.repository_id)))
  .map((row) => Number(row.repository_id));

// The archive list is the last thing that needs the pipe: repositories under this owner that the
// listing no longer contains. Posted here rather than downstream for the same reason as records.
if (archivedIds.length) {
  await pipe({ archived_repository_ids: archivedIds }, 'archive batch');
}

// Sum what persist answered, so the run summary does not have to re-read node outputs that now
// live in this node's memory rather than in a downstream HTTP node.
const pipeTotals = pipeResults.reduce(
  (acc, r) => {
    const x = r.response || {};
    // Only repository responses carry these; lease and summary responses have their own shape.
    if (typeof x.commits_seen !== 'number') return acc;
    acc.commits_seen += Number(x.commits_seen) || 0;
    acc.commits_new += Number(x.commits_new) || 0;
    acc.commits_pruned += Number(x.commits_pruned) || 0;
    acc.repositories += Number(x.repositories) || 0;
    acc.repositories_archived += Number(x.repositories_archived) || 0;
    return acc;
  },
  { commits_seen: 0, commits_new: 0, commits_pruned: 0, repositories: 0, repositories_archived: 0 },
);

// One small file per run: which repositories were checked and when. Written every run so
// the "last checked" signal survives without rewriting multi-hundred-kilobyte payloads.
out.push({
  json: {
    generated_at_utc: new Date().toISOString(),
    owners: cfg.owners,
    history: cfg.history,
    repository_count: status.length,
    repositories: status.sort((a, b) => a.cache_file.localeCompare(b.cache_file)),
    archived_repository_ids: archivedIds,
    api_calls: apiCalls,
    // How the run spent its page budget, and whether any resume anchor was lost to a rewritten
    // history (which restarts that crawl from page 1 rather than skipping commits).
    pages_spent: pagesSpentTotal,
    page_budget: cfg.maxPagesPerRun,
    anchor_restarts: anchorRestarts,
    pipe_totals: pipeTotals,
    // Per-repository outcome, for debugging a run after it is over. Successful executions are not
    // stored by n8n here, so if this is not recorded the detail is gone the moment the run ends.
    telemetry: status.map((s) => ({
      full_name: s.full_name,
      mode: s.collection,
      state: s.source_state,
      pages: s.commit_pages === undefined ? null : s.commit_pages,
      commits: s.commit_count === undefined ? null : s.commit_count,
      ms: s.ms === undefined ? null : s.ms,
      error: s.source_error === undefined ? null : s.source_error,
    })),
    cache_file: STATUS_FILE,
  },
});

return out;
