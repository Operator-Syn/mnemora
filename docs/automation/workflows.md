# Workflows: authoring, versioning, running

Status: first workflow implemented and executed (`collect-010-github-public-cache`). Written for n8n 2.44.5.

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

## Code lives in files, not in the JSON

A JSON string cannot contain a real newline, so a Code node body or a SQL query in `workflow.json`
becomes one escaped line — `collect.js` was 16,947 characters on a single line with `\n` throughout.
It parses, and it is unreviewable: no syntax highlighting, no comment alignment, and a diff that is
one line the length of the file.

So the manifest holds a marker and the code sits beside it:

```
workflows/collect-010-github-public-cache/
  workflow.json            "jsCode": "@file:code/collect.js"
  code/collect.js            405 readable lines
  sql/read-state.sql         the query, as SQL
```

| command | what it does |
|---|---|
| `./scripts/workflow_files.py build <dir>` | render markers into JSON (stdout, or `--out file`) |
| `./scripts/workflow_files.py split <dir>` | extract code/SQL strings into `code/` and `sql/` |

`import` builds first and imports the rendered file, so **n8n only ever receives generated JSON**;
`export` splits whatever came back, so a UI edit lands in the code files rather than in an escaped
line. The reference checker expands markers too, which is how `$('Node Name')` typos inside `code/*.js`
are still caught before import.

The round trip is verified, not assumed: after splitting, `build` must reproduce the previous
`workflow.json` exactly. It did for all three workflows — the first attempt did not, because the
split stripped a trailing newline, and the check caught it.

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

`workflows/collect-010-github-public-cache/workflow.json` — hourly, plus on-demand:

1. **Build Plan** reads `COLLECT_010_OWNERS`, `COLLECT_010_WINDOW_DAYS`, the optional token, and the fork/archived flags from the workflow's own `.env`.
2. **Read State** asks Postgres what is already collected, through the read-only `mnemora_reader` role: `repository_id`, `full_name`, `pushed_at_utc`, `commit_count`, `source_state`, `archived_at_utc` and languages per repository. This replaced the two file-reading nodes. The cache files are no longer an input, so deleting them changes nothing about what a run decides. An unreachable database fails the run rather than being read as "nothing collected".
3. **Collect** lists every **public** repository of those owners through `/users/:owner/repos`, then decides per repository: `skipped` when `pushed_at` matches the database row (zero requests), `full` when it moved, is new, or the history mode changed. A repository is re-fetched in full rather than merged — the commits are rows now, and prune-on-complete removes what vanished after a rewrite. `COLLECT_010_WINDOW_DAYS=0` means full history.
4. **Collect posts each record** to the persist webhook at `http://n8n:5678/webhook/mnemora-commits` as that repository finishes (three attempts, two seconds apart). If a record cannot be persisted the run fails: data that was collected and never stored must not report success. Posting inside the loop is deliberate — a task timeout then costs at most the repository in flight, instead of the whole run's work.
5. **To JSON File → Write Public Cache** writes the same records to `public/github-public-cache__<owner>__<repo>.json` as an **export**, and `collector-status.json` per run. Derived, replayable with `scripts/backfill.sh`, deletable.

Measured: cold start with an empty database and empty cache = 24 repositories / 6,993 commits in **4 m 12 s**, ~95 requests; warm run with nothing changed = **7 s**, 24/24 `skipped`, zero commit requests.

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

- **Published and active** (2026-10-21). The six-hour schedule fires on its own: verified by
temporarily setting the interval to one minute, watching two `mode=trigger` executions fire exactly
60 s apart, then restoring the real interval — after which no further ticks occurred. Each tick costs one
listing call when nothing moved, and writes a row to `mnemora_runs`.
- **Nothing prunes or archives yet at the workflow level** — that is `persist-010`'s job, and it is implemented: prune only on complete records, archive vanished repositories rather than deleting them.
- Overlap is guarded by a database lease: a second run fails within seconds, naming the holder, instead of crawling twice. `executionTimeout` is 900 s against a measured 252 s cold run.
- A GitHub token exists and is required in practice: anonymous access is 60 requests/hour, which one cold run exceeds.
- Commit pagination runs to the end of history (`COLLECT_010_MAX_COMMIT_PAGES` caps it; hitting the cap marks the record `partial`). No retry/backoff for `202 Accepted` statistics endpoints.
- The dashboard is unbuilt. The database it will read is populated and verified.

## Telemetry, and how to read it

Successful executions are not retained by n8n in this stack (`EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`),
so a run that behaved oddly leaves only its aggregate row. Two things fix that:

- `mnemora_runs.trigger_mode` — `schedule`, `manual` or `production`: which trigger actually fired.
  Necessary because n8n retains neither successful nor scheduled executions here, so without it a
  scheduled run and an editor click are indistinguishable.
- `mnemora_telemetry` — one row per repository per run: mode, state, pages fetched, commits,
  `duration_ms`, and the verbatim `source_error`. Written by `persist-010` from the collector's own
  report, in the same statement as the run row, so a run cannot appear without its detail.
