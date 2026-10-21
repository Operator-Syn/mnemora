# Security and privacy considerations

Status: baseline guidance for a proposal, not a completed security review.

## Private repository boundary

- Private repositories are opt-in by explicit owner selection.
- Keep private aggregates behind authentication and authorization. Repo names, language distribution, and activity counts can reveal sensitive work even without commit details.
- Private commit messages, SHAs, authors, and changed-file lists must never be returned to public clients.
- No credentials in browser JavaScript, static artifacts, workflow exports, logs, screenshots, or docs. Redact authorization headers and webhook secrets.
- Use least privilege and separate public collection paths from private collection paths.

## GitHub app and credential handling

A future GitHub App should request only permissions needed for read-only repository data, be restricted to explicitly selected repositories where feasible, and store its private key server-side in a proper secrets manager. Installation access tokens are short-lived, but token expiration does not itself revoke a human user's collaborator access. Never share a personal access token with customers.

## Time-bounded repository access

The paid-access feature grants temporary ability to access the hosted repository; it cannot reliably revoke a clone after download. Removing a collaborator blocks future remote operations but cannot erase local copies. State this clearly in checkout, terms, and help text. Avoid representing the feature as DRM or a technical guarantee that users lose source at expiry.

Before activation, review:

- Dedicated organization and repository isolation; do not expose unrelated personal repositories.
- Read-only permission and exact access scope.
- Payment webhook signature verification, replay resistance, idempotency, event ordering, and amount/currency checks.
- Entitlement start/end, retries, expiry reconciliation, manual revoke, refunds, disputes, chargebacks, and customer support process.
- Audit log access controls, data retention, deletion requests, backup retention, privacy notice, and applicable platform/business terms.

No real paid users or automated grants/revocations until this review is complete, the behavior is tested on a disposable repository, and the operator explicitly approves launch.

## Threat-model prompts

- Can a public endpoint retrieve private repo identifiers or cached aggregates?
- Can a repository flip from private to public (or back) between discovery and collection, and is the public listing the only thing deciding what enters the cache?
- Can repeated or forged billing events extend access, or can a retry revoke an active entitlement?
- What happens if the expiry worker is down or GitHub's API is unavailable at the expiry instant?
- Does a customer retain access through an organization team or another collaborator path after the intended grant is removed?
- Could logs, workflow execution data, exports, analytics, or backups retain data after deletion?
## What is gated, and by what

Every surface that can be reached, and the layer that stops it. Verified against the running
instance on 2026-10-21, not inferred from configuration files.

| surface | gate | verified |
|---|---|---|
| `POST /webhook/mnemora-commits` (write pipe) | `X-Mnemora-Pipe-Token` header → n8n credential `Mnemora Pipe`, answered by `403` before the workflow runs | anonymous `403`, wrong token `403`, correct token reaches the workflow |
| `GET /webhook/mnemora-telemetry` (read endpoint) | same shape: `X-Mnemora-Token` → credential `Mnemora Telemetry` | anonymous `403`, wrong header name `403`, correct token `200` |
| `notify-010-run-failures` | writes `mnemora_runs` directly with the `Mnemora DB` postgres credential, bypassing the pipe by design — it only ever inserts rows with `status = 'error'` | inserts nothing but run metadata; no commit or repository rows |
| the database behind both | role-scoped: `mnemora_reader` can `SELECT` three tables, cannot write, cannot connect to the `n8n` database; the pipe's role cannot reach `n8n` either | `has_table_privilege` → select `t`, insert `f`, update `f`; `has_database_privilege(... 'n8n', 'CONNECT')` → `f` |
| `/mcp-server/http` | token required by the MCP layer | `401` without a token |
| editor and REST API | n8n login (owner account has a password set) | — |
| Postgres and Redis | no host port published; reachable only on the compose network | `docker compose ps` shows only `127.0.0.1:5680` |
| whole stack | binds `127.0.0.1` only | `ports: "127.0.0.1:${N8N_HOST_PORT}:5678"` |
| secrets at rest | `.env` files `600` and gitignored; credentials encrypted with `N8N_ENCRYPTION_KEY` | `stat` → `600` |
| database dumps in `.backups/` | `600` and gitignored — they contain every commit row | `chmod 600` applied; they were `664` before |

### Two asymmetries worth stating

1. **The three Code nodes that call the pipe read the token from the environment.** A Code node
   cannot hold an n8n credential, so `MNEMORA_PIPE_TOKEN` is in the container environment. With
   `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, every workflow can read it. The HTTP nodes use the
   credential instead, which is tighter. Closing this fully means converting those three calls into
   HTTP Request nodes — more nodes, and worth it only if the stack stops being single-operator.
2. **MFA is off on the editor account.** Loopback binding is the current mitigation. Turning MFA on
   requires the operator's authenticator, so it stays a recommendation rather than something the
   repository can do.
