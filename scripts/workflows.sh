#!/usr/bin/env bash
# Keep n8n workflows in git instead of only in the n8n Postgres volume.
#
# Layout: one directory per workflow.
#   workflows/<name>/
#     workflow.json     definition (source of truth)
#     .env.example      committed template
#     .env              local values (gitignored)
#
#   ./scripts/workflows.sh import   # every workflows/*/workflow.json -> n8n
#   ./scripts/workflows.sh export   # running n8n -> each workflow directory
#   ./scripts/workflows.sh run <name-or-id>
#   ./scripts/workflows.sh import-url <url> [--save <dir>] [--yes]
#       The editor's "Import from URL" is removed in n8n 3.0; this is the replacement, and it
#       inspects the workflow before importing rather than trusting the link.
#
# Export after editing in the UI, import after editing the JSON by hand.
# Never edit both sides at once: the last one written wins.
set -euo pipefail

cd "$(dirname "$0")/.."

workflow_files() {
  find workflows -mindepth 2 -maxdepth 2 -name workflow.json | sort
}

# n8n refuses to share its task-broker port with the running main instance,
# so CLI execution and imports run in a throwaway container on the same volumes.
one_off() {
  docker compose run --rm --no-deps -e N8N_RUNNERS_ENABLED=false n8n "$@"
}

psql_db() {
  docker compose exec -T postgres psql \
    -U "$(grep '^POSTGRES_USER=' .env | cut -d= -f2)" \
    -d "$(grep '^POSTGRES_DB=' .env | cut -d= -f2)" -tAc "$1"
}

case "${1:-}" in
  check)
    # Two independent gates, both cheap, both about failures that are invisible at runtime.
    #   instance env  - pinned n8n limits have not drifted, and any Compression node states the
    #                   payload size it must handle
    #   workflow refs - every $('Name') resolves and no branch sits on an output that cannot exist
    ./scripts/check-instance-env.py
    env_rc=$?
    python3 scripts/check-workflow-refs.py
    refs_rc=$?
    ./scripts/check-workflow-layout.py
    layout_rc=$?
    [ "$env_rc" -eq 0 ] && [ "$refs_rc" -eq 0 ] && [ "$layout_rc" -eq 0 ]
    exit $?
    ;;

  import)
    # Both checks block the import: a renamed node, a branch on a nonexistent output, or a
    # workflow depending on a limit nobody recorded is a failure that looks like success.
    ./scripts/check-instance-env.py || {
      echo "refusing to import: fix the instance settings above" >&2
      exit 1
    }
    python3 scripts/check-workflow-refs.py || {
      echo "refusing to import: fix the broken references above" >&2
      exit 1
    }
    ./scripts/check-workflow-layout.py || {
      echo "refusing to import: fix the workflow layout above" >&2
      exit 1
    }
    found=0
    while IFS= read -r f; do
      found=1
      echo "-> $(dirname "$f")"
      docker compose cp "$f" "n8n:/tmp/wf.json" >/dev/null < /dev/null
      docker compose exec -T n8n n8n import:workflow --input=/tmp/wf.json < /dev/null | tail -1
    done < <(workflow_files)
    [ "$found" = 1 ] || { echo "no workflows/*/workflow.json found"; exit 1; }
    # Import upserts by id; a rising count means a file lost its id.
    echo "workflows in database: $(psql_db 'select count(*) from workflow_entity;')"
    echo
    echo "note: an import writes a DRAFT. It does not publish, and importing deactivates the"
    echo "      workflow, so any webhook or schedule it had stops until you publish it again."
    echo "      Publish from the workflow UI, or with the n8n MCP publish_workflow tool."
    echo "      Verify a webhook with a probe POST: 404 means unpublished, 500 means it ran."
    ;;

  export)
    while IFS= read -r f; do
      id=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("id",""))' "$f")
      if [ -z "$id" ]; then
        echo "skip $(dirname "$f"): workflow.json has no id (import would duplicate)"
        continue
      fi
      docker compose exec -T n8n n8n export:workflow --id="$id" --output=/tmp/wf-out.json < /dev/null >/dev/null
      docker compose cp n8n:/tmp/wf-out.json "$f" >/dev/null < /dev/null
      echo "exported $id -> $f"
    done < <(workflow_files)
    ;;

  import-url)
    shift
    exec python3 scripts/import-from-url.py "$@"
    ;;

  run)
    target="${2:?usage: run <workflow-name-or-id>}"
    if ! [[ "$target" =~ ^[A-Za-z0-9]{16}$ ]]; then
      id=$(psql_db "select id from workflow_entity where name = '$target' limit 1;")
      target="${id//[[:space:]]/}"
      [ -n "$target" ] || { echo "no workflow named '$2'"; exit 1; }
    fi
    one_off execute --id "$target"
    ;;

  *)
    sed -n '2,18p' "$0"
    exit 1
    ;;
esac