- `debug-010-telemetry` — an authenticated `GET /webhook/mnemora-telemetry` returning recent runs,
  recent non-`complete` outcomes, the slowest repositories of the last seven days, and a health
  block. `403` without the `X-Mnemora-Token` header; the query runs as `mnemora_reader`, which can
  only `SELECT`.

```sh
TOKEN=$(grep '^MNEMORA_TELEMETRY_TOKEN=' .env | cut -d= -f2)
curl -s -H "X-Mnemora-Token: $TOKEN" http://127.0.0.1:5680/webhook/mnemora-telemetry | jq .health
```

What to look at first when something is wrong: `health.last_run_age_seconds` (is it running at all?),
`health.not_complete` (is anything stuck?), then `recent_issues` for the verbatim error.

## Two ways a resumable crawl could still lose data

**Skipping commits after a rewrite.** Pages are positions in a mutable list. If commits are added at
the top, positions shift down and resuming re-covers a few already-seen commits — harmless, they are
deduped by sha. If history is force-pushed **shorter**, positions shift up and resuming at the old
cursor steps over commits. The crawl now stores `commit_boundary_sha` (the oldest commit it has
confirmed) and, before resuming, re-reads the cursor page to check it is still there. Present → resume.
Absent → start a new crawl at page 1 rather than skip anything.

Measured on `Operator-Syn/peer-tutoring-platform` (5 pages, 402 commits):

| seeded state | attempts | calls | outcome |
|---|---|---|---|
| boundary sha that is not on page 3 | `anchor-lost-restarted` | 8 (listing + anchor + languages + all 5 pages) | complete, 402 |
| real boundary at the end of page 2 | `anchor-holds` | 6 (listing + anchor + languages + pages 3–5) | complete, 402, 202 seen |

The anchor is a commit, not the branch head: the head changes whenever anything lands and would force
a pointless restart, while new commits at the top cannot cause a skip.

**Losing a run's pages to a timeout.** Posting per repository bounds the loss. A run-wide page budget
(`COLLECT_010_MAX_PAGES_PER_RUN`, default 50 across *all* repositories) makes it unlikely in the first
place: with ~1.2 s per page the spend is bounded well under the 600 s task timeout. Repositories left
over are reported `deferred` and cost nothing; one caught mid-crawl keeps its cursor.

Verified with the budget cut to 5: `arqen` stopped at page 5 with a cursor, `nixos-workstation` and
`peer-tutoring-platform` were reported `deferred`, and the status file recorded
`pages_spent: 5, budget: 5`. Restored to 50, the next run resumed `arqen` from page 6
(`anchor-holds`) and completed it at 1,109 commits.

## A crawl that can be resumed

`MAX_COMMIT_PAGES` used to be a wall, not a budget: a repository needing more pages than the cap
stopped there, was marked `partial`, and the next run started at page 1 and stopped at the same
page. It re-read the same pages every hour and never reached the oldest commit — the unit of
progress was the entire repository, all or nothing.

A crawl is now a named thing that can span runs:

| column | meaning |
|---|---|
| `mnemora_repositories.commit_crawl_id` | the open crawl; null when it finished |
| `commit_page_cursor` | last page fetched; the next run starts at cursor + 1 |
| `mnemora_commits.last_seen_crawl_id` | which crawl last confirmed each commit |

The cap became a **per-run** budget, so page 51 is reachable on a later run even though the budget
is 50. Completion is decided by a short page (fewer than 100 commits), which means "reached the
oldest commit". Only then does the database prune: every row whose `last_seen_crawl_id` is not this
crawl is deleted, while rows confirmed by earlier runs of the same crawl survive. That replaces
"send the whole history in one payload" as the condition for pruning, which also removes the memory
ceiling that came with it.

Verified end to end on `Operator-Syn/operator-synaciel` (2,889 commits, 29 pages) with the budget
temporarily cut to 10:

| run | cursor after | rows stamped | state | pruned |
|---|---|---|---|---|
| 1654 | 10 | 1,000 | partial | 0 |
| 1682 | 20 | 2,000 | partial | 0 |
| 1710 | cleared | — | complete | 0 |

`commit_count` came out at exactly 2,889, the same as `count(*)` for that repository, and a planted
commit that no longer existed upstream was deleted on the next completed crawl (`commits_pruned=1`).

## Recording failures, not just successes

A run that fails used to leave **nothing** in `mnemora_runs`: n8n does not retain successful
executions here, and the run row is written by the last node — which a failed run never reaches. The
table therefore showed only the runs that went well, and "was it successful?" could only be answered
by the absence of a row, which is the same signal as "the schedule is not firing at all".

`notify-010-run-failures` is attached as the collector's `errorWorkflow`. On failure it writes a row
with `status = 'error'` and the failing node named:

```
failed in node "Acquire Run Lock": Request failed with status code 404
```

Two things about it are load-bearing:

- **It writes to Postgres directly**, not through the write pipe. The first version posted to the
  pipe and recorded nothing the moment the pipe was down — the exact failure it exists to report.
