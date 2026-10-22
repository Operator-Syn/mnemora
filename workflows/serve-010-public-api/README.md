# serve-010-public-api

The read side. Five `GET` endpoints over the product database, for the portfolio dashboard to call
instead of reading Postgres itself.

Nothing here writes. Every statement filters `visibility = 'public'`, and the credentials it holds
are the read-only ones — so a leaked URL, a hostile query string, or a bad edit can return the wrong
public rows but cannot change a row or reach a private one.

All four routes require the `X-Mnemora-Read-Key` header. The site is TanStack Start SSR on
Cloudflare Workers, so the browser never calls this API — the Worker does, and the key lives in the
Worker's secret store. That is the difference between a key and decoration: a key shipped to a
browser is readable in DevTools, a key held by a server is not.

## Endpoints

| endpoint | answers | notes |
|---|---|---|
| `GET /webhook/api/repos` | the index: every public repository with languages, commit count, freshness | `?include_archived=true` adds archived repositories (hidden by default) |
| `GET /webhook/api/repository?id=` | one repository | `id` accepts GitHub's numeric `repository_id` **or** `owner/name` |
| `GET /webhook/api/commits` | commits, newest first, across all repositories or one | `?repository_id=` (numeric or `owner/name`), `?limit=` 1–200 (default 50), `?before_ms=` cursor |
| `GET /webhook/api/activity` | commits per day | `?days=` 1–365 (default 90) |

**Query strings, not path segments.** n8n's docs advertise path parameters (`/api/repos/:id`), and
this workflow was built that way first — the routes registered and then never matched: n8n's lookup
keys a dynamic webhook on the request's *first* segment being the webhook id, so `api/repos/123`
answers "not registered". Verified against 2.44.5. Query strings also collapse the per-repository
commit list into the same route as the global feed, since they differ by one predicate.

Response envelope: `{ "count"|"repository"|"commits"… , … }` on success, `{ "error", "route",
"reason" }` on 404/400. Errors carry the route that produced them, because a dashboard that calls
four endpoints should not have to guess which one failed.

A scoped commit feed (`?repository_id=`) answering `404` means the repository is unknown, not that it
has no commits — "no commits" is `200` with `returned: 0`. A bare name like `arqen` matches nothing;
`full_name` is `owner/name`.

**Paging is a cursor, not an offset.** A page returns `next_before_ms` — epoch milliseconds, send it
back as `?before_ms=`. A commit landing between two requests therefore cannot duplicate or skip a
row, which an `offset` would allow. Null means the page was not full.

The cursor is milliseconds rather than an ISO string on purpose: Postgres has no safe text-to-time
cast, so `?before=not-a-date` (or a syntactically fine but impossible date) used to become a 500. An
integer cannot misparse, and it is what a browser already has in `Date.now()`.

**Malformed arguments are a 400, not a silent default.** `?limit=abc`, `?before_ms=12oops` and
`?days=many` return `400` with a `reason` naming the offending field; the casts in SQL are guarded by
the same predicates that produce the error, so the failure path cannot fail while reporting.

