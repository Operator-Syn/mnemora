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