- **It must be published.** n8n refuses to invoke an unpublished error workflow; the log says
  `Workflow "<id>" is not active and cannot be executed` and the failure goes unrecorded. This is the
  one workflow whose silence is indistinguishable from "nothing failed".

It also **releases the failed run's lease**. A run that dies never reaches `Release Run Lock`, so its
lease survives to the TTL and every tick in the window is refused with `another run holds the lease`.
One transient DNS failure (`EAI_AGAIN`) therefore produced three failures: the crash, then two
refusals. The delete is scoped to that execution's `run_id`, so a lease held by a *live* run is never
cleared.

Counts in an error row are `null`, never `0`: the run died before it knew them, and zero would read
as "looked at nothing and found nothing".

## Importing a workflow from a URL

The editor's "Import from URL" is removed in n8n 3.0. The capability lives in the script instead,
with a check the menu never had:

```sh
./scripts/workflows.sh import-url <url> [--save <dir>] [--yes] [--print-url]
```

A workflow is code that runs with this instance's environment and credentials, so the import prints
what the file would be able to do before it lands:

```
This workflow (some-workflow, 2 nodes) would be able to:
  - node 'Shell' runs shell commands in the container
  - reads environment variables (every variable in the container is visible)
  - references credential 'GitHub' (it will need to exist here)

Refusing to import without --yes. Verify the source before granting this.
```

`--save` writes the file into `workflows/<dir>/` with a README recording the source URL, the import
time and the n8n id. The id matters: without it, every import creates a *new* workflow, which is how
an edit can silently land on a duplicate while the real one keeps running the old version.

## Linting the Code-node bodies

`Code` nodes hold real JavaScript in `code/*.js`, so it should be linted like code. It cannot be
linted naively: n8n runs each body inside its own wrapper, which makes top-level `return` and
`await` legal there — and a plain parser reports

```
× Illegal return statement outside of a function
```

for all eight files, then stops looking. The first audit produced eight of those and would have
concluded "eight broken files"; the truth was 24 findings in five files that the parse errors were
hiding.

`scripts/check-js-lint.py` wraps each body in `async function __n8nCodeNode() { … }`, lints the
result with Biome, and maps line numbers back. It fails on **warnings** as well as errors
(`--error-on-warnings`), because every finding in this codebase is the actionable kind.

```
./scripts/check-js-lint.py          # report
./scripts/check-js-lint.py --fix --unsafe   # apply fixes, unwrapping the body back into the file
```

`biome.json` declares the n8n globals (`$input`, `$json`, `$`, `$execution`, `$env`, …) so they are
not reported as undeclared, and leaves the formatter off: formatting these files is a separate
decision from linting them.

It is wired into `./scripts/workflows.sh check` and blocks `import` for the same reason the other
gates do — a body that cannot parse is a body that will fail at runtime.

## Importing disarms production, and that is not obvious

`n8n import:workflow` writes a **draft** and **deactivates** the workflow it touches. Every import is
therefore a small outage: schedules stop firing and webhooks answer `404`, with no error anywhere
except the executions that quietly fail to happen.

Four workflows were left disarmed by exactly this, twice in one evening — the pipe was down because
`persist-010` was imported and never republished, and that surfaced as unrelated-looking failures.

The CLI cannot fix it. `n8n publish:workflow` prints *"restart n8n for changes to take effect"* and a
live instance keeps answering `404` afterwards (measured: unpublished → `404`, CLI republished →
still `404`). Publishing is an editor/API action, so it is a human or agent step.

Two guards now exist:

- `./scripts/workflows.sh import` records what was armed before it ran and prints a **DISARMED** list
  afterwards, naming each workflow and how to republish it;
- `./scripts/workflows.sh status` shows `active` / `published` / verdict per workflow, and exits
  non-zero if any is half-enabled (`armed`, `idle`, `BROKEN`).

The rule: after any import, run `status` and make it say `armed` for everything that should be live.

## Deploying a workflow change

Importing a file is not deploying it. n8n 2.x separates a **draft** from a **published version**:
a draft runs when you click "Execute workflow", but only a published version fires schedules and
answers webhooks. Importing *deactivates* the workflow, and an inactive webhook returns `404` with
`The requested webhook "POST ..." is not registered` — which reads like a wrong URL rather than an
undeployed workflow.

```
edit workflows/<name>/workflow.json
./scripts/workflows.sh import          # draft only; publishing is still required
publish                                # required for any trigger to fire
probe the trigger                      # a 200, not an assumption
```

To publish from the n8n MCP connection: enable **MCP access** on the workflow (Settings), then call
`publish_workflow`. Each workflow records `availableInMCP: true` in its own `workflow.json`
settings, so a re-import keeps that enabled.

**Do not use `n8n publish:workflow` from the CLI.** It updates `workflow_entity.activeVersionId`
but leaves `workflow_published_version` pointing at the previous version, and the webhook stays
unregistered while the database looks correct. Publishing through the MCP tool updates both tables
and takes effect immediately.

Verify, do not assume:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:5680/webhook/mnemora-commits
# 500 = the workflow ran and rejected an empty payload. 404 = not published.
```
