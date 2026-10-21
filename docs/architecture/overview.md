# Architecture overview

Status: partially decided. The service shape below is settled; the presentation layer is not.

## Service shape (decided 2026-10-21)

n8n is the backend. There is no application server, and the database is the product's data.

- **PostgreSQL is the source of truth.** The dashboard reads rows, not files. The JSON cache
  under the collector's volume is derived state, useful to the collector and disposable.
- **One responsibility per workflow, connected by a pipe.** `collect-*` fetches from GitHub
  and hands records over; `persist-*` writes records to the database and owns nothing else.
  Each can be replaced without rewriting the other, and either can be run on its own.
- **Committed observations are pruned.** A commit that no longer exists upstream is deleted
  from the database rather than kept with a tombstone. The product shows what exists, not a
  history of what once did.
- **The collector reads its own state from the database.** "Which repositories already exist
  and what was their last `pushed_at`" is a query, not a file lookup. Exactly one writer
  (the persist workflow) and one reader (the collector) keeps them from drifting.

The cost of this shape is that collection now depends on the database being reachable. A
collector run without it cannot decide what to skip, and must fail rather than re-fetch
everything blindly.

## Logical components

1. **Presentation** — public dashboard for selected public repos; authenticated owner view for private aggregate metrics. Not built. Reads the database.
2. **Application/API boundary** — enforces visibility and authorization before returning data. Private aggregates must not be accessible through a public endpoint. In this shape the boundary is a database role plus whatever serves reads; it is not yet designed.
3. **Collector workflow(s)** — read permitted GitHub data, handle pagination, rate limits, retries and refresh scheduling. n8n orchestration, one workflow per responsibility.
4. **Persist workflow** — the only writer to the database. Takes records in, upserts rows, prunes what vanished.
5. **Store** — PostgreSQL, with public and private records separated by rule and by role, not by directory.
6. **Entitlement service (future, gated)** — maps verified billing state to time-bounded read access. Must not be implemented until ownership model, payment provider, policies and security have been reviewed.

## Data topology (decided 2026-10-21)

Product data lives in its **own database**, not inside n8n's.

| database | owner | contents |
|---|---|---|
| `n8n` | `n8n` | ~150 tables of n8n's own state: workflows, executions, credentials, users |
| `mnemora` | `mnemora_app` | `mnemora_repositories`, `mnemora_commits` — the product's data |

`CONNECT` is revoked from `PUBLIC` on both, and `mnemora_app` is granted it only on
`mnemora`. Verified: connecting as `mnemora_app` to `n8n` fails with *permission denied for
database "n8n"*. The persist workflow therefore cannot read n8n's credentials table even if
it is misconfigured, and a `pg_dump` of the product is independent of n8n's.

**What this boundary does not give you:** both databases still share one PostgreSQL cluster
and therefore one data volume and one `docker compose down -v`. Isolation is at the level of
database, privileges and backup, not lifecycle. If a shared cluster's failure must not take
the product down with n8n, that needs a second Postgres service — a cost in memory and
operations that has not been justified yet.


## Data flow

```text
GitHub REST API -> collector -> visibility-separated cache/store -> authorization-aware API -> dashboard
Payment provider -> verified webhook -> entitlement record -> narrowly scoped GitHub access grant/revoke
```

The payment path is optional and deliberately separate from dashboard data collection. A public visitor must not be able to influence a GitHub permission change by directly calling an unauthenticated endpoint.

## Deployment-neutral design constraints

- Use the public repository listing for discovery and least-privilege read access, so private repositories are unreachable by construction rather than filtered out in code.
- Keep secrets server-side and out of workflow exports, logs, browser bundles, and documentation.
- Use idempotency keys and compare-and-set/state transitions for payment events and access expiry.
- Ensure a failed collector run preserves the last-known-good dataset while marking its freshness accurately.
- Provide a manual revoke and reconciliation path; do not rely solely on one scheduled job.
- The current node1 capacity assessment is preliminary and applies only to a small, low-frequency demo. It does not approve any deployment; see the cloud-manager project notes.

## Decisions still open

- ~~Repository discovery vs owner-maintained allowlist~~ — **decided:** discovery of all public repositories via the public repository listing. An allowlist was considered and rejected as the v1 scope.
- ~~Persistence technology~~ — **decided:** PostgreSQL is the source of truth and the dashboard reads it. Commits that disappear upstream are **pruned**, not tombstoned.
- Static build plus server-side API, or fully dynamic application.
- What serves reads to the dashboard: a database role plus a thin API, or a static export generated from the database.
- Whether any customer-facing private aggregate view is needed at all.
- Whether paid access belongs in the initial product or a later, separately reviewed phase.