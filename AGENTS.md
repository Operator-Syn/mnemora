# Working in the Mnemora repository

Mnemora collects GitHub repository activity with n8n, stores it in PostgreSQL, and serves it through
a TanStack Start app on Cloudflare Workers. This file covers the repository as a whole: what lives
where, which shared rules apply everywhere, and where the stack-specific instructions are.

Each stack owns its own detail. Do not restate a stack's rules here, and do not put repository-wide
policy in a stack's file.

## Map

| path | owns | governed by |
|---|---|---|
| `compose.yaml`, `.env.example` | self-hosted n8n (queue mode), PostgreSQL, Redis; loopback-bound | this file, `docs/operations/` |
| `db/migrations/` | the schema, append-only numbered SQL | this file |
| `workflows/<workflow-id>/` | one n8n workflow export plus its `code/`, `sql/` and notes | `docs/automation/workflows.md` |
| `scripts/` | shared repository tooling (workflow import/export, migrations, checks, hooks) | this file |
| `docs/` | product, architecture, trust, operations, research; index at `docs/README.md` | `docs/README.md` |
| `infra/nginx/` | the reverse-proxy configuration for the deployment host | `docs/operations/` |
| `frontend/` | the TanStack Start app: package, Wrangler/Vite config, design and product docs, generated TanStack skills | [`frontend/AGENTS.md`](frontend/AGENTS.md) |
| `.githooks/` | the commit guard that makes every commit single-file | this file, `README.md` |
| `.codex/`, `.claude/`, `scripts/hooks/` | agent hook registration and the dispatcher that scopes it | [Agent hooks](#agent-hooks) |
| `.agents/skills/impeccable/`, `.claude/skills/impeccable/`, `.claude/agents/` | project-pinned Impeccable distributions and Claude subagents | this file |
| `biome.json` | lint rules for JavaScript/TypeScript/JSON/CSS across the whole repository | this file |

A stack's dependencies, runtime configuration, generated files and design documents stay inside that
stack's directory. Moving `frontend/package.json`, `wrangler.jsonc`, `vite.config.ts` or `DESIGN.md` to
the root would not make them easier to find; it would make the app stop being a self-contained unit.

## Shared conventions

- **One file per commit.** `.githooks/pre-commit` rejects zero or multiple staged paths. Install it
  once per clone with `./scripts/setup-hooks.sh`; `git commit --no-verify` overrides deliberately.
  Merge commits are exempt.
- **Secrets never enter the repository.** `.env`, `.dev.vars` and dumps stay ignored. Documentation
  and logs carry `[REDACTED]`, never a value. `scripts/check-instance-env.py` guards the instance.
- **Root `biome.json` is the single lint authority.** Run it against the paths you touched; the
  pre-commit hook runs it on the staged file with the binary pinned in `frontend/package.json`.
  Formatting is off (`formatter.enabled: false`), so lint never rewrites a file behind your back.
- **Generated files are generated.** `frontend/src/routeTree.gen.ts`, `frontend/worker-configuration.d.ts`
  and `frontend/.agents/skills/` are produced by their tools and excluded from lint. Never hand-edit
  them; regenerate instead.
- **Impeccable distributions are generated.** `.agents/skills/impeccable/` and
  `.claude/skills/impeccable/` are the repository-pinned Codex and Claude distributions; their bundled
  references are platform-specific. `.claude/agents/impeccable-*.md` supplies the Claude subagents.
  Update these through the Impeccable installer, not by hand; the skill bundles are excluded from
  Biome so the commit hook does not rewrite third-party generated files.
- **Documents stay beside what they describe.** Repository-wide claims and the ownership rules live
  in this file and `docs/`. Stack behaviour lives in that stack's `README.md`, `AGENTS.md` and design
  documents.

## Agent hooks

Hook *registration* is a repository-layer concern; hook *implementation* belongs to the stack whose
workflow it gates. Both agent tools discover project hooks relative to the directory a session treats
as its root, so the registration files live at the repository root:

| tool | registration | discovery |
|---|---|---|
| Codex (CLI and VS Code extension) | `.codex/hooks.json` | the session's project root. The extension shares `~/.codex`, so it uses the same discovery and the same trust ledger |
| Claude Code | `.claude/settings.json` | the session's primary working directory, so `frontend/.claude/settings.json` also applies to sessions started inside `frontend/` |

A Codex `.codex/hooks.json` nested in a stack directory is *not* inert — it is read when the agent is
started in that directory, and ignored from anywhere else. That inconsistency is the hazard, and this
repository has already been bitten by it: `~/.codex/config.toml` still carries trust entries for
`frontend/.codex/hooks.json`, which no longer exists. One root registration removes the question.

Both root registrations use `scripts/hooks/intent-dispatch.mjs` for the Intent gate, which decides
whether the event concerns the frontend and only then runs
`frontend/.intent/hooks/intent-*.gate.mjs`. Codex also calls the Impeccable detector after edits and on
Stop; its repo-pinned skill bundle is separate from the Intent gate. Frontend guidance therefore does
not arrive in a workflow, migration or nginx session, and an edit outside `frontend/` cannot be denied
by the TanStack gate. A session rooted outside `frontend/` gets a one-line pointer instead of the
catalog, so a frontend edit is never denied in a session that was never offered the skills.

### Checking hook state

```sh
./scripts/check-agent-hooks.py            # exit 1 if a registration or target is broken
./scripts/check-agent-hooks.py --verbose  # also every trust-ledger entry
```

It resolves each registered command the way the agent would, reports registration layers that only
apply sometimes, compares the hooks declared here against Codex's trust ledger, and sweeps that ledger
for every repository on the machine. Run it after moving a hook, changing a hook command, or editing a
stack's layout.

A registration file being present is not proof that a hook ran. Codex records trust as a hash of the
hook definition and skips untrusted or changed hooks; Claude Code requires workspace trust. The checker
verifies that trust is *recorded*, not that the recorded hash still matches — that canonicalisation is
not documented, so a hash mismatch is invisible to it.

## Commands

```sh
./scripts/setup-hooks.sh              # enable the one-file-per-commit guard
./scripts/workflows.sh --help         # import, run, export n8n workflows
./scripts/migrate.sh                  # apply db/migrations in order
cd frontend && npm run dev            # the app, Vite + workerd
```

`frontend/` has the rest of its own commands; see [`frontend/AGENTS.md`](frontend/AGENTS.md).
