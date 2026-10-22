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
//
// A refusal is NOT an error. Being told "another run is fetching right now" is the lease doing its
// job, so this node returns a normal item with run_lock='held' and the workflow records that tick as
// 'busy'. Throwing here used to turn correct behaviour into a red run and, because every retry
// refused again, into a burst of them.
const enabled = String($env.COLLECT_010_RUN_LOCK ?? 'true').toLowerCase();
if (['0', 'false', 'no', 'off'].includes(enabled)) {
  return [{ json: { run_lock: 'disabled' } }];
}

// biome-ignore lint/style/useNodejsImportProtocol: n8n's sandbox allowlist is the bare name `crypto`; `node:crypto` is not what NODE_FUNCTION_ALLOW_BUILTIN matches.
const crypto = require('crypto');
const ttl = Number($env.COLLECT_010_RUN_LOCK_TTL_SECONDS || 900);
const runId = $execution.id ? String($execution.id) : `run-${Date.now()}`;

// Signed, not token-bearing: persist verifies an HMAC over `ts.action.identity`, so a captured
// request is not a reusable credential. The shared secret stays in the container environment and
// never enters this node's output — which is what n8n persists for a failed execution.
const ts = Math.floor(Date.now() / 1000);
const signature = crypto
  .createHmac('sha256', $env.MNEMORA_PIPE_TOKEN || '')
  .update(`${ts}.acquire.${runId}`)
  .digest('hex');

const res = await this.helpers.httpRequest({
  method: 'POST',
  url: 'http://n8n:5678/webhook/mnemora-commits',
  body: { run_claim: { action: 'acquire', run_id: runId, workflow: 'collect-010', ttl_seconds: ttl } },
  headers: {
    'Content-Type': 'application/json',
    'X-Mnemora-Timestamp': String(ts),
    'X-Mnemora-Signature': signature,
  },
  json: true,
  timeout: 15000,
});

const first = $input.first().json ?? {};

if (!res || res.acquired !== true) {
  // Deliberately not fatal. The caller records who held it and when it expires, which is the whole
  // diagnosis: an expiry in the future means "wait", one in the past means persist or the clock is
  // wrong. run_lock_id is the *refused* run's own id, never the holder's.
  return [
    {
      json: {
        ...first,
        run_lock: 'held',
        run_lock_id: runId,
        lease_holder: res?.holder ?? 'unknown',
        lease_holder_expires_at_utc: res?.holder_expires_at_utc ?? null,
      },
    },
  ];
}

return [{ json: { ...first, run_lock: 'acquired', run_lock_id: runId, run_lock_ttl: ttl } }];
