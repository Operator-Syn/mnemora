# How this workflow works — a plain-language walkthrough

For reading end to end, without needing to hold the code in your head. The node-by-node version
of this is inside the workflow itself: every node carries a **Notes** field, so opening it in the
n8n canvas shows the same explanation in place.

## In one paragraph

When you click run — or every hour once activated — the workflow asks GitHub for the public
repositories belonging to your account, reads each one's languages and commit history, and hands
the result to `persist-010`, which is the only thing that writes to the database. The database is
the product; a dashboard will read it. The workflow also writes one JSON file per repository, but
that is an **export**, not the source: delete it and the next run still knows exactly what it has.
That is the whole job: **discover repositories, describe each one, hand them over.**

## The shape of it

```
  [Manual Run]  ─┐
                 ├─→ [Build Plan] → [Read State] → [Collect] ─┬─→ [Record Run]
  [Every Hour]┘        │              │            │       │                         ↓
                       settings      Postgres      GitHub     │                  persist-010
                                     (read-only)     API       └─→ [To JSON File] → [Write Public Cache]
```

Two starts, one path through, so a manual run and a scheduled run cannot diverge.

Two branches leave `Collect`, and the reason matters:

- **up** — records go to the persist workflow, which owns every write to `mnemora`.
- **down** — the same records are written as files, which are an export, not a source.

`Read State` reads the database through a **read-only** role. It cannot write even if a query is
wrong, and it cannot open n8n's own database at all.

## Step 1 — something starts it

| start | when |
|---|---|
| **Manual Run** | you click "execute workflow" in n8n, or run `./scripts/workflows.sh run collect-010-github-public-cache` |
| **Every Hour** | on the clock, but only once the workflow is **published and active** |

Nothing happens until one of these fires. Importing the workflow does not start it: it arrives
inactive, because activation is the moment it begins making outbound requests on its own.

## Step 2 — Build Plan: read the settings, touch nothing

This step reads `.env` and answers: which accounts to look at, how much history (all of it, or the
last N days), how many commit pages each run may spend, whether forks and archived repositories
count, and whether there is a GitHub token to authenticate with.

It makes **no network calls**. That is deliberate. A malformed setting — an empty account list, a
nonsense number — fails here in a fraction of a second with a message naming the variable. The
alternative is discovering it ninety seconds into a crawl of twenty-four repositories.

## Step 3 — Read State: what does the database already know?

```sql
select repository_id, full_name, pushed_at_utc, commit_count, source_state,
       source_error, history, default_branch, data_changed_at_utc, archived_at_utc,
       languages_bytes
from mnemora_repositories
order by full_name;
```

This replaced the two nodes that used to read and parse the cache files. The question the
collector needs answered is "has this repository moved since I last looked", and `pushed_at_utc`
answers it directly — no file reading, no parsing, and no second source of truth to drift.

An empty result means a genuine cold start. A failure stops the run: treating an unreachable
database as "nothing collected" would re-fetch everything and burn the API budget.

## Step 3b — Acquire Run Lock: one crawl at a time

Before a single GitHub request, the run claims a lease in the database. If another run already
holds it, this fails immediately with the holder's id and expiry:

```
collector: another run holds the lease (run 487, expires 2026-10-21T13:09:24Z).
Refusing to duplicate the crawl.
```

The claim is atomic — one `INSERT ... ON CONFLICT DO UPDATE ... WHERE expired` — so two runs
starting in the same second cannot both win. The lease is released as soon as fetching finishes,
and expires by itself if a run dies, so a crash costs at most `COLLECT_010_RUN_LOCK_TTL_SECONDS`
(900 s by default, well under the six-hour schedule and above a 252 s cold run).

`COLLECT_010_RUN_LOCK=false` turns the whole thing off, deliberately.

## Step 4 — Collect: the actual work

One pass, three movements.

**1. Compare, per repository.** Every repository falls into one of two cases:

| situation | what happens | cost |
|---|---|---|
| `pushed_at` has not moved, same branch, same history mode | nothing is fetched | **zero requests** |
| moved, new, or forced | the whole history is fetched again | one request per 100 commits |

A changed repository is re-fetched **in full** rather than merged. Merging is the database's job
now: commits are rows, and prune-on-complete keeps them honest after a force-push. The
incremental `since` path is switched off in this version for exactly that reason — two
reconciliation rules is one rule too many.

**2. Fetch.** For each repository that needs it: the language byte counts, then commits 100 at a
time until GitHub returns fewer than 100 — that is how "the end of history" is detected.
`operator-synaciel` needs 29 pages, which fits inside one run's budget of 50. The run watches
GitHub's remaining quota in response headers and stops spending at `COLLECT_010_RATE_RESERVE`,
marking the rest `deferred` instead of failing each one.

**A history bigger than the budget does not fail — it continues.** Spending the page budget stores
`commit_page_cursor`, and the next run starts at `cursor + 1` rather than page 1. The crawl id
travels with every commit row it touches, so when a crawl finally reaches a short page the database
can delete exactly the rows that crawl did not confirm, including rows from an earlier crawl.

**3. Report.** Every repository produces a record, including the skipped ones — with
`commits_omitted: true` — so the database learns it was checked and advances `refreshed_at_utc`
without touching a commit row.

Two comparisons here look trivial and are not:

