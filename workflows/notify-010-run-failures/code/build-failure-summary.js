// Record a failed run directly in Postgres.
//
// A failed run never reaches Record Run, so it used to leave no trace at all: n8n does not store
// successful executions here, failures were only in the editor's execution list, and mnemora_runs
// gained nothing. "Was the run successful?" was answerable only by the absence of a row.
//
// This writes the row DIRECTLY, not through the pipe. The first version posted to the pipe and
// recorded nothing the moment the pipe itself was down — which is exactly the failure it exists to
// report. A failure logger must not depend on the component that failed.
//
// The SQL is assembled here with single quotes doubled. The only free text is n8n's own error
// message; escaping it beats the alternative, because the Postgres node splits query parameters on
// commas and would corrupt any message containing one.
const payload = $input.first().json || {};
const execution = payload.execution || {};
const workflow = payload.workflow || {};
const errorInfo = execution.error || payload.error || {};

const rawMessage =
  (typeof errorInfo === 'string' ? errorInfo : errorInfo.message || errorInfo.description) ||
  'workflow failed without an error message';

const iso = (ms) => (ms ? new Date(Number(ms)).toISOString() : null);
const quote = (value) => {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
};

const runId =
  execution.id !== undefined && execution.id !== null ? String(execution.id) : `error-${Date.now()}`;

// Counts are deliberately absent, not zero: the run died before it knew them, and zero would read
// as "looked at nothing and found nothing", which is a different and misleading fact.
const note = `failed in node "${execution.lastNodeExecuted || 'unknown'}": ${String(rawMessage).slice(0, 400)}`;

// n8n says 'trigger' here, while the success path records the trigger node by name ('schedule').
// Mapping it keeps one value per origin across both paths — this workflow is only ever the error
// handler of a single-trigger collector, so 'trigger' means the schedule. If the collector ever
// gains a webhook, this has to distinguish them.
const triggerMode = execution.mode === 'trigger' ? 'schedule' : execution.mode || 'unknown';

const sql = `insert into mnemora_runs (
  run_id, workflow, started_at_utc, finished_at_utc, status, note, trigger_mode
) values (
  ${quote(runId)},
  ${quote(workflow.name || 'collect-010-github-public-cache')},
  ${quote(iso(execution.startedAt))},
  ${quote(new Date().toISOString())},
  'error',
  ${quote(note)},
  ${quote(triggerMode)}
)
on conflict (run_id) do update set
  status          = 'error',
  note            = excluded.note,
  finished_at_utc = excluded.finished_at_utc,
  trigger_mode    = excluded.trigger_mode;`;

return [{ json: { sql, run_id: runId, note, trigger_mode: triggerMode } }];
