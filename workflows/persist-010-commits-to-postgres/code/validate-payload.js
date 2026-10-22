// Accept three shapes so the same endpoint serves the collector and a human with curl:
//   { "repositories": [ record, ... ], "archived_repository_ids": [ ... ] }
//   [ record, ... ]
//   record
// A "record" is exactly what collect-010 writes to its cache file: repository_id, full_name,
// pushed_at_utc, commit_count, source_state, refreshed_at_utc and commits[].
const isRecord = (v) => v && typeof v === 'object' && !Array.isArray(v) && v.repository_id != null;

const first = $input.first().json ?? {};
const body = first.body !== undefined ? first.body : first;

let repos;
if (Array.isArray(body)) repos = body;
else if (Array.isArray(body.repositories)) repos = body.repositories;
else if (isRecord(body)) repos = [body];
else repos = [];


// A run-claim request asks for the single-run lease rather than carrying repository records.
// It is passed through as-is (base64) and handled by its own branch.
if (body?.run_claim && typeof body.run_claim === 'object') {
  const c = body.run_claim;
  if (!['acquire', 'release'].includes(String(c.action))) {
    throw new Error('persist: run_claim.action must be acquire or release');
  }
  if (!c.run_id) throw new Error('persist: run_claim.run_id is required');
  return [{ json: {
    is_run_claim: true,
    payload_b64: Buffer.from(JSON.stringify({ run_claim: c }), 'utf8').toString('base64'),
  }}];
}

// A run summary is the last thing a run sends: what it looked at and what the pipe reported
// back. Handled by its own branch, because it writes a different table.
if (body?.run_summary && typeof body.run_summary === 'object') {
  if (!body.run_summary.run_id) throw new Error('persist: run_summary.run_id is required');
  return [{ json: {
    is_run_summary: true,
    payload_b64: Buffer.from(JSON.stringify({ run_summary: body.run_summary }), 'utf8').toString('base64'),
  }}];
}

// Repositories that no longer appear in the owner's public listing. They are archived by the
// database, never deleted, so their commits stay as history.
let archived = [];
if (body && Array.isArray(body.archived_repository_ids)) {
  archived = body.archived_repository_ids
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
}

if (repos.length === 0 && archived.length === 0) {
  throw new Error('persist: payload contains no repository records and no archived ids');
}
for (const r of repos) {
  if (!isRecord(r)) throw new Error('persist: a record is missing repository_id');
  if (!r.full_name) throw new Error(`persist: repository ${r.repository_id} is missing full_name`);
  if (r.commits !== undefined && !Array.isArray(r.commits)) {
    throw new Error(`persist: ${r.full_name} has a non-array commits field`);
  }
  if (r.source_state && !['complete', 'partial', 'error', 'stale', 'empty', 'pending'].includes(r.source_state)) {
    throw new Error(`persist: ${r.full_name} has unknown source_state "${r.source_state}"`);
  }
}

// Base64 because n8n's Postgres node splits query parameters on commas, and commit
// messages are full of them. Base64 has no comma, so the payload crosses intact.
const payload = JSON.stringify({ repositories: repos, archived_repository_ids: archived });
const payload_b64 = Buffer.from(payload, 'utf8').toString('base64');

return [{
  json: {
    payload_b64,
    repository_count: repos.length,
    archived_count: archived.length,
    commit_count: repos.reduce((n, r) => n + (r.commits ? r.commits.length : 0), 0),
    payload_bytes: Buffer.byteLength(payload),
  },
}];
