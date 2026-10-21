# collect-010-github-public-cache

Collects **every public repository** an account owns, with its **full commit history**, and
hands the records to `persist-010-commits-to-postgres`. The database is the product; a
dashboard reads it instead of talking to GitHub itself.

- **Schedule:** every 6 hours, plus on-demand via the `Manual Run` trigger.
- **Writes (product):** nothing directly. It POSTs records to the persist webhook, which owns
  every write to `mnemora`.
- **Reads (state):** `mnemora_repositories`, through a **read-only** role — what the database
  knows is what the run decides from. The cache files are no longer consulted.
- **Writes (export):** `/home/node/mnemora-data/public/github-public-cache__<owner>__<repo>.json`,
  one file per repository, rewritten only when that repository's data changed; plus
  `public/collector-status.json` every run. Derived: deleting these files changes nothing about
  what the next run does. They exist for `scripts/backfill.sh` and for inspection.
- **Contract:** `docs/architecture/github-data.md`.
- **Config:** this directory's `.env` (see `.env.example`), injected by compose.

## Prerequisites

| what | value | why |
|---|---|---|
| credential `Mnemora DB (read-only)` (type `postgres`) | database `mnemora`, user `mnemora_reader` | `Read State` decides what to fetch; the role can `SELECT` only and cannot reach n8n's database |
| published + active | yes | the six-hour schedule only fires from a published version |
| run lease | held by `persist-010` | a second concurrent run is refused instead of crawling twice |

This workflow reads **no** database secrets itself: the connection is an n8n credential. The
settings it does read from the environment are in `.env.example` beside this file.

## Nodes

`Manual Run` / `Every 6 Hours` → `Build Plan` → `Read State` → `Acquire Run Lock` → `Collect` → `Pipe Batches` → `Save to Pipe` → `Record Run` → `Release Run Lock`
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`Collect` → `To JSON File` → `Write Public Cache`

`Build Plan` reads configuration; `Collect` does the work in one pass. They are separate
so configuration failures are visible before any network call happens.

`Read State` asks Postgres what is already collected — `pushed_at_utc` per repository — using
the read-only credential. It replaced the two file-reading nodes: there is now one source of
truth for "what do we have", and it is the same one the dashboard reads.

`Collect` is one node rather than a chain of per-repository nodes on purpose: the earlier
version read `$('Node').first()` in several places, which silently processed only the
first repository and still reported `success`. A single pass over the discovered list
cannot drop an entry without also failing.

`Pipe Batches` splits database records from the export, passing skipped and failed records to
the pipeline only — they must reach the database without overwriting a good cache file.

`Acquire Run Lock` claims a lease in the product database before a single GitHub call, so a
scheduled tick landing on a manual run fails in seconds instead of crawling everything twice. The
lease is atomic (`INSERT ... ON CONFLICT DO UPDATE ... WHERE expired`), released when fetching
finishes, and expires on its own if a run dies. `COLLECT_010_RUN_LOCK=false` bypasses it.

