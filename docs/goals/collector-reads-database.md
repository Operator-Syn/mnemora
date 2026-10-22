# The collector reads its state from the database

**Status:** implemented and demonstrated on 2026-10-21. Every acceptance condition passes, every
milestone is closed by a demonstration, and nothing in this document is deferred.
**Owner:** Yash. **Scope:** `collect-010-github-public-cache` only. `persist-010` is finished and verified.

## Why this exists

The database is now the product: 24 repositories and 6,993 commits live in `mnemora`, verified
against the cache file-for-file. The pipe that fills it is tested — replayed through the webhook
with zero GitHub calls, 24 files, 0 failures.

The collector has not noticed. It still decides what to fetch by reading
`/home/node/mnemora-data/public/*.json` in `Read Existing Cache` → `Extract Cached Records`, and
`Collect` compares `pushed_at` against those parsed records. Two sources now describe "what we
already have", and they can disagree:

- delete or corrupt the cache directory and the next run re-fetches everything, unaware that the
  database already holds 6,993 commits;
- the database can be rebuilt from files at any time, but the files cannot be rebuilt from the
  database — so the one that survives backups is the one nothing reads;
- `data_changed_at_utc` is computed by the persist workflow in SQL, while the collector also
  produces one; whoever writes last wins, and today that is silently the database.

This is the same drift that killed the idea of keeping `db/schema.sql` alongside migrations.

## What "end" means

Two different ends, stated separately because they get conflated.

### The end of a single run

A run is finished when every repository it decided to touch has been handed to `persist-010` and
the database agrees with what the run observed. Concretely, at exit:

1. every repository in the GitHub listing has a row in `mnemora_repositories`;
2. every repository not fetched this run has an unchanged `pushed_at_utc` and a **newer**
   `refreshed_at_utc` — a run that changes nothing still proves it looked;
3. every repository fetched this run has commit rows matching what GitHub returned, and any row
   for that repository that GitHub no longer returns is gone;
4. the run reports which repositories were skipped, which were fetched and why, and how many API
   calls it spent — from the run's own accounting, not from an estimate after the fact.

### The end of this implementation

The collector is done when it can be pointed at an **empty cache directory** and an **empty
database**, and still converge to the same state — because its decisions come from the database,
not from files. The cache stops being input and becomes an export.

That is the whole test: state comes from one place. If deleting `public/` changes what the
collector decides, this milestone is not finished.

## Acceptance conditions

Each is falsifiable and names how it is checked. None is satisfied by a workflow's own success
message; every one is read back from Postgres or from the GitHub API's own counters.

| id | condition | how it is checked |
|---|---|---|
| **AC-1** | State source is the database. With `public/` moved aside, a run still skips unchanged repositories. | `mv public public.bak`; run; expect 24/24 skipped and 0 commit fetches. |
| **AC-2** | Warm run cost is bounded. Nothing changed upstream → at most 2 API calls (listing + rate check). | Rate-limit counter before/after; commit rows still 6,993. |
| **AC-3** | Warm run is a no-op on content. `refreshed_at_utc` advances for all rows, `data_changed_at_utc` changes for none. | Two SQL queries before/after. |
| **AC-4** | Only moved repositories are fetched. A repository whose `pushed_at` did not move is never requested. | Status output plus per-repository `refreshed_at_utc` deltas; API call count ≈ 1 + changed. |
| **AC-5** | Records reach the database through the pipe, not through files. | Run with cache writing disabled; DB still updates. |
| **AC-6** | Pruning works on rewritten history. Insert a synthetic commit row for one repository, full-resync that repository, row is gone. | `insert` a fake sha → run → `select` returns nothing. |
| **AC-7** | **A partial fetch never prunes.** A record whose commit list is incomplete must not delete rows. | Send a payload with `source_state: "partial"` and one commit → prune count 0, rows intact. |
| **AC-8** | Pipe failure fails loudly and safely. Unpublished webhook → run errors naming the pipe; database untouched; re-publish + rerun converges. | Unpublish persist; run; inspect; publish; rerun. |
| **AC-9** | Collector credentials are read-only. It cannot write to the product database. | Attempt `insert` as the collector's role → `permission denied`. |
| **AC-10** | Cold convergence. Empty database + empty cache → full run reproduces 24 repositories and ≥6,993 commits. | Drop both, run, compare counts. |
| **AC-11** | Vanished repositories follow the recorded policy. | Delete a repository upstream (or fake the listing); policy applied and observable. |
| **AC-12** | Docs match behaviour: `WALKTHROUGH.md`, workflow `README.md`, `docs/automation/workflows.md` describe the database-first shape; nothing claims the cache is the product. | Read them; no stale sentence about cache-as-source. |

