# mnemora — secrets handling and lease-refusal semantics

> **Status, 2026-10-22 13:30 +08:00:** implemented. The last three sections are the plan as written;
> what actually ships is recorded at the bottom under *What was built*. Two deviations, both
> deliberate: the pipe token is now **signature-only** (the optional section below became the work),
> and **no credential was rotated** — this is still a single-operator loopback stack, so rotation
> waits for the day it stops being one.

Plan review, 2026-10-22. Drafted with Claude (text-only consult), verified against the live stack
and the repo before adoption. Where Claude's draft was wrong, the correction is marked **✗ corrected**.

---

## The question that decides everything

> Would a dedicated secrets manager in the stack be better, or does n8n do this natively?

Three facts, all checked today:

1. **n8n's native answer is credentials** — encrypted in the n8n DB with `N8N_ENCRYPTION_KEY`,
   usable by declarative nodes (Postgres, HTTP Request, …). **Code nodes cannot hold credentials.**
   That is the whole reason `COLLECT_010_GITHUB_TOKEN` and `MNEMORA_PIPE_TOKEN` are `$env` values.
2. **n8n's external-secrets feature does not solve this.** It is Enterprise-only on self-hosted, and
   the docs are explicit: *"Credentials stored in an external secrets store only resolve in credential
   fields, not in any other fields supporting expressions."* It feeds credential fields. It does not
   feed `$env`, and the leak is in a Code node.
3. **A vault container changes where the plaintext sits at rest, not who can read it.** To reach a Code
   node, the value still has to become a container env var — the same trust boundary that any workflow
   on the instance can read today (`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`). It adds an unseal path and a
   boot dependency, and reduces the leak by zero.

So: **do not add a secrets manager for this.** It is not the missing control. The missing control is
"don't copy the secret into node output".

There is one vault-shaped option that is *not* theatre: reusing OpenBao already running in the `arqen`
stack. But it is on network `arqen_default`, not `mnemora-automation_backend`; attaching it means
AppRole/TLS/unseal automation and coupling two stacks — for two tokens on one loopback-only box.
Not worth it. Revisit if a second consumer of these secrets appears.

### The two leaks are not the same size

| | GitHub PAT | Pipe token |
|---|---|---|
| Reaches | an external service (GitHub) | a loopback-only webhook on this compose network |
| Leaks because | copied into the `Build Plan` output → stored in `execution_data` | echoed in the persist Webhook node's request headers → stored in `execution_data` |
| Fixed by | not materializing it (5-line change) | a static header cannot be un-sent; only a signature or a proxy fixes it |
| Verdict | **fix now** | **rotate, document the residual, optionally HMAC later** |

Verified: stored execution 1829 (`execution_data.data`) contains the literal
the resolved bearer header (deliberately redacted here); stored execution 1566 contains `x-mnemora-pipe-token: …` in its
Webhook output. Neither came from `$env` being wrong — both came from the value crossing into node data.

---

## Item 1 — stop materializing the GitHub token

**Do (a), rotate, purge. Skip (b) (e) for now; reject (c) (d) as theatre.**

Edits:

1. `workflows/collect-010-github-public-cache/code/build-plan.js`
   - Keep reading `$env.COLLECT_010_GITHUB_TOKEN`, but build no `headers` object in the returned plan.
     Return only non-secret plan fields.
2. `workflows/collect-010-github-public-cache/code/collect.js`
   - Build the headers inside `Collect` at request time (it already has a `get()` helper — one place).
   - Never attach headers to anything returned.
   - Wrap `this.helpers.httpRequest` and rethrow a **sanitized** error
     (`GET /repos/... failed: 404`). Do not rethrow the axios/n8n error object: it carries the request
     config, headers included, and that is exactly the shape that ends up in stored execution data.
     *(Claude raised this; it is the right kind of cheap insurance.)*
3. `scripts/workflows.sh check` → `import` after the edit.
4. **Rotate the PAT** in `workflows/collect-010-github-public-cache/.env`, then
   `docker compose up -d n8n worker` (both, because the worker executes Code nodes and reads `$env` at
   process start). Revoke the old token **last**, so a code rollback does not leave a dead token.