**Caching.** `200` responses carry `Cache-Control: public, max-age=60, stale-while-revalidate=300`.
The data moves once an hour (the collector's schedule), so a minute of shared cache is honest and
keeps requests off an instance where every call is a workflow execution. Errors are never cached.

## Prerequisites

| what | value | why |
|---|---|---|
| credential `Mnemora Read` (type `httpHeaderAuth`) | header `X-Mnemora-Read-Key`, value in the stack `.env` as `MNEMORA_READ_TOKEN` | the Webhook nodes require it; n8n answers `403` before the workflow runs. The canonical copies are this credential and the Cloudflare Worker secret |
| credential `Mnemora DB (read-only)` (type `postgres`) | database `mnemora`, user `mnemora_reader` | every node uses it; the role can `SELECT` and cannot reach n8n's database |
| published | yes | an unpublished webhook answers `404` and the site sees nothing |

Creating the read key credential (the value in `.env` is generated, 32 random bytes):

```sh
python3 -c 'import json,os;print(json.dumps([{"name":"Mnemora Read","type":"httpHeaderAuth","data":{"name":"X-Mnemora-Read-Key","value":os.environ["T"]}}]))' \
  | T="$(grep -m1 '^MNEMORA_READ_TOKEN=' .env | cut -d= -f2-)" sh -c 'cat > /tmp/read-cred.json'
docker compose cp /tmp/read-cred.json n8n:/tmp/read-cred.json
docker compose exec -T n8n n8n import:credentials --input=/tmp/read-cred.json
```

The key is a secret, not an authenticity proof of the site: anyone who obtains it can call the API
from anywhere. What actually bounds abuse is the rate limit and the response cache in
`infra/nginx/mnemora-api.conf`, which is the deployment shape this API expects — nginx on the VPS
exposing only `GET /webhook/api/*`, caching for 60 s, and limiting to 10 req/s per IP. The Worker's
requests are server-to-server, so the Webhook nodes' CORS setting is irrelevant to them; it stays
permissive rather than pinned because pinning it would imply a browser is a supported caller.

This workflow deliberately has **no error workflow**. `notify-010-run-failures` writes a collector
run row — lease ids, repository counts — and a failed read has none of those. A read failure should
be visible in the execution list, not filed as a crawl.

## Nodes

```
GET repos ────────→ SQL repos ────────┐
GET repository ───→ SQL repository ───┤
GET commits ──────→ SQL commits ──────┼→ Shape Response → Reply
GET activity ─────→ SQL activity ─────┘
```

Every SQL branch returns the same three columns — `route`, `status`, `data` — so the only node that
knows about HTTP is `Shape Response`. Adding a fifth endpoint means one Webhook, one SQL file, and
one wire into `Shape Response`.

Parameters are pipe-joined after a literal `v1|` prefix (`v1|key|limit|before`). Commas would be
split by n8n's Postgres node, and an ISO timestamp contains them; the prefix exists because n8n binds
*no* parameter when the replacement string is empty, which turned a request without `?include_archived`
into `there is no parameter $1` instead of a default. Every value is cast in SQL
(`::bigint`, `::timestamptz`, `::int`), so a malformed one produces "no such repository" or a clamp,
never an injection.

## Try it

```sh
curl -s -H "X-Mnemora-Read-Key: $MNEMORA_READ_TOKEN" \
  'http://127.0.0.1:5680/webhook/api/repos' | jq '.count, .repositories[0].full_name'
curl -s -H "X-Mnemora-Read-Key: $MNEMORA_READ_TOKEN" \
  'http://127.0.0.1:5680/webhook/api/repository?id=Operator-Syn/arqen' | jq '.full_name, .source_state'
curl -s -H "X-Mnemora-Read-Key: $MNEMORA_READ_TOKEN" \
  'http://127.0.0.1:5680/webhook/api/commits?limit=3' | jq '.returned, .next_before_ms'
# then: .../commits?limit=3&before_ms=<that value>
curl -s -H "X-Mnemora-Read-Key: $MNEMORA_READ_TOKEN" \
  'http://127.0.0.1:5680/webhook/api/activity?days=30' | jq '.window_days, .total'

# no key → 403 before the workflow runs; unknown repo → 404
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:5680/webhook/api/repos'
curl -s -o /dev/null -w '%{http_code}\n' -H "X-Mnemora-Read-Key: $MNEMORA_READ_TOKEN" \
  'http://127.0.0.1:5680/webhook/api/repository?id=nope'
```

## Related

- `infra/nginx/mnemora-api.conf` — the VPS edge: path allowlist, rate limit, response cache
- `db/migrations/0009_committed_at.sql` — the index the two feed endpoints depend on
- `docs/product/requirements.md` — what the dashboard is allowed to show, and the public/private rule
- `workflows/persist-010-commits-to-postgres/` — the write side
- `workflows/debug-010-telemetry/` — the operator view (authenticated, not public)