## Milestones

Each milestone ends in a demonstration, not a description. A milestone that cannot be
demonstrated stays open.

**M0 — Baseline (this document).** Record the numbers everything is compared against.
Exit: counts and timings written below, committed.

**M1 — Read path.** Add a Postgres read node in place of `Read Existing Cache` +
`Extract Cached Records`; `Collect` consumes rows instead of parsed files. Keep the file-write
branch intact so nothing is lost while the read path changes.
Exit: with cache present, a warm run skips 24/24 and fetches 0 commits, and the execution log
shows the database query. (AC-1 partly, AC-2, AC-3, AC-4.)

**M2 — Write path.** Add the HTTP call to `persist-010` after the record is built, one request per
repository. `Write Public Cache` keeps running as an export.
Exit: a live run for one changed repository updates the database; response counts match row deltas
read from SQL. (AC-5.)

**M3 — Cache demoted.** Remove the read branch entirely. Move `public/` aside and run.
Exit: AC-1 and AC-10 satisfy. This is the moment the cache stops being input.

**M4 — Pruning policy and vanished repositories.** Implement D3, and make prune conditional on
completeness.
Exit: AC-6, AC-7, AC-11.

**M5 — Hardening.** Read-only database role for the collector, execution timeout sized to a
measured cold run, overlap guard so a schedule tick cannot start a second run mid-flight.
Exit: AC-9, plus a measured timeout with headroom and a demonstrated rejection of a concurrent run.
**Landed:** read-only role (`mnemora_reader`); `executionTimeout: 900` against a 252 s cold run;
and the overlap guard as a database lease (`mnemora_run_lock`, migration `0003`). The acquire is a
single `INSERT ... ON CONFLICT DO UPDATE ... WHERE expired`, so two simultaneous runs cannot both
win — a read-then-write would leave exactly the window the guard exists to close. The collector
asks persist for the lease over the pipe and releases it when fetching finishes; a crashed run's
lease expires on its own.

**M6 — Documentation and honesty.** Update the walkthrough, the workflow README and the automation
docs; correct the README status section.
Exit: AC-12, and a final cold run from empty state recorded as the reference output.

## Decisions taken, and the ones needing your word

- **D1 — Payload granularity: one POST per repository.** A single 2.7 MB batch would make the run
  all-or-nothing and hard to retry; per-repository bodies are small, and a failure at repository
  twenty leaves nineteen persisted. Cost: 24 calls on the compose network, which is nothing.
- **D2 — Changed repository means full refetch in v1.** `Collect` already supports `since` +
  merge; keeping the merge while state moves to the database means two reconciliation rules to
  get wrong. Full refetch of a changed repository is self-correcting, and pruning removes
  whatever disappeared. Incremental comes later, if the call count ever justifies it.
