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

If you want the *built* bundle under `wrangler dev` instead — no HMR, closer to a deploy:

```sh
npm run dev:worker                 # build, then wrangler dev -c dist/server/wrangler.json
```

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