5. Purge the three stored failed executions that carry the old token. **✗ corrected:** in n8n 2.44 the
   payload is in `execution_data.data`; `execution_entity` has no `data` column. Join them:

   ```sql
   select e.id, e.status, jsonb_array_length(coalesce(d.data::jsonb -> 'resultData' -> 'runData' -> 'Build Plan', '[]'::jsonb))
   from execution_entity e
   join execution_data d on d."executionId" = e.id
   where d.data::text ilike '%ghp_%';
   ```

   Delete through the n8n UI/API (it cascades correctly), not by hand.

**What this does and does not buy.** It removes the token from every future stored execution and from
node output generally. It does **not** remove the token from `$env`, which every workflow on the instance
can read. That residual belongs in the commit message and the workflow README — stated, not implied.

### Rejected for now

- **(b) Move GitHub calls into HTTP Request nodes with a GitHub credential.** The real long-term answer:
  the token leaves `$env` and lives only in the encrypted credential table. Rejected *today* because the
  per-repository loop, pagination, cursor resume and 30-second per-call timeout all live inside one Code
  task; moving them into the graph is a rewrite of `Collect`, not a hardening patch. Revisit if
  third-party workflows are ever imported into this instance.
- **(c) n8n external secrets.** Enterprise, and resolves in credential fields only — cannot reach the
  Code node. Dead end for this architecture. *(Would become relevant only after (b).)*
- **(d) Vault container + entrypoint export.** Replaces one `.env` with one vault plus a boot dependency,
  then hands the same plaintext to the same `$env`. No leak reduction.
- **(e) GitHub fetch proxy.** The only design that removes the PAT from n8n entirely, and it matches the
  pipe pattern already trusted here. Disproportionate today; it is the correct target if this ever leaves
  one machine.

### Optional, later: HMAC for the pipe token

Replace `X-Mnemora-Pipe-Token` with `X-Mnemora-Timestamp` + `X-Mnemora-Signature`
(HMAC-SHA256 over `ts.run_id.action`), verified in a `persist-010` Code node with a 60-second window.
The durable secret then exists only in `$env`; a captured stored request is not a credential.
Cost: ~40 lines, plus `NODE_FUNCTION_ALLOW_BUILTIN=crypto` for both `n8n` and `worker` (verify that
`crypto` is otherwise unavailable in this instance's Code sandbox before relying on the flag).
Worth doing only if you want zero durable secrets in execution data — the pipe token is loopback-only.

---

## Item 2 — a lease refusal must not look like a failure

**Do not throw. Return a normal item, branch, record a distinct status, exit green.**

Node graph:

```
… → Acquire Run Lock → Lease Acquired? (If: $json.run_lock === 'acquired')
                         true  → Collect → Record Run
                         false → Record Run
Record Run → Release Run Lock (early-returns unless run_lock === 'acquired') → end
```

Code changes:

1. `acquire-run-lock.js` — replace the `throw` with a return that carries the run identity:

   ```js
   if (!res || res.acquired !== true) {
     return [{ json: {
       ...first,
       run_lock: 'held',
       run_lock_id: runId,              // ✗ corrected: the draft omitted this, and
       holder: res?.holder ?? 'unknown', //   Record Run's `first.run_id` would have been undefined
       holder_expires_at_utc: res?.holder_expires_at_utc ?? null,
     }}];
   }
   ```

2. `record-run.js` — **✗ corrected ordering matters.** The file's first lines read
   `$('Collect').all()`, which throws when `Collect` never ran. Move that read *inside* the
   non-held branch; do not merely add an `if` around the summary object.

   ```js
   const item = $input.first().json ?? {};
   const plan = $('Build Plan').first().json ?? {};
   const held = item.run_lock === 'held';
   const summary = held ? {
     run_id: item.run_lock_id, workflow: 'collect-010', status: 'busy',
     started_at_utc: plan.until ?? null, finished_at_utc: new Date().toISOString(),
     repositories_total: null, /* … counters null, not 0 … */
     note: `lease_held:${item.holder} expires:${item.holder_expires_at_utc}`,
   } : /* existing summary build */;
   ```

   Match the existing POST-and-return shape; `save-run.sql` inserts the status as text and casts the
   counters, so `null` passes through.

3. `release-run-lock.js` — first line, before any HTTP call:
   `if (($input.first().json || {}).run_lock !== 'acquired') return [{ json: $input.first().json }];`
   An early return, not a request whose result is ignored. It must be structurally impossible for a
   refused run to release the holder's lease.

4. `notify-010-run-failures` — **no change**. A refusal no longer throws, so the error workflow will not
   fire; that is the correct outcome. Keep it for genuine failures. Its `Release Lease` must keep
   scoping to the failed run's own `run_id` (already fixed and deployed as
   `$('Build Failure Summary').item.json.release_sql`).