`Save to Pipe` posts each record to `http://n8n:5678/webhook/mnemora-commits` (compose network,
not the host's 5680). If it fails after retries the run fails: collected data that was never
stored must not look like success.

## Re-runs are cheap — two collection modes

Every record says how it was produced, so a cheap run is visibly cheap:

| mode | when | cost |
|---|---|---|
| `skipped` | `pushed_at` in the database is unchanged, same branch, same history mode | **zero requests** for it |
| `full` | new repository, moved repository, or `COLLECT_010_FORCE_FULL_RESYNC=true` | the whole history |

A changed repository is re-fetched in full rather than merged: the commits live as rows now, and
prune-on-complete removes what vanished upstream. Incremental `since` is switched off in this
version so there is one reconciliation rule, not two.

Measured on 24 repositories / 6,993 commits:

| scenario | time | requests |
|---|---|---|
| cold start (empty database, empty cache) | 4 m 12 s | ~95, all 24 fetched |
| warm, nothing changed | **7 s** | 1 listing call, 24/24 `skipped` |

**Pruning is gated on completeness.** Only a `complete` record may delete rows, and a record with
`commits_omitted` may never. Skipped and partial records are how a run says "I did not fetch the
full list" — treating them as authoritative once deleted all 6,993 commits.

**History rewrites self-correct:** a repository re-fetched in full simply does not contain the
rewritten-away commits, so prune removes them. Explicit head-comparison is no longer needed.


## Run history

Every run writes one row to `mnemora_runs` — repositories fetched, skipped, deferred, failed and
archived, commits the pipe reported back, and API calls spent. The counting is not estimated: the
repository outcomes come from the run's own status item, and the commit numbers are summed from
what persist answered for each record.

This exists because the per-run `collector-status.json` was overwritten every time, so yesterday's
run left nothing behind. `Record Run` is non-fatal: a run that stored its data must not fail
because filing the report did.

```sql
-- what did the last few runs cost, and did they do anything?
select run_id, status, repositories_fetched, repositories_skipped,
       repositories_pending, commits_seen, api_calls, finished_at_utc
from mnemora_runs order by finished_at_utc desc limit 10;
```

## Cold start

A first run against an empty database has nothing to compare against, so every repository is a
full fetch. Left alone that is one burst — ~95 calls and four minutes for these 24 repositories,
more for an account with deeper history — and an interruption leaves no record of what is still
outstanding.

`COLLECT_010_MAX_NEW_PER_RUN` (default 12) bounds it. Repositories past the cap are written to the
database with `source_state = 'pending'` and no commit list, so:

- they exist as rows, which means the dashboard can distinguish *not collected yet* from *empty*;
- they are never pruned, because only `complete` records prune;
- the next run treats `pending` exactly like a new repository and continues.

A cold start of 24 repositories with a cap of 12 completes in two runs, and each run is safe to
interrupt.

## Rate limits

The cache reduces API calls **per repository**, not per commit inside one repository.

| what the run does | calls |
|---|---|
| one listing of the account's public repositories | 1 per 100 repos |
| a repository whose `pushed_at` is unchanged | **0** |
| a repository that changed | 1 (languages) + 1 per 100 new commits |
| a repository with no usable cache | 1 + 1 per 100 commits in its whole history |

Measured on 24 repositories / 6,993 commits: **~95 calls cold**, **1 call warm**. Against
5,000/hour authenticated that is comfortable; against 60/hour anonymous, even the listing
plus two calls is more than one run allows, which is why the token is required.

Two guards exist because a full run can still be expensive — a new account, a forced
resync, or a history that grew a lot since it was last collected:

- **Reserve (`COLLECT_010_RATE_RESERVE`, default 25).** Remaining quota is read from
  GitHub's response headers on every call. When it drops to the reserve, the run stops
  spending: repositories not reached are reported as `deferred`, and their cache files are
  left exactly as they were.
- **Never overwrite good data with a failure.** If a commit fetch fails for a repository
  that has a cached copy, the record is marked `stale` with the error recorded and the
  file is not rewritten. Before this, a transient failure would have replaced real history
  with an empty commit list.

What the cache deliberately does **not** do: it keeps no memory of individual commits
between runs, so an `incremental` fetch asks for "everything since the newest cached
commit" and relies on GitHub to return only newer pages. That is one request when nothing
changed and a page or two when a little did — the per-commit bookkeeping would cost more
complexity than it saves calls.


## Targeted writes

A run does **not** rewrite the whole cache. Only repositories whose data changed are handed
to the writer; a `skipped` repository's file keeps its bytes and its mtime.

The "last checked" signal lives in one small file instead:

```
public/collector-status.json     ~7.7 KB, rewritten every run
public/github-public-cache__<owner>__<repo>.json     only when that repository changed
```

Per repository the status entry carries `collection`, `refreshed_at_utc` (last **check**),
`data_changed_at_utc` (last **real change**), `commit_count`, `source_state` and
`source_error`. The data files keep `data_changed_at_utc` and are otherwise immutable
between changes.

Observed on a no-change run: the 24 data files retained their previous mtime while
`collector-status.json` was rewritten, in 6.6 s. After a single repository changed, exactly
one data file was rewritten and the status reported that repository as `incremental`.

## Files

| file | purpose |
|---|---|
| `workflow.json` | The workflow definition. Source of truth; edited here, imported into n8n. |
| `WALKTHROUGH.md` | End-to-end plain-language explanation of every step, plus a worked example and troubleshooting. |
| `.env.example` | Committed template for this workflow's settings. |
| `.env` | Local values. Gitignored. |

## Boundary

Discovery uses `/users/:owner/repos`, the **public** repository listing. That endpoint
does not return private repositories even when an authenticated token is present, so
private work is unreachable by construction rather than by a filter a later edit could
relax. A `visibility !== 'public'` check remains as defence in depth.

The scope is deliberate, chosen over an allowlist: a repository made public appears in
the cache within one run, with no config or code change.

## Honest states

Each record carries `source_state`, and none of the non-complete values is a failure of
the run:

| state | meaning |
|---|---|
| `complete` | every commit in the window was returned and nothing failed |
| `partial` | hit the 100-commit page cap, or one sub-request failed; `source_error` says which |
| `empty` | the repository has no commits (GitHub answers 409); a real state, not an error |
| `error` | commits could not be read at all |

`commit_count_definition` states that `commit_count` is commits returned by the API for
the period — not authored contributions. Bot authors and merges are included; a real
run on `Operator-Syn/arqen` returns `github-actions[bot]` as the newest author.

## Run it

```sh
./scripts/workflows.sh import
./scripts/workflows.sh run collect-010-github-public-cache
```

## History

`COLLECT_010_WINDOW_DAYS` decides how much of each repository is collected:

- `0` (default) — **full history**. No `since` is sent and commits are paginated to the
  end, so `period_start_utc` is the oldest commit actually returned, derived from the
  data rather than assumed from configuration.
- `N` — a rolling window of the last N days. Cheaper, and all a "recent activity"
  dashboard needs.

`COLLECT_010_MAX_COMMIT_PAGES` (default 50, i.e. 5,000 commits per repository) is a
runaway guard. Hitting it sets `source_state: partial` and names the cap in
`source_error`, rather than presenting a truncated history as complete.

Because full history is re-fetched every run rather than merged into the previous file,
there is no incremental-merge logic to get wrong, and a rewritten history on GitHub is
reflected instead of accumulating ghosts. The price is the API calls listed above.

## Cost per run

One repository-listing call per 100 repositories, then 2 per repository (languages,
plus commits paginated 100 at a time to the end of history).

Measured with full history on 24 public repositories: **6,993 commits, ~95 API calls,
2 m 36 s, 2.70 MiB cached**, and the largest single file 1.13 MiB
(`operator-synaciel`, 2,889 commits). All 24 records came back `complete` — nothing
hit the page cap.

Two costs scale with history that did not scale with a window:

- **API calls** grow with total commits, not repository count. ~70 of the 95 calls are
  commit pages.
- **Database growth**, if execution data is kept. See `EXECUTIONS_DATA_SAVE_ON_SUCCESS`
  in the compose file: successful runs store no node data, because the output already
  lives on the cache volume.

Unauthenticated GitHub allows 60 requests/hour, which one run exceeds by itself. The
token is required, not optional.

## Authentication (optional)

The workflow reads `COLLECT_010_GITHUB_TOKEN` and, only if it is non-empty, sends
`Authorization: Bearer <token>`. Empty means anonymous — no header at all.

GitHub allows **60 requests/hour anonymously and 5,000/hour with any valid token**
(measured, not assumed). Authentication changes the quota, not the semantics: this is
still public data, and discovery still cannot see private repositories.

**Use the narrowest token that works.** A classic token with **no scopes** reads public
data and raises the quota. A token carrying `repo` also grants access to your private
repositories — do not put one here.

To verify the header is really sent, put a deliberately invalid token in `.env` and run:
GitHub must answer `401 Bad credentials`. A successful run with an invalid token means
the header is being dropped and the run is silently anonymous.


