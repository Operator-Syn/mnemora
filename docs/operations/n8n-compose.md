# n8n Compose deployment

This is Mnemora's initial self-hosted n8n stack: n8n main/editor, PostgreSQL, Redis, and a queue worker. The reverse proxy is deliberately outside this Compose project. n8n publishes only on `127.0.0.1:5680` on the VPS; configure the host's proxy to forward to that local endpoint. PostgreSQL and Redis have no published host ports.

## Configure

1. Copy `.env.example` to `.env` on the server. `N8N_VERSION` is pinned to an exact release, and `POSTGRES_VERSION` to a supported major, so `docker compose pull` reproduces the reviewed stack instead of drifting onto an unreviewed release. Updating is deliberate: change the tag in `.env`, `pull`, then `up -d`. n8n runs database migrations on boot, so back up PostgreSQL and the `n8n_data` volume before pulling, and keep the previous tag written down — a downgrade after a migration is not guaranteed to work.
2. Generate unique secrets locally (do not commit or share them). `N8N_ENCRYPTION_KEY` should be a stable random key; losing/changing it prevents decrypting stored credentials. Set `.env` permissions to `0600`.
3. Set `GENERIC_TIMEZONE` to the workflow timezone, and tune worker concurrency to the VPS capacity.
4. Before first boot, confirm the proxy upstream expects host loopback port 5680. Set a different `N8N_HOST_PORT` if that port is already occupied.

## Validate and update

`.env` in this directory is picked up automatically — no `--env-file` flag needed. Run these from the directory containing `compose.yaml`.

```sh
docker compose config --quiet   # fails loudly if .env is missing or incomplete
docker compose pull             # fetch current images
docker compose up -d            # recreate only what changed
docker compose ps
```

`pull` does not affect running containers; `up -d` applies the new images. Use `up -d --wait` to block until health checks pass, or when starting a fresh stack.

Back up PostgreSQL and the `n8n_data` volume together; keep the encryption key in a separate secure backup. Redis is queue state, not a substitute for durable workflow data. Do not run `down -v` unless intentionally deleting all persistent n8n data.

## Database version

`POSTGRES_VERSION` is pinned to **18**, the newest major n8n supports. n8n's policy supports the two actively maintained majors (17 and 18) plus one compatibility major (16); 16 only ever logged "outside the supported range and receives compatibility support only".

*Pin the major, not `latest`.* The image may move to a newer major that n8n has not certified yet, and a major bump cannot happen in place.

**postgres 18 changed its data directory.** From 18 onward the image stores data in a major-version subdirectory and the volume must be mounted at the parent:

```yaml
volumes:
  - postgres_data:/var/lib/postgresql      # correct for 18+
  # - postgres_data:/var/lib/postgresql/data   # refuses to start on 18+
```

Mounting the old path makes 18 exit with an "unused mount/volume" error explaining that it found data where it no longer looks. Don't "fix" this by pointing `PGDATA` elsewhere; the parent mount is what allows `pg_upgrade --link` later without mount-boundary problems.

### Major upgrades require dump and restore

Postgres cannot start on a data directory from an older major. The working sequence:

```sh
docker compose stop n8n worker              # stop writers
docker compose exec -T postgres pg_dump -U n8n -d n8n -Fc > .backups/pre-pg18.dump
docker compose down
docker volume rm mnemora-automation_postgres_data
# set POSTGRES_VERSION in .env to the new major, then:
docker compose up -d postgres               # fresh initdb on the new major
docker compose cp .backups/pre-pg18.dump postgres:/tmp/pre.dump
docker compose exec -T postgres pg_restore -U n8n -d n8n --no-owner --no-privileges /tmp/pre.dump
docker compose up -d                        # n8n runs its own migrations
```

Verify before trusting it: compare row counts for `user`, `workflow_entity`, `user_api_keys`, `settings`, and `execution_entity` across the upgrade, then confirm a workflow still executes and the MCP token still authenticates (it is a JWT signed with `N8N_ENCRYPTION_KEY`, so it survives a database swap as long as that key does not change). Dumps go to `.backups/`, which is gitignored.


This is a starting topology, not a production sign-off. Review the chosen release versions, host capacity, backup/restore, proxy TLS and webhook URL configuration, and access controls before exposing it.

## n8n 3.0 readiness

n8n 3.0 ships a migration report with five instance-level breaking changes. All five are now
settled here, each pinned in `compose.yaml` and overridable per deployment from `.env`.

| reported change | why it mattered here | what was done |
|---|---|---|
| Code-node task timeout default 300 s → **60 s** | **This one would have broken real work.** `Collect` runs an entire history fetch inside a single Code task: 68–116 s on a capped cold start, 252 s for a full one. At 60 s the run is aborted mid-crawl, having spent the calls. | `N8N_RUNNERS_TASK_TIMEOUT=600`, above the longest measured run. |
| Manual executions always run on workers; `OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS` removed | The variable was unset, so behaviour was implicit and 3.0 removes the choice. | Set to `true` explicitly — the same behaviour, stated rather than inherited. |
| Unverified community packages disabled by default | No community package is installed. | `N8N_UNVERIFIED_PACKAGES_ENABLED=false`, explicit. |
| Compression node limits lowered (2 GiB → 256 MiB, 5000 → 1000 entries) | No workflow uses a Compression node — verified by grep across `workflows/*/workflow.json`. | Pinned to the new ceilings, so a future workflow cannot be built against the old limits and then fail on upgrade. |
| "Import from URL" removed from the editor | Genuinely useful — it is how a workflow gets pulled out of a GitHub repo without cloning. Losing the menu item should not mean losing the capability. | Replaced at the CLI: `./scripts/workflows.sh import-url <url>`, which also inspects the workflow first. **The report item itself cannot be cleared — see below.** |