5. No migration. `mnemora_runs.status` is free text with no CHECK constraint.

### Status value: I disagree with the draft on the name

The draft says `skipped`. I would use **`busy`**. `mnemora_runs` already has a
`repositories_skipped` counter meaning "repositories not fetched because unchanged" — a run-level
`skipped` collides with that vocabulary and will read as "the run skipped repositories" rather than
"the run never started". `busy` says what happened. Either works; pick one and write it in the docs.

### Edge cases worth stating

- **Holder crashed vs alive is not decidable at acquire time**, and should not be. The refusal is correct
  in both cases. The `note` (`holder`, `holder_expires_at_utc`) is what makes it diagnosable later.
- **Duplicate deliveries are real in queue mode.** **✗ corrected:** the draft treated "five hourly
  refusals" as a contradiction to resolve. The evidence: executions 1456→1458 is a `retryOf` chain, and
  1822/1824 started one second apart — two deliveries of one tick, not five ticks. All five failures sat
  inside a single 900-second TTL. The design must therefore tolerate *duplicates* (two refused runs, two
  distinct `run_id`s), which it does. My earlier "five hourly ticks" framing was wrong.
- **Manual run vs schedule:** same path. Do not add a force/bypass flag; that is how a manual run
  duplicates a live crawl.
- **Persist unreachable during acquire:** `httpRequest` still throws, the error workflow fires, status
  `error`. Correct — you cannot know whether a lease exists.
- **Skip executions are not stored** (`EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`). The `mnemora_runs` row is
  the audit trail, which is the point.

### What a future dashboard should count

- Outage: `status = 'error'` in the window. `partial` is degraded, not outage.
- Freshness: no `success`/`partial` row for two schedule intervals — catches a dead scheduler, which no
  per-run status can.
- Lease health: a streak of `busy` rows, or any `busy` whose holder expiry was already in the past at
  insert time.

---

## Sequencing

One branch, one import — both items touch the same three Code nodes.

1. Code edits (items 1a and 2), `scripts/workflows.sh check`.
2. Rotate `MNEMORA_PIPE_TOKEN` in `.env` **and** in the `Mnemora Pipe` credential in one window
   (the credential sends the old value otherwise), then `docker compose up -d n8n worker`.
3. Import, then run the verification matrix.
4. Rotate the GitHub PAT, revoke the old one.
5. Purge the stored executions that carry retired values.

## Verification

1. `scripts/workflows.sh check` passes; `rg -n 'Authorization|ghp_|X-Mnemora-Pipe-Token' workflows/`
   shows no secret crossing into workflow JSON or Code-node output.
2. Force a `Collect` failure. Confirm a stored execution exists, and that
   `execution_data.data` for it contains neither `ghp_` nor `Authorization`. Search the **old token's
   last 6 characters**, not just the prefix.
3. Seed a fake lease through the persist webhook, run `collect-010` manually. Expect: execution success,
   one `mnemora_runs` row with `status='busy'` and the holder in `note`, no error-workflow execution,
   fake lease still held. Release it, run again: normal `success` row.
4. Force a real failure. Expect `status='error'`, error workflow fires, that run's own lease released.
5. `select run_id, status, note from mnemora_runs order by finished_at_utc desc limit 10;`

---

## What was built

Implemented 2026-10-22, verified against the running stack. Deviations from the plan above are called
out where they differ.