- **Timestamps are compared as instants, not strings.** Postgres renders `2026-10-18 01:09:49+00`;
  GitHub sends `2026-10-18T01:09:49Z`. Comparing those as text is always false, which turned every
  "skipped" into a full refetch while the run still reported success.
- **Archive detection uses every id the listing returned**, including forks and archived
  repositories the filters drop. Comparing against the filtered list would archive a repository
  merely because a filter excluded it.

Why this is a single node rather than a chain of one-node-per-repository: an earlier version read
"the first item" at several points, which meant a two-repository allowlist produced one file and
reported success. A single loop over a list cannot skip an entry without also failing loudly.

### Cold start

A repository the database has never seen is the expensive case: there is nothing to compare
against, so its whole history is fetched. Doing that for every repository in one run is a burst —
and an interrupted burst leaves a database that looks finished but holds half the account.

`COLLECT_010_MAX_NEW_PER_RUN` (default 12) caps it. Past the cap, a repository is written with
`source_state = 'pending'` and no commit list: it exists, so the dashboard can say "not collected
yet" instead of "empty"; it cannot be pruned, because only `complete` records prune; and the next
run treats `pending` exactly like new. A 24-repository cold start completes in two runs, and each
one is safe to kill.

## Step 5 — posting, inside Collect

There is no separate posting node. `Collect` posts each repository's record to the pipe the moment
that repository finishes, retrying three times two seconds apart, and keeps the answers to total them
for the run summary. The reason is the task timeout: anything still queued in a node's return value
when it is killed is lost, including the resume cursors of repositories that were already fetched.

## Step 7 — the export

`To JSON File` turns each record into bytes, `Write Public Cache` saves it, filenames come from
each record's own `cache_file` field, and `collector-status.json` records what the run did per
repository.

Deleting the export is safe. It exists so the data can be replayed into any database with
`./scripts/backfill.sh` — which is how a 6,993-commit table was restored after a pruning bug
emptied it in October 2026.

One deployment detail that matters: in queue mode the **worker** performs this write. That is why
the cache volume is mounted on both services. Mount it only on the main container and every file
lands in the worker's throwaway layer, appearing to work until the next restart.

## A worked example

Run against `Operator-Syn/arqen`:

| | |
|---|---|
| repositories found | 24 (every public repo) |
| commits fetched for `arqen` | 1,109 across 12 pages |
| oldest commit seen | 2026-09-10 |
| status | `complete` |
| cold run, empty database and empty cache | 24 repositories, 6,993 commits, 252 s |
| warm run, nothing changed | **7 s**, 24/24 `skipped`, zero commit requests |

## The status field, and why it is not always "fine"

Every record says how much to trust it. None of these is a crash; they are honest labels.

| status | meaning |
|---|---|
| `complete` | the whole history was read and nothing failed |
| `partial` | a sub-request failed, or the page budget was spent; `source_error` says which, and `commit_page_cursor` says where the next run resumes |
| `empty` | the repository genuinely has no commits (GitHub answers 409) — a real state |
| `error` | the commits could not be read at all |
| `stale` | the fetch failed but earlier data is still valid |

Only a **finished** crawl prunes, and it prunes by sweep: rows whose `last_seen_crawl_id` is not
that crawl are deleted, while rows confirmed by earlier runs of the same crawl survive. A `partial`,
`stale` or skipped record never deletes anything, and neither does a record whose `commits_omitted`
is set — that rule exists because breaking it once deleted every commit in the database.

The one-shot variant still exists for `scripts/backfill.sh`: a legacy full payload, marked
`complete` with `commits_omitted` false and carrying no crawl id, prunes whatever it does not list.

`commit_count` carries `commit_count_definition` next to it, because the number is not what people
assume: it counts commits returned by the API for the default branch, including bot authors and
merges. On `arqen` the newest commit is authored by `github-actions[bot]`. It measures repository
activity, not a person's work.

## When something looks wrong, look here first

```sh
# what the last runs did
docker compose exec -T postgres psql -U n8n -d n8n \
  -c 'select status, "startedAt" from execution_entity order by "startedAt" desc limit 5;'

# what the database believes, which is what the dashboard will show
docker compose exec -T postgres psql -U mnemora_app -d mnemora \
  -c 'select count(*) as repos, (select count(*) from mnemora_commits) as commits from mnemora_repositories;'

# the collector's own per-repository report
docker compose exec -T worker cat /home/node/mnemora-data/public/collector-status.json

# does the container see the token at all?
docker compose exec -T worker sh -c 'printf "%s\n" "${#COLLECT_010_GITHUB_TOKEN}"'
```

**A run that reports `success` is not evidence.** Twice during this workflow's construction the run
succeeded while doing the wrong thing — once re-fetching every repository because two timestamp
strings never matched, once silently skipping the cache export because a branch was wired to an
output that does not exist. Check the database and the file timestamps, not the green tick.

## What it deliberately does not do

- **No private repositories.** Not filtered, unreachable: the listing endpoint never returns them.
- **No incremental merge.** A changed repository is re-fetched in full; the database holds the
  merge, and pruning removes what vanished.
- **No dashboard.** This workflow fills the database; something else reads it.
- **No automatic activation, and no automatic publishing.** A workflow that starts calling out the
  moment it is imported is a surprise nobody wants, and an imported workflow is not a running one.
