# Workflows: authoring, versioning, running

Status: first workflow implemented and executed (`collect-010-github-public-cache`). Written for n8n 2.44.4.

## Naming

`<category>-<NNN>-<descriptive-name>`, e.g. `collect-010-github-public-cache`.

- **category** — what the workflow does: `collect`, `publish`, `notify`, `sync`.
- **NNN** — zero-padded priority for sort order. Numbering **restarts per category**,
  so `collect-010` and `publish-010` can coexist; within a category the numbers are
  unique and express intended run order.
- **descriptive-name** — kebab-case, says what it produces rather than what it reads.

The n8n workflow name is **identical** to the directory name, so `workflows.sh run`
takes the folder name verbatim and a `$('Node')` reference, a DB row and a directory
all agree. Environment variables follow the same tag: `<CATEGORY>_<NNN>_<SETTING>`
(`COLLECT_010_OWNERS`), which keeps them traceable to the directory and unique across
workflows sharing one container namespace.

## Git is the source of truth, not the n8n volume

One directory per workflow, because there will be more than one and each carries its own configuration:

```text
workflows/
  collect-010-github-public-cache/
    workflow.json     definition (source of truth)
    .env.example      committed template for this workflow's settings
    .env              local values, gitignored
    README.md         purpose, boundary, how to run
```

`workflow.json` is a fixed name so tooling can glob `workflows/*/workflow.json`. Editing in the browser UI is fine, but export and commit afterwards, or the change exists only in a Docker volume.

```sh
./scripts/workflows.sh import              # every workflows/*/workflow.json -> n8n
./scripts/workflows.sh export              # running n8n -> each workflow directory
./scripts/workflows.sh run collect-010-github-public-cache
```

Rules that keep the two sides from diverging:

- Each JSON file carries its own `id`. Without it, import creates a duplicate workflow instead of updating the existing one; `import` prints the database count so a duplicate is visible immediately.
- Never edit the same workflow in the UI and in the JSON at once. The last import wins, silently.

## Workflow configuration belongs to the workflow

The root `.env` configures the **stack**: images, ports, secrets, timezone, worker concurrency. A workflow's own settings live next to it and reach the container through Compose's `env_file`, declared once as an anchor and shared by both executing services:

```yaml
x-workflow-env: &workflow_env
  - path: ./workflows/collect-010-github-public-cache/.env
    required: false

services:
  n8n:
    env_file: *workflow_env
  worker:
    env_file: *workflow_env
```

- `env_file` injects values literally; it does not interpolate. These are container environment variables, which is exactly what a Code node reads via `$env`.
- `required: false` keeps a fresh clone working before anyone copies `.env.example` to `.env`; the workflow's own defaults then apply.
- Adding a workflow means one more entry in that single anchored list — not one edit per service. Compose has no glob syntax for `env_file`, so paths stay explicit.
- **Name variables `<CATEGORY>_<NNN>_<SETTING>`.** All injected files share one container namespace, so two workflows using `REPO_LIST` would silently collide, and the later file in the list wins.

## Why commands run in a throwaway container

`n8n execute` and `n8n import:workflow` cannot run inside the live `n8n` service: the task broker already holds port 5679, so the CLI exits with "port already in use". The helper script starts a one-off container on the same volumes and network instead, with `N8N_RUNNERS_ENABLED=false`.

## CLI execution needs a manual entry point

`n8n execute` refuses a workflow whose only trigger is a schedule: "Missing node to start execution". Add an **Execute Workflow Trigger** node (`n8n-nodes-base.executeWorkflowTrigger`) and wire it to the first step. It does not fire on activation; it exists so the workflow can be run on demand or called by another workflow.

The trigger requires at least one defined input field. An empty `parameters: {}` fails with "At least one field is required".

## Queue mode changes where side effects land

The main instance creates executions; **workers run them**. Anything a workflow writes must therefore exist on the worker:

