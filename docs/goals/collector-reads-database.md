# The collector reads its state from the database

**Status:** proposed, not started. M0 (this document) is the only artifact.
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
- **D3 — Vanished repository: mark, then delete after 30 days.** *(Needs your nod.)* A repository
  absent from the listing gets `source_state = 'missing'` and is excluded from the dashboard;
  after 30 days of absence its row is deleted and commits cascade. Deleting immediately loses
  history you may still want to show; keeping forever shows ghosts.
- **D4 — `data_changed_at_utc` is owned by the persist workflow.** The collector stops sending a
  value that gets overwritten anyway. Single writer owns the derivation.
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

**I-3 — Node renames break expressions silently.** `$('Build Plan')` and `$('Collect')` are name
references. Renaming a node mid-rewire produces `undefined` at runtime rather than an error.
Mitigation: keep the eight existing names, and add a check that every `$('Name')` in the JSON
names an existing node before import.

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

**I-9 — Denormalised `full_name` on commits.** A renamed repository keeps its `repository_id` and
changes `full_name`; commit rows carry the old name unless the upsert refreshes it. Mitigation:
persist already updates `full_name` on conflict — add a test for rename rather than assuming.

**I-10 — Empty repositories.** A repository with no commits is legitimate; its record has
`commits: []` and `source_state: complete`, so pruning all of its commits is correct, not a bug.
Mitigation: state it, and test it so it is not "fixed" later by someone reading a zero as failure.

## Criteria added during implementation

The rule: an issue discovered mid-implementation becomes a numbered acceptance condition in this
table in the same commit that fixes it. Criteria are never quietly dropped; if one stops being
valid, it is marked superseded with the reason.

| id | added | symptom found | criterion | status |
|---|---|---|---|---|
| — | — | none yet | — | — |

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
