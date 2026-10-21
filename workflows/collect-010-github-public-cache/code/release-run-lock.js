// Hand the lease back as soon as the fetching is done, so the next manual run is not blocked
// for the rest of the TTL. Deliberately non-fatal: failing to release must not fail a run that
// already stored its data — the TTL reclaims the lease anyway.
const upstream = $input.first().json ?? {};
const acquired = $('Acquire Run Lock').first().json;
if (!acquired || acquired.run_lock !== 'acquired') {
  return [{ json: { ...upstream, run_lock_released: false, reason: 'not held' } }];
}
try {
  const res = await this.helpers.httpRequest({
    method: 'POST',
    url: 'http://n8n:5678/webhook/mnemora-commits',
    body: { run_claim: { action: 'release', run_id: acquired.run_lock_id } },
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
  return [{ json: { ...upstream, run_lock_released: !!(res && res.released) } }];
} catch (e) {
  return [{ json: { ...upstream, run_lock_released: false, reason: e.message } }];
}