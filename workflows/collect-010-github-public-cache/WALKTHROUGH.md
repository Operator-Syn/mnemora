# How this workflow works — a plain-language walkthrough

For reading end to end, without needing to hold the code in your head. The node-by-node
version of this is inside the workflow itself: every node carries a **Notes** field, so
opening it in the n8n canvas shows the same explanation in place.

## In one paragraph

Once every six hours — or when you click run — the workflow asks GitHub for the list of
public repositories belonging to your account. For each one it writes down the languages
and the entire commit history, then saves one JSON file per repository into a cache
folder. A dashboard later reads those files instead of calling GitHub. That is the whole
job: **discover repositories, describe each one, save a copy.**

## The shape of it

```
  [Manual Run]  ─┐
                 ├─→ [Build Plan] → [Read Existing Cache] → [Extract Cached Records]
  [Every 6 Hours]┘        │                 │                      │
                       settings          files on disk         parsed records
                                                                  │
                          ┌───────────────────────────────────────┘
                          ↓
                      [Collect] → [To JSON File] → [Write Public Cache]
                          │            │                  │
                     GitHub calls   one file each      saved to cache
```

Two possible starts, one path through, so a manual run and a scheduled run can never
diverge — they execute exactly the same steps.

Two nodes between "settings" and "the work" exist so the collector can compare against
what it already has. `Read Existing Cache` cannot hand a Code node real file bytes —
n8n keeps binary payloads in the database, so it hands over a reference — which is why
`Extract Cached Records` exists to turn those files into records n8n code can read.

## Step 1 — something starts it

| start | when |
|---|---|
| **Manual Run** | you click "execute workflow" in n8n, or run `./scripts/workflows.sh run collect-010-github-public-cache` |
| **Every 6 Hours** | on the clock, but only once the workflow is **activated** |

Nothing happens until one of these fires. Importing the workflow does not start it: it
arrives inactive, because activation is the moment it begins making outbound requests on
its own.

## Step 2 — Build Plan: read the settings, touch nothing

This step opens `.env` and answers four questions: which accounts to look at, how much
history (all of it, or the last N days), whether forks and archived repositories count,
and whether there is a GitHub token to authenticate with.

It makes **no network calls**. That is deliberate. A malformed setting — an empty account
list, a nonsense number — fails here in a fraction of a second with a message naming the
variable. The alternative is discovering it ninety seconds into a crawl of twenty-four
repositories, with half a cache written.

The output is one small object: "look at these accounts, this much history, with these
headers."

## Step 3 — what do we already have?

Before asking GitHub anything, the run loads the cache files it already wrote and turns
them back into records, so the collector can compare.

That takes two nodes rather than one because of a quirk worth knowing: n8n keeps binary
payloads in its database, so a Code node never sees the file bytes — it sees a reference.
`Extract Cached Records` is n8n's own JSON parser doing the reading.

With the previous records in hand, each repository falls into one of three cases:

| situation | what happens | cost |
|---|---|---|
| `pushed_at` has not moved since the cached copy | nothing is fetched; the file is left alone | **zero requests** |
| `pushed_at` moved | only commits newer than the cached newest are fetched, then merged and de-duplicated by sha | a page or two |
| no usable cache, or the history mode changed | the whole history is fetched again | full |

Measured here: a cold run over 24 repositories takes 2 m 36 s and ~95 requests; a warm run
with nothing changed takes **7.7 seconds**, and a run where one repository changed takes
9.3 seconds.

One safeguarding effect worth naming: because a skipped repository is never handed to the
writer, its file keeps both its bytes and its modification time. The "we checked, nothing
moved" signal is kept separately in a small `collector-status.json` that is rewritten every
run, with a `refreshed_at_utc` (last check) and `data_changed_at_utc` (last real change) per
repository.

And one safeguard of its own: before merging, the collector confirms the cached newest
commit still exists upstream. If it does not, history was rewritten (force-push), so that
repository is re-fetched in full instead of merging commits GitHub no longer has.

