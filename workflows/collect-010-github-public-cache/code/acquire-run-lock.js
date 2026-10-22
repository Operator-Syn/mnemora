// Claim the single-run lease before spending a single GitHub request.
//
// A schedule tick landing on top of a manual run would fetch the same 24 repositories twice.
// Writes stay correct either way — everything is keyed by sha and idempotent — but the calls
// are wasted, and on a bad day that is the difference between a run that finishes and one that
// hits the quota reserve halfway.
//
// The claim is held by persist (the only writer to the database); this node asks for it over the
// pipe and stays read-only itself. TTL bounds a crashed run: the lease expires rather than
// blocking forever.
const enabled = String($env.COLLECT_010_RUN_LOCK ?? 'true').toLowerCase();
if (['0', 'false', 'no', 'off'].includes(enabled)) {
  return [{ json: { run_lock: 'disabled' } }];
}

const ttl = Number($env.COLLECT_010_RUN_LOCK_TTL_SECONDS || 900);
const runId = $execution.id ? String($execution.id) : `run-${Date.now()}`;

const res = await this.helpers.httpRequest({
  method: 'POST',
  url: 'http://n8n:5678/webhook/mnemora-commits',
  body: { run_claim: { action: 'acquire', run_id: runId, workflow: 'collect-010', ttl_seconds: ttl } },
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

if (!res || res.acquired !== true) {
  const holder = res?.holder ? res.holder : 'unknown';
  const expires = res?.holder_expires_at_utc ? res.holder_expires_at_utc : 'unknown';
  throw new Error(
    `collector: another run holds the lease (run ${holder}, expires ${expires}). ` +
      `Refusing to duplicate the crawl. Clear it with: ` +
      `delete from mnemora_run_lock where lock_name = 'collector';`,
  );
}

const first = $input.first().json ?? {};
return [{ json: { ...first, run_lock: 'acquired', run_lock_id: runId, run_lock_ttl: ttl } }];
