// Gate the write pipe on a signature instead of a reusable header token.
//
// Why: this workflow stores the request's headers in its execution data, and n8n keeps failed
// executions for a week. A long-lived `X-Mnemora-Pipe-Token` therefore became a credential sitting
// in a table. A signature over `ts.action.identity` cannot be replayed outside the tolerance window,
// so a stored request is no longer a key to the pipe.
//
// The secret never leaves `$env` on either side: callers sign, this node verifies, and neither side
// puts the value in an item. The headers are dropped from the output for the same reason they used
// to be a problem — nothing downstream needs them.
//
// The `action` and `identity` are derived from the body by the same rule the senders use:
//   { run_claim:   { action: 'acquire'|'release', run_id } } -> (action, run_id)
//   { run_summary: { run_id, ... } }                         -> ('summary', run_id)
//   [ record, ... ] | { repositories: [...] }                -> ('records', 'batch')
//   single record object                                     -> ('records', 'record')
//   { archived_repository_ids: [...] }                       -> ('archive', 'batch')
// A body is signed by shape, not by bytes: the threat is credential reuse, not tampering.
// biome-ignore lint/style/useNodejsImportProtocol: n8n's sandbox allowlist is the bare name `crypto`; `node:crypto` is not what NODE_FUNCTION_ALLOW_BUILTIN matches.
const crypto = require('crypto');

const TOLERANCE_SECONDS = 60;
const secret = typeof $env !== 'undefined' ? $env.MNEMORA_PIPE_TOKEN || '' : '';

const item = $input.first().json ?? {};
const body = item.body !== undefined ? item.body : item;

// n8n lowercases incoming header names, but a caller is not obliged to.
const headers = {};
for (const [k, v] of Object.entries(item.headers || {})) headers[String(k).toLowerCase()] = v;

function shapeOf(value) {
  if (!value || typeof value !== 'object') return ['unknown', 'none'];
  if (Array.isArray(value)) return ['records', 'batch'];
  if (value.run_claim && typeof value.run_claim === 'object') {
    const action = String(value.run_claim.action || '');
    return [action, String(value.run_claim.run_id ?? '')];
  }
  if (value.run_summary && typeof value.run_summary === 'object') {
    return ['summary', String(value.run_summary.run_id ?? '')];
  }
  if (Array.isArray(value.archived_repository_ids)) return ['archive', 'batch'];
  if (Array.isArray(value.repositories)) return ['records', 'batch'];
  if (value.repository_id != null) return ['records', 'record'];
  return ['unknown', 'none'];
}

const [action, identity] = shapeOf(body);
const tsRaw = headers['x-mnemora-timestamp'];
const sig = headers['x-mnemora-signature'];
const ts = Number(tsRaw);

let reason = null;
if (!secret) {
  reason = 'pipe secret is not configured on this instance';
} else if (!['acquire', 'release', 'summary', 'records', 'archive'].includes(action)) {
  reason = 'payload shape is not signable (expected a record, a batch, an archive list, a claim or a summary)';
} else if (tsRaw === undefined) {
  reason = 'missing X-Mnemora-Timestamp';
} else if (!Number.isFinite(ts)) {
  reason = 'X-Mnemora-Timestamp is not a number';
} else if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) {
  reason = `timestamp is outside the ${TOLERANCE_SECONDS}s window`;
} else if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/i.test(sig)) {
  reason = 'missing or malformed X-Mnemora-Signature';
} else {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${ts}.${action}.${identity}`)
    .digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) reason = 'signature mismatch';
}

if (reason) {
  // Nothing from the request is echoed back except what a caller needs to fix their signing.
  return [{ json: { signature_ok: false, reason, action, identity } }];
}

return [
  {
    json: {
      signature_ok: true,
      action,
      identity,
      body,
      query: item.query ?? {},
      params: item.params ?? {},
    },
  },
];