## Step 4 — Collect: the actual work

One pass, three movements.

**1. Find the repositories.** It asks GitHub for the public repositories of each account.
The important property: that endpoint *does not return private repositories*, even when
the request is authenticated. Private work is not filtered out by our code — it is
unreachable through the door we knock on. That is a stronger guarantee than a rule we
could forget to apply.

**2. Describe each repository.** For every one it makes two more requests: the language
byte counts, and the commits. Commits arrive 100 at a time, so the step keeps asking for
the next page until GitHub returns fewer than 100 — that is how "the end of history" is
detected. `operator-synaciel` needs 29 pages; `camping-tweaks` needs one.

**3. Assemble one record per repository** containing its identity, languages, the commits,
and a status. Nothing is written yet.

Why this is a single node rather than a chain of one-node-per-repository: an earlier
version read "the first item" at several points, which meant a two-repository allowlist
produced one file and reported success. A single loop over a list cannot skip an entry
without also failing loudly.

## Step 5 — To JSON File: turn records into bytes

Each record becomes a file in memory. Nothing touches disk here. It is a separate step
only because n8n separates "make the bytes" from "save the bytes".

## Step 6 — Write Public Cache: save them

The files land in the cache volume, one per repository:

```
public/github-public-cache__operator-syn__arqen.json
public/github-public-cache__operator-syn__camping-tweaks.json
...
```

The filename is not constructed here. Each record already carries it in `cache_file`, so
the file on disk and the name inside the record are the same string by construction — they
cannot drift apart.

One deployment detail that matters: in queue mode the **worker** container performs this
write, not the main one. That is why the cache volume is mounted on both. Mount it only on
the main container and every file lands in the worker's throwaway layer, appearing to work
until the next restart.

## A worked example

Run against `Operator-Syn/arqen`, 24 October 2026:

| | |
|---|---|
| repositories found | 24 (every public repo, 3 forks included) |
| commits fetched for `arqen` | 1,109 across 12 pages |
| oldest commit seen | 2026-09-10 |
| status | `complete` |
| file written | `github-public-cache__operator-syn__arqen.json`, 434 KB |
| whole run | ~95 requests, 2 m 36 s, 2.70 MiB total |

## The status field, and why it is not always "fine"

Every record says how much to trust it. None of these is a crash; they are honest labels.

| status | meaning |
|---|---|
| `complete` | the whole history was read and nothing failed |
| `partial` | a sub-request failed, or the safety cap on pages was hit; `source_error` says which |
| `empty` | the repository genuinely has no commits (GitHub answers 409) — a real state, not an error |
| `error` | the commits could not be read at all |

`commit_count` also carries `commit_count_definition` next to it, because the number is
not what people assume: it counts commits returned by the API for the default branch,
including bot authors and merges. On `arqen` the newest commit is authored by
`github-actions[bot]`. It is a measure of repository activity, not of a person's work.

## When something looks wrong, look here first

```sh
# what the last runs did
docker compose exec -T postgres psql -U n8n -d n8n \
  -c "select status, mode, \"startedAt\" from execution_entity order by \"startedAt\" desc limit 5;"

# how many repositories are actually cached
docker compose exec -T worker sh -c 'ls -1 /home/node/mnemora-data/public/ | wc -l'

# does the container see the token at all?
docker compose exec -T worker sh -c 'printf "%s\n" "${#COLLECT_010_GITHUB_TOKEN}"'
```

A run that reports `success` while producing fewer files than you have public
repositories means the collection loop stopped early — check `source_error` on the records
that did land, then re-run.

## What it deliberately does not do

- **No private repositories.** Not filtered, unreachable.
- **No merging.** Full history is re-fetched each run rather than appended to the previous
  file, so a rewritten or force-pushed history corrects itself instead of leaving ghosts.
- **No dashboard.** This workflow only fills the cache; something else has to read it.
- **No automatic activation.** A workflow that starts calling out the moment it is
  imported is a surprise nobody wants.
