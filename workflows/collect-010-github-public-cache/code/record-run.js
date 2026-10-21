// Record the run itself. Until now the only trace was collector-status.json, which every run
// overwrote, so yesterday's run left nothing behind in the product database.
//
// The counts come from two places and both are authoritative: the repository outcomes from the
// status item Collect produced, and the commit counts from what persist answered for each record.
// Nothing here is estimated.
const summaryItem = $('Collect').all().map((i) => i.json).find((j) => j.cache_file === 'collector-status.json') || {};
const rows = Array.isArray(summaryItem.repositories) ? summaryItem.repositories : [];
const mode = (m) => rows.filter((r) => r.collection === m).length;

let commitsSeen = 0, commitsNew = 0, commitsPruned = 0;
for (const item of $('Save to Pipe').all()) {
  const j = (item && item.json) || {};
  // Only repository responses carry these; the archive batch answers with its own shape.
  if (typeof j.commits_seen !== 'number') continue;
  commitsSeen += Number(j.commits_seen) || 0;
  commitsNew += Number(j.commits_new) || 0;
  commitsPruned += Number(j.commits_pruned) || 0;
}

const failed = rows.filter((r) => r.source_state === 'error' || r.source_state === 'stale').length;
const lock = $('Acquire Run Lock').first().json || {};
const plan = $('Build Plan').first().json || {};

const summary = {
  run_id: lock.run_lock_id || `adhoc-${Date.now()}`,
  workflow: 'collect-010',
  started_at_utc: plan.until || null,
  finished_at_utc: new Date().toISOString(),
  status: failed > 0 ? 'partial' : 'success',
  repositories_total: rows.length,
  repositories_fetched: mode('full'),
  repositories_skipped: mode('skipped'),
  repositories_pending: mode('pending'),
  repositories_failed: failed,
  repositories_archived: Array.isArray(summaryItem.archived_repository_ids) ? summaryItem.archived_repository_ids.length : 0,
  commits_seen: commitsSeen,
  commits_new: commitsNew,
  commits_pruned: commitsPruned,
  api_calls: Number(summaryItem.api_calls) || 0,
  // Which trigger actually fired. n8n's $execution.mode only says test vs production, which lumps
  // a schedule tick together with a CLI run — useless for "are my scheduled runs happening?".
  // Asking each trigger node whether it produced data answers it directly. Referencing an
  // unexecuted node throws, which is the signal.
  trigger_mode: (() => {
    const fired = (name) => {
      try { return !!($(name) && $(name).first() !== undefined); } catch (e) { return false; }
    };
    if (fired('Every Hour')) return 'schedule';
    if (fired('Manual Run')) return 'manual';
    return $execution.mode || 'unknown';
  })(),
  telemetry: Array.isArray(summaryItem.telemetry) ? summaryItem.telemetry : [],
  note: failed > 0 ? `${failed} repositories did not complete` : null,
};

try {
  await this.helpers.httpRequest({
    method: 'POST',
    url: 'http://n8n:5678/webhook/mnemora-commits',
    body: { run_summary: summary },
    headers: {
    'Content-Type': 'application/json',
    // A Code node cannot hold an n8n credential, so the pipe token comes from the environment.
    // Trade-off, stated plainly: any workflow in this instance can read env vars, so this token is
    // visible to all of them. The alternative was an unauthenticated write endpoint reachable by
    // anything that could open a socket to this machine.
    'X-Mnemora-Pipe-Token': $env.MNEMORA_PIPE_TOKEN || '',
  },
    json: true,
    timeout: 15000,
  });
  return [{ json: { ...($input.first().json || {}), run_recorded: true, run_id: summary.run_id } }];
} catch (e) {
  // A run that did its work but could not file its report should say so without failing the
  // storage that already happened. The lease is still released on the next node.
  return [{ json: { ...($input.first().json || {}), run_recorded: false, run_error: e.message } }];
}