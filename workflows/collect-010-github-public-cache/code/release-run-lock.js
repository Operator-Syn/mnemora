// Hand the lease back as soon as the fetching is done, so the next manual run is not blocked
// for the rest of the TTL. Deliberately non-fatal: failing to release must not fail a run that
// already stored its data — the TTL reclaims the lease anyway.
//
// This node must never release a lease it does not hold. The early return below is structural, not
// defensive: a run that was refused the lease arrives here on the busy path, and a release request
// from it would hand the *holder's* lease away mid-crawl.
const upstream = $input.first().json ?? {};
const acquired = $('Acquire Run Lock').first().json;
if (!acquired || acquired.run_lock !== 'acquired') {
  return [{ json: { ...upstream, run_lock_released: false, reason: 'not held' } }];
}

// biome-ignore lint/style/useNodejsImportProtocol: n8n's sandbox allowlist is the bare name `crypto`; `node:crypto` is not what NODE_FUNCTION_ALLOW_BUILTIN matches.
const crypto = require('crypto');
const runId = String(acquired.run_lock_id);
const ts = Math.floor(Date.now() / 1000);
const signature = crypto
  .createHmac('sha256', $env.MNEMORA_PIPE_TOKEN || '')
  .update(`${ts}.release.${runId}`)
  .digest('hex');

try {
  const res = await this.helpers.httpRequest({
    method: 'POST',
    url: 'http://n8n:5678/webhook/mnemora-commits',
    body: { run_claim: { action: 'release', run_id: runId } },
    headers: {
      'Content-Type': 'application/json',
      'X-Mnemora-Timestamp': String(ts),
      'X-Mnemora-Signature': signature,
    },
    json: true,
    timeout: 15000,
  });
  return [{ json: { ...upstream, run_lock_released: !!(res?.released) } }];
} catch (e) {
  return [{ json: { ...upstream, run_lock_released: false, reason: e.message } }];
}