- Volumes for data a workflow writes must be mounted on `worker`, not only on `n8n`.
- `collector_data` is mounted on both at `/home/node/mnemora-data`, with `public/` and `private/` created by the one-shot `cache-init` service. Separate directories are the v1 boundary from `trust/security-privacy.md`.
- Verify by writing from a run and checking the file in the worker container, not on the host.

## Two settings that make `.env` able to drive workflows

| Setting | Value | Why |
|---|---|---|
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | `false` | Otherwise Code and expression nodes cannot read any environment variable ("access to env vars denied"), so `.env` could not configure a workflow. Tradeoff: every workflow can then read every variable in the container, including `N8N_ENCRYPTION_KEY`. Acceptable for a single-operator instance that only runs workflows from this repository; revisit before importing third-party workflows. |
| `N8N_RESTRICT_FILE_ACCESS_TO` | `/home/node/mnemora-data` | Read/Write Files is confined to an allowlist. `~/.n8n` stays blocked by default; paths outside the allowlist fail with "Access to the file is not allowed". |

## The implemented workflow

`workflows/collect-010-github-public-cache/workflow.json` — every 6 hours, plus on-demand:

1. **Build Plan** reads `COLLECT_010_OWNERS`, `COLLECT_010_WINDOW_DAYS`, the optional token, and the fork/archived flags from the workflow's own `.env`.
2. **Read Existing Cache** + **Extract Cached Records** load the files already on disk. The split is required, not decorative: n8n stores binary payloads in the database, so a Code node receives a reference rather than bytes, and `Extract From File` nests the parsed record under `json.data`.
3. **Collect** lists every **public** repository of those owners through `/users/:owner/repos`, then decides per repository: `skipped` when `pushed_at` is unchanged (zero requests), `incremental` when it moved (only newer commits, merged and deduped by sha), `full` when there is no usable cache. A missing cached head means history was rewritten, so that repository falls back to `full`. `COLLECT_010_WINDOW_DAYS=0` means full history; a positive value keeps a rolling window.
4. **To JSON File** emits one file per repository; **Write Public Cache** writes `public/github-public-cache__<owner>__<repo>.json`.

Measured: cold run 24 repos / 6,993 commits = 2 m 36 s and ~95 requests; warm run with nothing changed = **7.7 s**; one changed repo = 9.3 s.

Scope is every public repository, discovered — not a hand-maintained allowlist. The public listing endpoint never returns private repositories, so private work is unreachable by construction. A repository made public enters the cache within one run, with no config change.

### Cache filenames

`github-public-cache__operator-syn__arqen.json` — computed once in the `Normalize`
node and echoed into the record as `cache_file`, so the file describes itself.

- **Stable, not timestamped.** The dashboard needs one address per repository. A
  timestamped name forces the reader to glob and sort on every request, and leaves a
  new file behind on every run. Freshness lives inside the record as
  `refreshed_at_utc`, where it travels with the data instead of being asserted by a
  filename that a copy can outlive.
- **Owns the full identity.** Owner *and* repository, because `arqen.json` would let
  `ownerA/arqen` and `ownerB/arqen` overwrite each other. Lowercased (GitHub logins
  are case-insensitive) and `/` becomes `__` (not a legal filename character).
- **No workflow tag.** The cache is data, not an artefact of `collect-010`; renumbering
  the workflow must not orphan the files a dashboard expects.

If snapshot history is ever wanted, that is a second concern — an `archive/` path with
timestamped copies — not a change to the live cache's name.

Two honest labels are deliberate and should not be "fixed":

- `commit_count_definition` states that the number is commits returned by the API for the period, not an authored-contribution count. Bot authors and merges are included; a real run on `Operator-Syn/arqen` returned `github-actions[bot]` as the newest author.
- `source_state` becomes `partial` when the 100-commit page limit is hit, rather than presenting a truncated window as complete.

## Not done yet

- `active` is `false`. The schedule does not fire until the workflow is activated, which starts recurring outbound collection and should be an explicit decision.
- No GitHub App or token, so collection is rate-limited and public-only.
- No pagination beyond the first 100 commits; no retry/backoff for `202 Accepted` statistics endpoints.
- Nothing reads the cache yet; the dashboard is unbuilt.
