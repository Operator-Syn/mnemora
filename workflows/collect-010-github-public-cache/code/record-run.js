// Record the run itself: one row in mnemora_runs, plus one telemetry row per repository.
//
// Two shapes arrive here, and the difference matters:
//   * the run fetched       — this node's input is Collect's output, so the counts come from the
//                             status item Collect produced and from what persist answered per record;
//   * the lease was held    — Collect never ran, so this node's input is Acquire Run Lock's output
//                             and the run is filed as 'busy' with null counters.
// The Collect read must therefore stay *inside* the branch that only runs when Collect ran:
// evaluating `$('Collect')` unconditionally throws on the busy path and turns a correct refusal into
// a failure again, which is the whole thing this change exists to stop.
const item = $input.first().json ?? {};
const lock = $('Acquire Run Lock').first().json || {};
const plan = $('Build Plan').first().json || {};
const busy = lock.run_lock === 'held';

// Which trigger actually fired. n8n's $execution.mode only says test vs production, which lumps
// a schedule tick together with a CLI run — useless for "are my scheduled runs happening?".
// Asking each trigger node whether it produced data answers it directly. Referencing an
// unexecuted node throws, which is the signal.
const triggerMode = (() => {
  const fired = (name) => {
    try {
      return !!($(name) && $(name).first() !== undefined);
    } catch (_e) {
      return false;
    }
  };
  if (fired('Every Hour')) return 'schedule';
  if (fired('Manual Run')) return 'manual';
  return $execution.mode || 'unknown';
})();

let summary;
if (busy) {
  // Contention, not failure. Null rather than zero: summing real runs must not count this tick's
  // repositories as "checked and found unchanged". The note is what makes it diagnosable later —
  // a future expiry means wait, a past one means the lease or the clock is wrong.
  summary = {
    run_id: lock.run_lock_id || item.run_lock_id || `adhoc-${Date.now()}`,
    workflow: 'collect-010',
    started_at_utc: plan.until || null,
    finished_at_utc: new Date().toISOString(),
    status: 'busy',
    repositories_total: null,
    repositories_fetched: null,
    repositories_skipped: null,
    repositories_pending: null,
    repositories_failed: null,
    repositories_archived: null,
    commits_seen: null,
    commits_new: null,
    commits_pruned: null,
    api_calls: null,
    trigger_mode: triggerMode,
    telemetry: [],
    note: `lease_held_by:${lock.lease_holder || 'unknown'} expires:${lock.lease_holder_expires_at_utc || 'unknown'}`,
  };
} else {
  const summaryItem =
    $('Collect')
      .all()
      .map((i) => i.json)
      .find((j) => j.cache_file === 'collector-status.json') || {};
  const rows = Array.isArray(summaryItem.repositories) ? summaryItem.repositories : [];
  const mode = (m) => rows.filter((r) => r.collection === m).length;

  // Collect posts each record as its repository finishes, so the answers live in its own memory
  // rather than in a downstream HTTP node's output. It sums them into pipe_totals for exactly this
  // purpose: still authoritative, still not an estimate.
  const totals = summaryItem.pipe_totals || {};
  const commitsSeen = Number(totals.commits_seen) || 0;
  const commitsNew = Number(totals.commits_new) || 0;
  const commitsPruned = Number(totals.commits_pruned) || 0;
  const failed = rows.filter((r) => r.source_state === 'error' || r.source_state === 'stale').length;

  summary = {
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
    repositories_archived: Array.isArray(summaryItem.archived_repository_ids)
      ? summaryItem.archived_repository_ids.length
      : 0,
    commits_seen: commitsSeen,
    commits_new: commitsNew,
    commits_pruned: commitsPruned,
    api_calls: Number(summaryItem.api_calls) || 0,
    trigger_mode: triggerMode,
    telemetry: Array.isArray(summaryItem.telemetry) ? summaryItem.telemetry : [],
    note: failed > 0 ? `${failed} repositories did not complete` : null,
  };
}

// Signed, not token-bearing: persist verifies an HMAC over `ts.action.identity`, so a captured run
// summary proves nothing later and the execution that stored it contains no secret.
// biome-ignore lint/style/useNodejsImportProtocol: n8n's sandbox allowlist is the bare name `crypto`; `node:crypto` is not what NODE_FUNCTION_ALLOW_BUILTIN matches.
const crypto = require('crypto');
const ts = Math.floor(Date.now() / 1000);
const signature = crypto
  .createHmac('sha256', $env.MNEMORA_PIPE_TOKEN || '')
  .update(`${ts}.summary.${summary.run_id}`)
  .digest('hex');

try {
  await this.helpers.httpRequest({
    method: 'POST',
    url: 'http://n8n:5678/webhook/mnemora-commits',
    body: { run_summary: summary },
    headers: {
      'Content-Type': 'application/json',
      'X-Mnemora-Timestamp': String(ts),
      'X-Mnemora-Signature': signature,
    },
    json: true,
    timeout: 15000,
  });
  return [{ json: { ...item, run_recorded: true, run_id: summary.run_id, run_status: summary.status } }];
} catch (e) {
  // A run that did its work but could not file its report should say so without failing the
  // storage that already happened. The lease is still released on the next node.
  return [{ json: { ...item, run_recorded: false, run_error: e.message } }];
}
