#!/usr/bin/env bash
# Keep n8n workflows in git instead of only in the n8n Postgres volume.
#
# Layout: one directory per workflow.
#   workflows/<name>/
#     workflow.json     definition (source of truth); code and SQL are @file: markers
#     code/*.js         Code node bodies, as real files
#     sql/*.sql         Postgres queries, as real files
#     .env.example      committed template
#     .env              local values (gitignored)
#
#   ./scripts/workflow_files.py build|split   render markers <-> extract files
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
    # biome, on the Code-node bodies as n8n actually runs them (wrapped, so top-level return parses)
    ./scripts/check-js-lint.py
    js_rc=$?
    [ "$env_rc" -eq 0 ] && [ "$refs_rc" -eq 0 ] && [ "$layout_rc" -eq 0 ] && [ "$js_rc" -eq 0 ]
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
    ./scripts/check-js-lint.py || {
      echo "refusing to import: biome reported problems above" >&2
      exit 1
    }
    found=0
    # Import deactivates every workflow it touches, which silently disarms production: a schedule
    # stops firing and a webhook starts answering 404. Record what is armed now, so the aftermath
    # can be named instead of discovered the next time something fails to run.
    armed_before=$(psql_db "select id from workflow_entity where active and \"activeVersionId\" is not null order by id;")
    # A credential id belongs to one n8n database. Importing the checked-in JSON verbatim writes the
    # exporting instance's ids into the nodes, and every one of them then fails at run time with
    # 'No authentication data defined on node' — a published, active workflow that cannot
    # authenticate. Resolve them by name (the only portable identifier) so the manifest stays
    # instance-neutral and the import is correct wherever it lands.
    cred_map=$(mktemp)
    psql_db "select name || E'\t' || id from credentials_entity order by name;" > "$cred_map"
    while IFS= read -r f; do
      found=1
      echo "-> $(dirname "$f")"
      # Code and SQL live in files beside the manifest; render them into JSON for n8n.
      rendered=$(mktemp)
      python3 scripts/workflow_files.py build "$(dirname "$f")" --out "$rendered" \
        --credentials "$cred_map" >/dev/null
      docker compose cp "$rendered" "n8n:/tmp/wf.json" >/dev/null < /dev/null
      rm -f "$rendered"
      docker compose exec -T n8n n8n import:workflow --input=/tmp/wf.json < /dev/null | tail -1
    done < <(workflow_files)
    rm -f "$cred_map"
    [ "$found" = 1 ] || { echo "no workflows/*/workflow.json found"; exit 1; }
    # Import upserts by id; a rising count means a file lost its id.
    echo "workflows in database: $(psql_db 'select count(*) from workflow_entity;')"
    echo
    disarmed=$(psql_db "select id || '  ' || name from workflow_entity
      where id = any(string_to_array(nullif('$(echo "$armed_before" | tr '\n' ',' | sed 's/,$//')', ''), ','))
        and not (active and \"activeVersionId\" is not null)
      order by name;")
    if [ -n "$disarmed" ]; then
      echo "!! DISARMED by this import — these were published and now are not:"
      echo "$disarmed" | sed 's/^/     /'
      echo
      echo "   Their schedules will not fire and their webhooks answer 404 until republished."
      echo "   Republish from the workflow UI, or with the n8n MCP publish_workflow tool."
      echo "   The CLI cannot do it: 'n8n publish:workflow' prints 'restart n8n for changes to take"
      echo "   effect' and a live instance keeps answering 404 (measured, not assumed)."
      echo "   Check with: ./scripts/workflows.sh status"
    else
      echo "nothing was armed before this import, so nothing was disarmed."
    fi
    ;;

  status)
    # One place to answer: is production actually armed? A workflow that is active but unpublished,
    # or published but inactive, is broken in a way that looks fine in the editor.
    printf '%-18s %-34s %-9s %-10s %s\n' ID NAME ACTIVE PUBLISHED VERDICT
    broken=0
    while IFS='|' read -r id name active published; do
      [ -n "${id:-}" ] || continue
      if [ "$active" = "t" ] && [ "$published" = "t" ]; then verdict="armed"
      elif [ "$active" = "f" ] && [ "$published" = "f" ]; then verdict="idle"
      else verdict="BROKEN"; broken=1
      fi
      printf '%-18s %-34s %-9s %-10s %s\n' "$id" "$name" "$active" "$published" "$verdict"
    done < <(psql_db "select id || '|' || name || '|' ||
                             case when active then 't' else 'f' end || '|' ||
                             case when \"activeVersionId\" is not null then 't' else 'f' end
                     from workflow_entity order by name;")
    [ "$broken" = 0 ] || { echo; echo "a workflow is half-enabled: publish and activate it, or neither"; exit 1; }
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
      rm -rf "$(dirname "$f")/code" "$(dirname "$f")/sql"
      python3 scripts/workflow_files.py split "$(dirname "$f")" >/dev/null
      echo "exported $id -> $f (+ code/ and sql/)"
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
