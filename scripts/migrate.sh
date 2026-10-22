#!/usr/bin/env bash
# Apply pending migrations to the product database, in order, once each.
#
#   ./scripts/migrate.sh            # apply everything pending
#   ./scripts/migrate.sh --status   # show applied / pending, change nothing
#
# Design rules:
#   - Files are numbered and applied in filename order: 0001_init.sql, 0002_....sql
#   - Each file runs in a single transaction, so a failure leaves no half-migration.
#   - Applied versions are recorded in mnemora_schema_migrations, with a checksum.
#     Editing a migration that has already run changes its checksum and is reported
#     as drift, because the database no longer matches the file.
#   - Connecting as mnemora_app: the product role, which cannot reach n8n's database.
set -euo pipefail

cd "$(dirname "$0")/.."

mode="${1:-apply}"
[ -f .env ] || { echo "no .env found" >&2; exit 1; }

db_name=$(grep -m1 '^MNEMORA_DB_NAME=' .env | cut -d= -f2- || true)
db_user=$(grep -m1 '^MNEMORA_DB_USER=' .env | cut -d= -f2- || true)
db_pass=$(grep -m1 '^MNEMORA_DB_PASSWORD=' .env | cut -d= -f2- || true)
: "${db_name:?MNEMORA_DB_NAME missing from .env}"
: "${db_user:?MNEMORA_DB_USER missing from .env}"
: "${db_pass:?MNEMORA_DB_PASSWORD missing from .env}"

db() {
  docker compose exec -T -e PGPASSWORD="$db_pass" postgres \
    psql -h 127.0.0.1 -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 -q "$@"
}

checksum() { sha256sum "$1" | cut -d' ' -f1; }

db -c "create table if not exists mnemora_schema_migrations (
         version     text primary key,
         checksum    text not null,
         applied_at  timestamptz not null default now()
       );" >/dev/null

shopt -s nullglob
migrations=(db/migrations/*.sql)
[ ${#migrations[@]} -gt 0 ] || { echo "no migrations found in db/migrations/"; exit 0; }

# --rebaseline <version>: accept the current file as the applied text for one version.
# Only for changes that cannot alter what ran — comments, whitespace, reordering a note. It exists so
# that fixing a typo in a comment does not leave permanent drift, while still refusing to paper over
# a real edit to a statement that already executed.
if [ "$mode" = "--rebaseline" ]; then
  version="${2:?usage: migrate.sh --rebaseline <version>}"
  file="db/migrations/${version}.sql"
  [ -f "$file" ] || { echo "no such migration: $file" >&2; exit 1; }
  sum=$(checksum "$file")
  db -c "update mnemora_schema_migrations set checksum = '$sum' where version = '$version';" >/dev/null
  echo "rebaselined $version -> $sum"
  echo "state the reason in the commit message: this records that the file's current text is"
  echo "what the database already ran, and nobody should trust that claim silently."
  exit 0
fi

applied=0; skipped=0; drift=0
for file in "${migrations[@]}"; do
  version=$(basename "$file" .sql)
  sum=$(checksum "$file")
  recorded=$(db -tAc "select checksum from mnemora_schema_migrations where version = '$version';" | tr -d '[:space:]')

  if [ -n "$recorded" ]; then
    skipped=$((skipped + 1))
    if [ "$recorded" != "$sum" ]; then
      drift=$((drift + 1))
      echo "DRIFT  $version — file changed after it was applied" >&2
    elif [ "$mode" = "--status" ]; then
      echo "applied $version"
    fi
    continue
  fi

  if [ "$mode" = "--status" ]; then
    echo "pending $version"
    continue
  fi

  echo "apply  $version"
  db --single-transaction -f - < "$file"
  db -c "insert into mnemora_schema_migrations (version, checksum) values ('$version', '$sum');" >/dev/null
  applied=$((applied + 1))
done

if [ "$mode" = "--status" ]; then
  # Drift is a failure: the database no longer matches the files. Exit non-zero so a
  # CI check catches it rather than printing a warning nobody reads.
  [ "$drift" -eq 0 ] || exit 1
  exit 0
fi

echo "done: $applied applied, $skipped already present, $drift drifted"
[ "$drift" -eq 0 ] || exit 1
