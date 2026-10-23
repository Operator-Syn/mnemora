#!/bin/sh
# Serve the built bundle on the Worker runtime, safely.
#
# Why this exists: `wrangler dev -c dist/server/wrangler.json` serves a snapshot of dist/, and
# `npm run build` rewrites that directory underneath it. Wrangler notices, prints
# "Reloading local server...", and the server comes back dead — the tab keeps whatever it last
# rendered, which looks exactly like a stale cache and is not one.
#
# So: stop the old server first, build, then start. The rebuild can never race the server.
#
#   ./scripts/dev-worker.sh          # port 8787
#   PORT=8788 ./scripts/dev-worker.sh
set -eu

cd "$(dirname "$0")/.."

PORT="${PORT:-8787}"

# Kill the previous wrangler, matching its own command line only. The [w] keeps the pattern from
# matching the shell that is running this script.
pids=$(pgrep -f '[w]rangler dev -c dist/server/wrangler.json' || true)
if [ -n "$pids" ]; then
  echo "dev-worker: stopping the previous server ($pids)"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 1
fi

# A port still held after the parent died (orphaned workerd) would silently serve the old bundle.
if command -v ss >/dev/null 2>&1; then
  holder=$(ss -ltnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)
  if [ -n "${holder:-}" ]; then
    echo "dev-worker: port $PORT still held by pid $holder; stopping it"
    kill "$holder" 2>/dev/null || true
    sleep 1
  fi
fi

npm run build
echo "dev-worker: serving dist on http://127.0.0.1:$PORT"
exec npx wrangler dev -c dist/server/wrangler.json --port "$PORT"