**Secrets**

- `Build Plan` no longer carries a `headers` object. It reports `github_token_present: true|false` and
  nothing else about the token. `Collect` builds the headers at request time from `$env`.
- `Collect`'s GitHub calls are wrapped so a failure rethrows `collect-010: GET <url> failed: <status>`
  rather than the axios error, whose `config.headers` would have re-materialized the token in the
  stored failure.
- **The pipe token became signature-only** (the "optional, later" section, done now, at the operator's
  request). `X-Mnemora-Pipe-Token` is gone from every caller and from `n8n`'s webhook auth. Callers
  send `X-Mnemora-Timestamp` + `X-Mnemora-Signature` = HMAC-SHA256 over `<ts>.<action>.<identity>`;
  `persist` verifies in a new `Verify Signature` Code node inside a 60-second window, derives
  action/identity from the payload shape, and answers `401` through `Respond to Webhook` on failure.
  Requires `NODE_FUNCTION_ALLOW_BUILTIN=crypto` on `n8n` and `worker` (added to compose; the sandbox
  otherwise has no `require` at all).
- The signed triple is shape-based (`records/record`, `records/batch`, `archive/batch`,
  `acquire|release/<run_id>`, `summary/<run_id>`), not a body digest: n8n re-parses the JSON, so a
  byte-exact canonical form would be a maintenance trap. The threat being closed is credential reuse,
  not tampering on a loopback network. Replay is bounded by the 60-second window and by idempotent
  upserts keyed on `run_id`/`sha`.
- `scripts/backfill.sh` signs with `openssl dgst -sha256 -hmac` instead of sending the token.
- **No credential was rotated** — single operator, loopback only. The one stored execution that
  contained the retired static-token header (a probe created during this verification) was deleted.

**Lease refusal**

- `Acquire Run Lock` returns `run_lock='held'` with `run_lock_id`, `lease_holder` and
  `lease_holder_expires_at_utc`; it no longer throws. A `disabled` lock still proceeds to crawl.
- New `Lease Available?` node: `run_lock !== 'held'` → `Collect`, otherwise → `Record Run`. Routing on
  `!== 'held'`, not `=== 'acquired'`, so `COLLECT_010_RUN_LOCK=false` still collects.
- `Record Run` files `status='busy'` with null counters and a `lease_held_by:… expires:…` note. The
  `$('Collect')` read moved inside the branch that only runs when `Collect` ran — an unconditional read
  throws on the refusal path, which was the trap in the draft.
- `Release Run Lock` already early-returned when the lease was not `acquired`; that guard is now
  commented as load-bearing rather than incidental.
- `notify-010` is unchanged: refusals no longer reach it, and a genuine failure still records `error`
  and releases that run's own lease.

**Verified, not assumed**

- Unsigned request → `401 missing X-Mnemora-Timestamp`; old header token → `401`; stale timestamp
  (`ts-120`) → `401 timestamp is outside the 60s window`; wrong signature → `401 signature mismatch`;
  a signature computed for a different action → `401`. Signed acquire/release → `200`.
- Manual `collect-010` run: execution success, `mnemora_runs` row `success`, 24/24 repositories
  `skipped`, 1 API call, lease released.
- Seeded a lease, ran again: execution **success**, row `status='busy'` with the holder in `note`,
  counters null, **no** error-workflow execution, and the seeded lease still held. Released it, ran
  again: back to `success`.
- Stored payloads: a deliberately failed `persist` execution (`Validate Payload` rejected a record
  with an empty `full_name`) contains neither the pipe secret nor the GitHub PAT, and contains
  `x-mnemora-signature` instead of `x-mnemora-pipe-token`. Positive control: execution 1829 still
  contains the old PAT, so the query works.
- `./scripts/workflows.sh status` → all four workflows armed; `./scripts/workflows.sh check` and
  `scripts/check-js-lint.py` → clean.
- One bug found and fixed during verification: `responseCode` on `Respond to Webhook` lives under
  `options`, not at the top level. A top-level `responseCode` is accepted silently and answers `200`
  with an error body.
