# mnemora frontend

The portfolio site. TanStack Start (SSR) on Cloudflare Workers, reading from the n8n stack's
read-only API in `workflows/serve-010-public-api`.

## Why the API call lives on the server

The read API requires `X-Mnemora-Read-Key`. That key is held by the Worker's runtime — `.dev.vars`
locally, `wrangler secret put` in production — and the browser never sees it. This is the whole
reason the site is SSR: a key shipped to a browser is not a secret, and a key held by a server is.

Practically: data loads through `createServerFn` handlers (`src/lib/mnemora.ts`), and route loaders
call those handlers. A `useEffect` calling `fetch` directly would put the key in the bundle; don't.

## Local development

```sh
cp .dev.vars.example .dev.vars     # then paste MNEMORA_READ_TOKEN from the stack's ../.env
npm install
npm run dev                        # http://localhost:3000
```

`npm run dev` is **already the local Worker runtime**. `@cloudflare/vite-plugin` boots a miniflare
instance (workerd) and runs the SSR environment inside it — `viteEnvironment: { name: 'ssr' }` in
`vite.config.ts` is what routes it there — so `process.env` comes from `.dev.vars`, `caches` exists,
and the server code runs under the same runtime rules as production. Verified in this repo by
rendering `navigator.userAgent` server-side: it prints `Cloudflare-Workers`, and `MNEMORA_*` env keys
are visible to the handler.

If you want the *built* bundle under `wrangler dev` instead — closer to a deploy:

```sh
npm run dev:worker                 # build, then wrangler dev -c dist/server/wrangler.json
```

**`wrangler dev` has no HMR.** Its only dev-time reloading is `--live-reload`, which refreshes the
page when files change — a restart, not a module swap: component state is lost and no React Fast
Refresh. HMR needs a module graph and update boundaries, which only Vite has. That is not a gap you
can configure away; `@cloudflare/vite-plugin` exists to bridge exactly this, and it is why `npm run
dev` is the loop to iterate in. `dev:worker` is for production parity (real bundle, real asset
paths), not for editing.

Measured here on `npm run dev`: a component edit lands in the live DOM in **~1.0 s** with
`window` state intact (no reload), and editing a server module (`src/lib/mnemora.ts`) makes Vite
hot-update `virtual:cloudflare/worker-entry` — the next SSR request renders the new code without
restarting the worker.


Both read `.dev.vars` for secrets. Neither puts the key in the browser bundle, because both execute
the server functions in the Worker.


The n8n stack must be running (`cd .. && docker compose up -d`) and the read API must answer:

```sh
curl -s -H "X-Mnemora-Read-Key: $MNEMORA_READ_TOKEN" \
  http://127.0.0.1:5680/webhook/api/repos | jq '.count'
```

`vite dev` runs the app inside workerd through `@cloudflare/vite-plugin`, so `process.env` comes from
`.dev.vars` — the same mechanism as production, which is why a missing key fails locally rather than
only in production.

## Build and deploy

```sh
npm run build          # vite build; the Worker bundle lands in dist/
npx wrangler deploy    # after `wrangler login` and one-time secret setup
npx wrangler secret put MNEMORA_READ_KEY
```

`wrangler.jsonc` holds the non-secret configuration: the Worker name, `compatibility_date`, and
`nodejs_compat` (needed for `process.env`). Add `MNEMORA_API_URL` there under `vars` for production —
it points at the public origin nginx exposes, which only serves `GET /webhook/api/*`
(`../infra/nginx/mnemora-api.conf`).

## Layout

```
src/
  lib/mnemora.ts       server functions + types; the only place that knows the API's shape
  routes/__root.tsx    document shell, theme init, header/footer
  routes/index.tsx     repository index: counts, language mix, cards
  routes/about.tsx     scaffold placeholder — replace with the real page
  components/          Header, Footer, ThemeToggle
  styles.css           Tailwind 4 entry + the design tokens
```

Routes are files. `npm run generate-routes` regenerates `src/routeTree.gen.ts` after adding one.

## Caching

Responses from n8n carry `Cache-Control: public, max-age=60` because the underlying data moves on the
collector's hourly schedule. Cloudflare will cache them at the edge for free; if you want that
guaranteed per-PoP rather than best-effort, pass `cf: { cacheEverything: true, cacheTtl: 60 }` to the
`fetch` in `src/lib/mnemora.ts`.

## What this app must not do

- Never call the API from the browser.
- Never read private repositories: the API only serves `visibility = 'public'`, and the endpoints for
  private aggregates do not exist yet.
- Never render commit data as "authored contribution" — `commit_count` is commits returned by the
  GitHub API for the default branch, and bot commits and merges are included.

## When the page looks like an older build

There are three different things that can hand you stale UI, and only one of them is a cache.

| what you see | what it is | fix |
|---|---|---|
| The Worker on `:8787` dies or serves a bundle that no longer exists | `npm run build` rewrites `dist/` underneath a running `wrangler dev`; it prints "Reloading local server..." and stops answering | `npm run dev:worker` — it stops the old server, builds, then starts |
| Old modules in the Vite dev server on `:3000` | the running server's in-memory module graph, or `node_modules/.vite` after big dependency edits — a refresh revalidates modules (`no-cache` + ETag), so if a refresh does not change the page, the tab is running JS it loaded earlier | `npm run dev:fresh`, then close the tab and reopen it |
| The tab shows a page you already replaced | browser HTTP cache | hard reload (`Ctrl+Shift+R`) |

```sh
npm run clean       # dist, dist-ssr, .wrangler, .tanstack, .output, node_modules/.vite
npm run dev:fresh   # clean + Vite dev
npm run dev:worker  # stop any running worker, build, serve dist
```

`npm run dev` (Vite) reads your source directly and is the one to use while editing.
`npm run dev:worker` runs the real built bundle; it is a snapshot of `dist/`, so it is the one that
goes stale if you rebuild behind it.