- **D3 — Vanished repository: archived forever, never deleted.** *(Decided by the operator:
  "deleted repos to be archived, not deleted completely ... so the commits are still in there as
  like 'in memory of' state".)* A repository absent from its owner's listing gets
  `archived_at_utc` + `archived_reason`; its row and every commit stay. Nothing ages out, so
  there is no deletion path to get wrong. A repository that reappears is un-archived by the
  next run that sees it. Migration `0002_archive_repositories`.
- **D4 — `data_changed_at_utc` is owned by the persist workflow.** The collector stops sending a
  value that gets overwritten anyway. Single writer owns the derivation.
- **D7 — Telemetry is per repository, and gated at the endpoint.** `mnemora_telemetry` holds one
  row per repository per run; `debug-010-telemetry` serves it only with an `X-Mnemora-Token` header
  and queries as the read-only role. A leaked token exposes run history, not the database and not
  the ability to write.
- **D6 — Cold start is bounded, not all-at-once.** `COLLECT_010_MAX_NEW_PER_RUN` (default 12)
  caps how many never-collected repositories one run fetches; the rest become `pending` rows.
  The tradeoff is honest: a cold start takes more than one run, but each run is short enough to
  interrupt, and the database always shows what is still owed.
- **D5 — Keep writing the cache files.** They stay as an export and as the recovery path
  (`scripts/backfill.sh`). They just stop being consulted.

## Issues that will come along, and what to do about them

Ordered by how much damage they do if ignored.

**I-1 — A partial run could delete commits it failed to fetch. (Severity: data loss. Verified.)**
`Collect` stops when GitHub's quota reserve is hit, so a repository can end with an incomplete
commit list. Persist prunes anything not in the payload, so a partial list would erase the rest.
**Tested on 2026-10-21, not hypothesised:** a record with two commits written first, then the same
repository sent with one commit and `source_state: "partial"` returned `commits_pruned: 1` and the
other row was gone. The only reason this has not destroyed real data is that the collector does
not yet send anything.
Mitigation: persist prunes **only** when the record says the fetch completed. Until that rule
exists, AC-7 cannot pass and M4 does not close. This is the first change to make, ahead of the
collector rewire, because the rewire is what starts sending records.


**I-2 — Publishing is a separate step from importing, and import deactivates.** Re-importing the
persist workflow printed `Deactivating workflow`; an unpublished webhook returns 404 with
`webhook is not registered`, which looks like a wrong URL, not an un-deployed workflow.
Mitigation: the deploy recipe in `docs/automation/workflows.md` gets a publish step and a probe
POST that asserts a 200; `scripts/workflows.sh import` warns that publishing is still required.
**Done:** both. The recipe exists, and `import` now prints the draft/publish distinction, the
404-means-unpublished probe and the note that importing deactivates.

**I-3 — Node renames break expressions silently.** `$('Build Plan')` and `$('Collect')` are name
references. Renaming a node mid-rewire produces `undefined` at runtime rather than an error.
Mitigation: keep the eight existing names, and add a check that every `$('Name')` in the JSON
names an existing node before import.
**Done:** `scripts/check-workflow-refs.py`, run automatically by `scripts/workflows.sh import` and
refusing to import on failure. It checks two things: every `$('Name')` resolves, and no branch is
wired to an output index its node type does not have — the second check exists because that exact
mistake silently orphaned the cache export for a full run. Verified against deliberately broken
copies: renaming a node reports every reference to it; wiring `main[1]` on a Code node reports
`that branch will never run`.

**I-4 — The webhook URL inside the compose network is not the one in the browser. (Verified.)**
Host port is 5680; inside the network n8n listens on 5678 at service name `n8n`. Tested from the
worker container: `http://n8n:5678/webhook/mnemora-commits` reaches the workflow (HTTP 500 on an
invalid body, which proves execution), while `http://127.0.0.1:5680` fails outright — inside a
container that address is the container itself, not the host. Also: the worker image has no
`curl`, so every probe must use Node's `fetch` or n8n's `httpRequest` helper. Hard-code
`http://n8n:5678/webhook/mnemora-commits` in the collector and keep the host URL for your browser.


**I-5 — Reads and writes now share one database, and a slow query can stall a run.** The
collector gains a dependency it did not have. Mitigation: the read is a single `select` over 24
rows; measure it, and fail fast with a named error if the database is unreachable rather than
falling back to "no state" and re-fetching everything.

**I-6 — Two runs at once.** A schedule tick during a manual run would fetch the same repositories
twice and interleave writes. Mitigation: M5 overlap guard; before that, note it as expected
behaviour rather than pretending it cannot happen.

**I-7 — Timeout sizing.** A cold run measured 2m36s with ~95 calls. Adding 24 POSTs and a
database read pushes that up. Mitigation: measure the new cold run, then set `executionTimeout`
with explicit headroom rather than the default.

**I-8 — `collector-status.json` is written by `Collect`.** It is the only per-repository run
report. Removing it during the rewire loses observability exactly when it is needed.
Mitigation: keep writing it; treat it as derived, and consider a `mnemora_runs` table later.
**Done:** `mnemora_runs` (migration `0004`), written by a `Record Run` node at the end of the
pipeline. The status file stays as an export, but it was overwritten every run, so yesterday's
run left nothing behind; n8n's `execution_entity` is not a substitute either — it is pruned at
168 h and CLI executions never leave `running`.
Counts are read, not estimated: repository outcomes from the status item, commit numbers summed
from persist's per-record answers, API calls counted inside `Collect`.
Verified across a real cold start: run 1 recorded `fetched=12 pending=12 commits_seen=2278
api_calls=45`; run 2 recorded `fetched=12 skipped=12 pending=0 commits_seen=4715 api_calls=68`.

**I-9 — Denormalised `full_name` on commits.** A renamed repository keeps its `repository_id` and
changes `full_name`; commit rows carry the old name unless the upsert refreshes it. Mitigation:
persist already updates `full_name` on conflict — add a test for rename rather than assuming.
**Done:** tested. Same `repository_id` written first as `test/old-name`, then `test/new-name`:
the repository row moved and the denormalised `full_name` on its commit row moved with it.

**I-10 — Empty repositories.** A repository with no commits is legitimate; its record has
`commits: []` and `source_state: complete`, so pruning all of its commits is correct, not a bug.
Mitigation: state it, and test it so it is not "fixed" later by someone reading a zero as failure.
**Found and fixed:** the empty case could never reach the database. `Collect` reports
`source_state: 'empty'` when GitHub answers 409, but persist's validator only accepted
`complete | partial | error | stale`, so the first empty repository would have failed the whole
run *after* fetching everything. The validator now accepts `empty` (and `pending`), and `empty`
does not prune: a 409 after a repository previously had commits is ambiguous enough that deleting
on it would be a guess. Verified: a record with `source_state: empty` returned
`commits_pruned: 0` against a repository holding 2,889 commits.

## Criteria added during implementation

The rule: an issue discovered mid-implementation becomes a numbered acceptance condition in this
table in the same commit that fixes it. Criteria are never quietly dropped; if one stops being
valid, it is marked superseded with the reason.

| id | added | symptom found | criterion | status |
|---|---|---|---|---|
| **AC-13** | 2026-10-21 | Timestamps from Postgres (`2026-10-18 01:09:49+00`) never equal GitHub's ISO strings (`2026-10-18T01:09:49Z`), so `reuse()` was always false and every "skipped" repository was silently re-fetched in full — 24 repositories, ~95 calls per run. | A warm run with unchanged upstream must report `skipped` for every repository and finish in seconds, not minutes. | passing (7 s, 24/24 skipped) |
| **AC-14** | 2026-10-21 | Wiring a second branch to `main[1]` of a Code node orphaned the cache export: Code nodes have one output, so the export silently stopped running while the run reported success. | After any connectivity change, the cache export must be observed to run (status file mtime advances), not assumed. | passing |
| **AC-21** | 2026-10-21 | A run that behaved oddly left only an aggregate row: successful executions are not retained by n8n here, so nothing said *which* repository was slow, capped or failing. | Each run must record a per-repository outcome, and reading it must require authorization. | passing (24 rows/run; endpoint 403 without token, 200 with) |
| **AC-22** | 2026-10-21 | A `workflow.json` without a top-level `id` is **created as a new workflow** on every import. Editing the telemetry workflow produced a duplicate, and I published the old one — the fix appeared to do nothing while the database looked correct. | Every workflow file must carry its id, and the import must refuse one that does not. | passing (checker fails a file with no id) |
| **AC-20** | 2026-10-21 | Publishing is what arms a trigger; `active` in the database is not proof the scheduler registered anything. A schedule that never fires looks exactly like one that works, until the day you need it. | A published schedule must be observed firing, and the production interval must be verified afterwards. | passing (two `mode=trigger` executions 60 s apart, then 6 h restored and confirmed silent) |
| **AC-23** | 2026-10-22 | A failed run wrote **no row at all** — n8n keeps neither successful nor scheduled executions here, and the run row comes from the last node a failed run never reaches. The run book therefore showed only successes, and a failure looked identical to a schedule that had not fired. | Every run, successful or not, must leave exactly one row with an outcome, the failing node when there is one, and how it was started. | passing (run 1502: `status=error`, `note="failed in node \"Acquire Run Lock\": ... 404"`, `trigger_mode=schedule`, recorded with the pipe deliberately down) |
| **AC-24** | 2026-10-22 | A `trigger_mode` derived from `$execution.mode` cannot tell a schedule tick from a CLI run, and scheduled runs appear nowhere in the editor because successes are not stored. | The mode must come from which trigger node actually fired, and both paths must agree. | passing (two 1-minute ticks recorded `schedule`; a CLI run recorded `manual`; a failure recorded `schedule`) |
| **AC-25** | 2026-10-22 | GitHub's rate-limit window refreshes hourly, so a six-hourly collector is up to six hours stale for no saving. | Production schedule must be hourly, and an idle hour must cost one listing call. | passing (`Every Hour`, 1 h interval; idle runs recorded `api_calls=1`) |
| **AC-26** | 2026-10-22 | The page cap was a wall, not a budget: a repository needing more pages stopped at the cap, was marked `partial`, and the next run started at page 1 and stopped at the same page. It re-read the same pages every hour and could never reach the oldest commits — and `commit_count` was overwritten with the pages it happened to read. | A history larger than the per-run budget must finish over several runs from a stored cursor, keep an accurate count while incomplete, and prune exactly once when it completes. | passing (budget cut to 10 on a 2,889-commit repository: cursor 10 → 20 → complete over three runs; `commit_count` 2,889 = `count(*)`; a planted commit that no longer existed upstream was pruned on the next completed crawl) |
| **AC-27** | 2026-10-22 | Resuming at `cursor + 1` trusted a page number, but page numbers are positions: a force-push that shortens history shifts commits up, and the resume stepped over commits that were never fetched. | A resume must be anchored to a commit and must restart rather than skip when the anchor is gone. | passing (seeded bad boundary → `anchor-lost-restarted`, 8 calls, all 5 pages, 402 commits; real boundary → `anchor-holds`, 6 calls, pages 3–5 only) |
| **AC-28** | 2026-10-22 | Persistence happened only after `Collect` returned, so a task timeout lost the entire run's pages and every cursor with them. | Each repository's record must reach the database as soon as that repository finishes. | passing (three forced repositories appeared at 01:07:14, 01:07:34, 01:07:46 while the run was still executing) |
| **AC-29** | 2026-10-22 | The page cap was per repository, so one run could spend an unbounded amount of time across many repositories. | A run-wide page budget must bound execution time, with leftovers deferred and resumable. | passing (budget 5: one repository stopped at page 5 with a cursor, two reported `deferred`, `pages_spent: 5`; restored to 50, the next run resumed and completed it) |
| **AC-19** | 2026-10-21 | Run history lived only in a file that each run overwrote, so no question about past runs could be answered from the product database. | Every run must leave one queryable row with its own outcomes and cost, and rows must not overwrite each other. | passing (two consecutive runs produced two distinct rows) |
| **AC-17** | 2026-10-21 | A first run against an empty database fetched every repository in one burst (~95 calls, 252 s). Interrupted halfway, the database looked identical to a completed run with fewer repositories, and nothing recorded what was still owed. | A cold start must be bounded per run, resumable, and must leave uncollected repositories visible as such — never prunable, never indistinguishable from empty. | passing (2 runs: 12 collected + 12 pending, then the rest) |
| **AC-18** | 2026-10-21 | `scripts/workflows.sh import` only ever imported the first workflow file: `docker compose exec -T` inherits stdin, which was the `while read` list, so every later filename was swallowed. Silent, and it meant an edited workflow was never deployed. | Import must report every workflow it claims to import, and the count must match the files on disk. | passing (two `->` lines, two imports) |
| **AC-16** | 2026-10-21 | Two runs started at once would crawl the same 24 repositories twice; the second one's work is wasted and can push a run into the quota reserve. | A run must refuse to start while another holds the lease: non-zero exit within seconds, the holder named, nothing written. | passing (refused in 5 s, holder named) |
| **AC-15** | 2026-10-21 | Editing a workflow file does not deploy it. The persist fix for skipped records sat in `workflow.json` unpublished; the live version pruned all 6,993 commits when the collector sent its first skipped records. | Before running a producer against a consumer, assert the published version contains the guard, and prove it with a probe payload. | passing (gate probe: 0 pruned) |

## Implementation results (2026-10-21)

Every row below was read back from Postgres or from the workflow's own execution record. Where a
condition is not proven, it says so.

| id | result | evidence |
|---|---|---|
| AC-1 | **passing** | `public/` moved aside and recreated empty; run took 7 s, reported 24/24 `skipped`, commits unchanged. |
| AC-2 | **passing** | warm run 7 s; 6,993 commits before and after. |
| AC-3 | **passing** | `max(refreshed_at_utc)` advanced to the run's timestamp; `max(data_changed_at_utc)` stayed at 06:14:38. |
| AC-4 | **passing** | `collector-status.json` for the run: `Counter({'skipped': 24})`. |
| AC-5 | **passing** | records reached the database via `Save to Pipe` → `persist-010`; 54 persist executions recorded during testing. |
| AC-6 | **passing** | complete record minus one commit → `commits_pruned: 1`, row gone. |
| AC-7 | **passing** | partial record → `commits_pruned: 0`; the same payload that previously deleted a row now deletes nothing. |
| AC-8 | **passing** | persist unpublished → webhook 404, collector exit 1, `refreshed_at_utc` unchanged, 6,993 commits intact; after republishing, the next run succeeded in 7 s. |
| AC-9 | **passing** | `mnemora_reader` reads 24 rows; `insert` → `permission denied for table mnemora_repositories`; `-d n8n` → `permission denied for database "n8n"`. |
| AC-10 | **passing** | Product tables truncated, `public/` moved aside, run held a `pg_dump` safety net: 252 s later, **24 repositories / 6,993 commits** reproduced from GitHub alone, all 24 fetched in full. |
| AC-21 | **passing** | Idle run recorded 24 telemetry rows (`duration_ms` 0, nothing fetched); a forced full run recorded real timings — slowest `operator-synaciel` 36,106 ms. `GET /webhook/mnemora-telemetry`: 403 with no token, 403 with a wrong token, 200 with the right one. Query runs as `mnemora_reader` (SELECT only). |
| AC-22 | **passing** | Caught live: two `debug-010-telemetry` rows, one holding the fix and inactive. The intended workflow was given its id, re-imported, republished, and the duplicate archived. `check-workflow-refs.py` now refuses any `workflow.json` without an id. |
| AC-20 | **passing** | Interval temporarily set to one minute and published: executions 935 and 963 fired at 14:17:30 and 14:18:30, both `trigger`, both `success`, each writing a run row (`24 skipped`, `api_calls=1`). Restored to six hours, republished, and 75 s later zero executions had occurred. |
| AC-26 | **passing** | `COLLECT_010_MAX_COMMIT_PAGES=10` against `Operator-Syn/operator-synaciel` (29 pages): run 1654 stored cursor 10 (1,000 rows stamped), run 1682 cursor 20 (2,000 stamped), run 1710 completed — cursor cleared, `commit_count` 2,889 equal to `count(*)`, `commits_pruned=0`. A planted commit `deadbeef…` with an old crawl id was deleted on the next completed crawl (`commits_pruned=1`). Steady-state run afterwards: 24 skipped, `api_calls=1`. |
| AC-19 | **passing** | Two consecutive warm runs → two rows (`run_id` 793, 821), 24 skipped each, 1 API call each. A real cold start → `fetched=12 pending=12`, then `fetched=12 skipped=12 pending=0`, with commit counts 2,278 then 4,715 and API calls 45 then 68. |
| AC-17 | **passing** | Truncated both tables, cap 12: run 1 → 24 rows, 2,278 commits, 12 `pending`, 68 s; run 2 → 6,993 commits, 0 `pending`, 116 s. Nothing was pruned by a `pending` record. |
| AC-18 | **passing** | After detaching stdin, `import` printed both workflows and imported both; the reference checker runs first and refuses a broken file. |
| **AC-16** | **passing** | A second run is refused while one is in flight, within seconds, naming the holder, without touching the database. | Two real overlapping runs (the first forced into a 250 s full resync): the second exited 1 after 5 s with `another run holds the lease (run 487, expires ...)`. An externally held lease refused a run in 5 s too; releasing it restored an 8 s / 24-skipped run. |
| AC-11 | **passing** | planted `Operator-Syn/ghost-test` with one commit; run archived it (`absent from owner public listing`), kept the commit, and a second run changed nothing. |
| AC-12 | **passing** | `WALKTHROUGH.md` rewritten around the nine-node shape; workflow `README.md` and `docs/automation/workflows.md` updated, including a deploy section stating that importing is not publishing. |
| AC-13 | **passing** | see the criteria table: 7 s warm run with 24/24 `skipped`. |
| AC-14 | **passing** | export observed writing after the connection fix (status file mtime advanced). |
| AC-15 | **passing** | gate probe returned `commits_pruned: 0` for a skipped-style record; 6,993 rows intact. |

### What this cost, and what it taught

- The rewire produced **one real data-loss event**: 6,993 commits were deleted when the collector's
  first skipped records met an unpublished prune rule. Restored from the cache export in one
  command. The export is not decoration; it is the undo button.
- Two of the three new criteria (AC-13, AC-14) were invisible failures — the run reported success
  while doing the wrong thing. Only reading the database and the file mtimes exposed them.
- Attempted shortcut worth recording: publishing through the CLI (`n8n publish:workflow`) updated
  `workflow_entity.activeVersionId` but left `workflow_published_version` pointing at the old
  version, and the webhook stayed unregistered. Publishing through the n8n MCP tool updated both
  and took effect immediately.
- The first version of the lease SQL failed with `invalid reference to FROM-clause entry for table
  "mnemora_run_lock"`: inside `ON CONFLICT DO UPDATE` the target must be named by its alias. Found
  by running the statement directly against Postgres instead of guessing from a 500.

## Out of scope

Dashboard UI and reads; authenticating the webhook; private repositories; incremental `since`
fetching; activating the six-hour schedule; deleting cache files; anything about paid access.

## Baseline evidence (measured 2026-10-21)

| fact | value |
|---|---|
| repositories in cache and database | 24 (identical) |
| commits in cache and database | 6,993 (identical, per repository) |
| cold run | ~95 API calls, 2m36s, 2.70 MiB |
| warm run | 7 s, 1 listing call |
| pipe replay | 24 files, 0 failures, 0 GitHub calls |
| persist workflow | `NJ41NcmooiuniEuo`, published, webhook `POST /webhook/mnemora-commits` |
| collector workflow | `Nj4F0WC8e2SMHvfh`, 8 nodes, inactive |
