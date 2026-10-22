# persist-010-commits-to-postgres

The only writer to the product database. It receives observations over HTTP and turns them into
rows: repositories, commits, runs, telemetry.

It reads **no environment variables** — and therefore has no `.env.example`. Its database
connection is an n8n **credential**, not configuration (see *Prerequisites*). That is deliberate:
`N8N_BLOCK_ENV_ACCESS_IN_NODE=false` in this stack means every workflow can read every env var, so a
password in `.env` would be readable by all three workflows, while a credential is readable only by
the nodes that declare it.

## Prerequisites

| what | value | why |
|---|---|---|
| credential `Mnemora Pipe` (type `httpHeaderAuth`) | header `X-Mnemora-Pipe-Token`, value in `.env` as `MNEMORA_PIPE_TOKEN` | the webhook requires it; without the header n8n answers `403` before any workflow runs |
| credential `Mnemora DB` (type `postgres`) | host `postgres`, port 5432, database `mnemora`, user `mnemora_app` | the write role. Owns the tables; cannot connect to `n8n`'s database. |
| published | yes | an unpublished webhook answers `404` and every collector run fails loudly |

Creating the credential (value in the stack `.env` as `MNEMORA_DB_PASSWORD`):

```sh
jq -n --arg pw "$MNEMORA_DB_PASSWORD" '[{name:"Mnemora DB",type:"postgres",data:{
  host:"postgres",port:5432,database:"mnemora",user:"mnemora_app",
  password:$pw,ssl:"disable",allowUnauthorizedCerts:false}}]' > /tmp/cred.json
docker compose cp /tmp/cred.json n8n:/tmp/cred.json
docker compose exec -T n8n n8n import:credentials --input=/tmp/cred.json
```

Credentials are encrypted with `N8N_ENCRYPTION_KEY`. Lose that key and every credential in this
stack is unrecoverable — including the GitHub token.

## The endpoint

```
POST /webhook/mnemora-commits
```

Inside the compose network: `http://n8n:5678/webhook/mnemora-commits`. Not `127.0.0.1:5680` — inside
a container that address is the container itself.

**Authenticated.** Every call must carry `X-Mnemora-Pipe-Token`; without it n8n answers `403` before
the workflow executes. Layer on top: the whole stack publishes only on `127.0.0.1`, and the write
role cannot reach `n8n`'s database. Two callers exist and both send the header:

- `collect-010` — uses the `Mnemora Pipe` credential on its HTTP node, so the token never enters an
  environment variable where other workflows could read it.
- `scripts/backfill.sh` — reads `MNEMORA_PIPE_TOKEN` from `.env` (mode 0600, gitignored).

Any manual `curl` now needs the header too: `-H "X-Mnemora-Pipe-Token: $MNEMORA_PIPE_TOKEN"`.

## Four payload shapes, four branches

| payload | branch | writes |
|---|---|---|
| `{ "repositories": [ record, ... ], "archived_repository_ids": [...] }` | `Save Batch` | upserts repositories (with their crawl cursor), archives vanished ones, prunes commits **only** for a finished crawl or a legacy full payload, upserts the rest |
| `{ "run_claim": { action, run_id, ttl_seconds } }` | `Run Claim` | acquires/releases the single-run lease in `mnemora_run_lock` |
| `{ "run_summary": { ... } }` | `Save Run` | one `mnemora_runs` row + one `mnemora_telemetry` row per repository, in one statement |
| no valid shape | — | fails loudly; nothing is written |

A record is exactly what `collect-010` produces: `repository_id`, `full_name`, `pushed_at_utc`,
`commit_count`, `source_state`, `refreshed_at_utc`, `languages_bytes`, `commits[]`. Payloads are
base64-encoded before reaching SQL, because n8n's Postgres node splits query parameters on commas
and commit messages contain them.

## Two rules that protect data

1. **Prune only on a finished crawl.** A record prunes on one of two grounds: a crawl that reached
   the oldest commit (`commit_crawl_complete`), where the sweep deletes rows whose
   `last_seen_crawl_id` is not this crawl — rows confirmed in an earlier run of the same crawl
   survive, and so does anything the same batch is about to upsert; or a legacy one-shot full
   payload (`source_state = 'complete'` **and**
   `commits_omitted` is absent. A partial fetch, a skipped repository, a pending one, an `empty`
   one — none may delete rows they never fetched. Breaking this once deleted all 6,993 commits.
2. **Archive, never delete.** A repository absent upstream gets `archived_at_utc`; its row and every
   commit stay. Reappearing un-archives it.

## Nodes

```
Commits In (Webhook) → Validate Payload → Is Run Claim? ─┬─ yes → Run Claim  → Reply
                                                          └─ no  → Is Run Summary? ─┬─ yes → Save Run → Reply
                                                                                    └─ no  → Save Batch → Reply
```

`Validate Payload` enforces shape before any SQL runs. `Reply` returns the counts so the caller can
verify what happened rather than assume: `repositories`, `repositories_archived`, `commits_pruned`,
`commits_seen`, `commits_new`.

## Testing without n8n

```sh
# a repository record
curl -s -X POST http://127.0.0.1:5680/webhook/mnemora-commits \
  -H "X-Mnemora-Pipe-Token: $MNEMORA_PIPE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"repositories":[{"repository_id":1,"full_name":"test/x","source_state":"complete","commits":[]}]}'

# the lease
curl -s -X POST http://127.0.0.1:5680/webhook/mnemora-commits \
  -H "X-Mnemora-Pipe-Token: $MNEMORA_PIPE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"run_claim":{"action":"acquire","run_id":"probe","ttl_seconds":60}}'
```

## Related

- `db/migrations/` — the schema this writes, applied with `./scripts/migrate.sh`
- `docs/architecture/overview.md` — why the product database is separate from n8n's
- `workflows/collect-010-github-public-cache/` — the producer
- `workflows/debug-010-telemetry/` — authenticated read-only view of what this wrote
