#!/usr/bin/env bash
# Replay the collector's cache files through the persist webhook.
#
#   ./scripts/backfill.sh                 # every github-public-cache__*.json
#   ./scripts/backfill.sh <file> [...]    # specific files
#
# Why this exists: the cache is derived state, the database is the product. After a schema
# change, a new host, or a lost database, this refills it from files already on disk —
# no GitHub API calls, so no rate limit and no waiting on pagination.
#
# It is also the honest test of the pipe: it sends the exact records the collector produces.
set -euo pipefail

cd "$(dirname "$0")/.."

url="${MNEMORA_PIPE_URL:-http://127.0.0.1:5680/webhook/mnemora-commits}"
data_dir="${MNEMORA_DATA_DIR:-/home/node/mnemora-data/public}"

# Cache files live inside the worker's volume, so read them through the container.
read_file_from_volume() {
  docker compose exec -T worker cat "$1"
}

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  mapfile -t files < <(docker compose exec -T worker sh -c "ls $data_dir/github-public-cache__*.json 2>/dev/null | sort")
fi

[ "${#files[@]}" -gt 0 ] || { echo "no cache files found in $data_dir" >&2; exit 1; }

total_repos=0 total_commits=0 failed=0
for f in "${files[@]}"; do
  body=$(read_file_from_volume "$f")
  # Body goes through stdin, not argv: a 400 KB cache file overflows the kernel's argument
  # list limit and curl fails with "Argument list too long".
  response=$(printf '%s' "$body" | curl -sS -X POST "$url" -H 'Content-Type: application/json' \
    --data-binary @- --max-time 300 -w '\n%{http_code}') || {
      echo "FAIL $(basename "$f") — curl error" >&2; failed=$((failed + 1)); continue; }

  code=$(printf '%s' "$response" | tail -n1)
  payload=$(printf '%s' "$response" | sed '$d')

  if [ "$code" != "200" ]; then
    echo "FAIL $(basename "$f") — HTTP $code $payload" >&2
    failed=$((failed + 1))
    continue
  fi

  repos=$(printf '%s' "$payload" | sed -n 's/.*"repositories":"\{0,1\}\([0-9]*\)"\{0,1\}.*/\1/p')
  commits=$(printf '%s' "$payload" | sed -n 's/.*"commits_seen":"\{0,1\}\([0-9]*\)"\{0,1\}.*/\1/p')
  total_repos=$((total_repos + ${repos:-0}))
  total_commits=$((total_commits + ${commits:-0}))
  printf 'ok   %-64s repos=%-2s commits=%s\n' "$(basename "$f")" "${repos:-?}" "${commits:-?}"
done

echo "---"
echo "files: ${#files[@]}  failed: $failed  repositories: $total_repos  commits: $total_commits"
[ "$failed" -eq 0 ]
