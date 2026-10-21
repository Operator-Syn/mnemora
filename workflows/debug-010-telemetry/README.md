# debug-010-telemetry

An authenticated read endpoint over the product database, so a run can be debugged without
opening n8n or SSH-ing into Postgres.

```
GET /webhook/mnemora-telemetry
X-Mnemora-Token: <token>
```

Without a valid header n8n answers **403** before a single query runs. The token lives in the
`Mnemora Telemetry` credential (encrypted with `N8N_ENCRYPTION_KEY`) and its value is in the stack
`.env` as `MNEMORA_TELEMETRY_TOKEN`.

## Why it exists

`mnemora_runs` answers *what* a run did in aggregate. It cannot answer *which* repository was slow,
capped, or failing — and in this stack successful executions are not persisted
(`EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`), so n8n keeps no detail for them either. `mnemora_telemetry`
fills that gap with one row per repository per run, written by `persist-010` from the collector's own
report.

## What one call returns

| field | answers |
|---|---|
| `recent_runs` | last 20 runs: status, counts, commits new/pruned, API calls, duration |
| `recent_issues` | last 25 repository outcomes that were **not** `complete`, with the verbatim error |
| `slowest_repositories` | per repository over 7 days: slowest `duration_ms`, commits, times fetched |
| `health` | last run age and status, repository/commit/pending/archived counts, whether the run lease is held, migrations applied |

One request is enough to know whether the pipeline is healthy, what broke, and what is slow.

```sh
TOKEN=$(grep '^MNEMORA_TELEMETRY_TOKEN=' .env | cut -d= -f2)
curl -s -H "X-Mnemora-Token: $TOKEN" http://127.0.0.1:5680/webhook/mnemora-telemetry | jq .
```

## Authorization model

- **The endpoint** is gated by a header token; no token, no query.
- **The database role** is `mnemora_reader`: `SELECT` only, product database only. It cannot write,
  cannot read n8n's own database, and cannot see credentials.
- **The token** is stored encrypted in n8n and in the stack `.env` (mode 0600, gitignored). Rotate by
  re-importing the credential with a new value and updating `.env`.

A leaked token therefore exposes run history and repository names — not the database, not
credentials, and not the ability to change anything.

## Nodes

`Telemetry In (Webhook)` → `Read Stats` → `Reply`

`Read Stats` runs one `SELECT` with three aggregates and a health object, as `mnemora_reader`.