Also fixed while here: `WEBHOOK_URL` was the deprecated name and warned on every boot. It is now
`N8N_WEBHOOK_URL`. After the change the boot log reports **no** deprecation lines.

### Compression, and how this stays true after today

No workflow uses a Compression node today. That is a fact about the current files, not a property
of the deployment, so the ceiling is enforced rather than remembered:

- `N8N_COMPRESSION_NODE_MAX_DECOMPRESSED_SIZE_BYTES=268435456` and
  `N8N_COMPRESSION_NODE_MAX_ZIP_ENTRIES=1000` are pinned in `.env`, with the same values as
  fallbacks in `compose.yaml`. An upgrade cannot move them; raising them is a deliberate edit.
- `scripts/check-instance-env.py` reads the **rendered** compose configuration — what the container
  will actually receive, not what `.env` appears to say — and refuses the deployment if a pinned
  value is missing or below what the collector needs.
- If a Compression node is ever added, that check requires it to record, in its own Notes, the
  largest payload it must handle. A node that genuinely needs 2 GiB then says so in the workflow
  where the requirement lives, instead of failing at 256 MiB in production with nobody able to tell
  what it used to accept.
- `./scripts/workflows.sh check` runs both gates; `import` runs them too and will not deploy a
  workflow that fails either.

Demonstrated, not asserted:

| scenario | result |
|---|---|
| Compression node with no Notes contract | `FAIL … node 'Compress Backup' is a Compression node with no size contract` |
| same node with the payload size recorded | `ok … compression nodes: 1`, plus a warning that it is running at the platform defaults |
| `N8N_RUNNERS_TASK_TIMEOUT` lowered to 60 | `FAIL … is below 300 — the Collect node runs ~157 s in one task` |

### The import-from-URL notice is left visible

The report line reads like a defect. It is not one, and it is not about the version we run.

- The stack is on **2.44.5**, the current latest stable. There is no 3.x release yet; `2.45.x` are
  prereleases, and `:latest` resolves to the 2.44.5 digest.
- n8n 2.44.5 ships **both** `dist/modules/breaking-changes/rules/v2` and `rules/v3`. The v3 rules are a
  forward-looking preview: what would break *if* you moved to the next major.
- `workflow-import-url-removed.rule.js` therefore says "the editor's Import from URL is going away in
  v3" — and on 2.44.5 the editor still has it (`importFromUrl` is present in the editor bundle).

An override was briefly mounted to silence it, on the mistaken belief that 3.x was already running and
the capability already gone. It was removed for exactly this reason: **the notice is the only thing in
the product that will warn you before an upgrade takes the menu away.** Suppressing it hides a real
decision, and the decision is not ours to make silently.

The rule cannot be configured off — `detect()` returns `isAffected: true` with no condition — and it is
instance-level, so `migration_finding` (statuses `open`/`notified`/`fixed`/`fixed_unpublished`/`wont_fix`)
cannot triage it either. It also cannot be dismissed in the UI. So it stays, one line, until the
upgrade either happens or does not.

If it ever becomes genuinely useless — because the upgrade was done and the menu is accepted as gone —
the way to silence it is a read-only bind mount over that one file in both `n8n` and `worker`. Do that
with a checker, because a mount that silently stops applying is worse than the notice.

### Importing from a URL (replacement for the removed editor option)

n8n 3.0 removes the editor's "Import from URL". The capability is kept where it can be tested and
reviewed:

```sh
./scripts/workflows.sh import-url https://github.com/o/r/blob/main/workflows/wf.json --save import-010-x
```

- **GitHub links are rewritten** — `blob` → `raw.githubusercontent.com`, so a link copied from the
  browser address bar works.
- **The workflow is inspected first.** The scan reports Execute Command nodes, `$env` access
  (every variable in the container is readable, including `N8N_ENCRYPTION_KEY`), outbound HTTP
  hosts, webhook triggers, Code nodes and credential slots. Anything risky requires `--yes`; without
  it the import is refused with the list.
- **`--save` records provenance** — `workflows/<dir>/workflow.json` plus a README naming the source
  URL, the import time and the n8n id. The id is stamped into the file, so re-importing updates that
  workflow instead of creating a duplicate.
- The usual rules still apply: the import is a **draft and deactivates** the workflow, so publish it
  before any trigger fires. `./scripts/workflows.sh check` then validates layout and references like
  any other directory.

### Deliberately not done

`N8N_RUNNERS_MODE` is still the internal task runner. Moving to `external` requires running the
task-runner launcher as a separate process with a shared auth token — a real change to the
deployment, not a setting, and there is no isolation requirement yet that justifies it.

### How to confirm this on the running instance

```sh
# the values the process actually has, not the ones in the file
docker compose exec -T n8n env | grep -E 'RUNNERS_TASK_TIMEOUT|OFFLOAD|UNVERIFIED|COMPRESSION'
docker compose exec -T worker env | grep -E 'RUNNERS_TASK_TIMEOUT'

# no deprecation warnings left on boot
docker compose logs --since 5m n8n | grep -E ' - [A-Z_]+ ->' || echo 'none'
```

The timeout is not taken on trust: a full re-collection takes ~252 s in one Code task, and it
completes, which a 60 s default would not allow.
