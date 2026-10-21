# collect-010-github-public-cache

Collects **every public repository** an account owns, with its **full commit history**,
into the normalized cache, so a dashboard can read one stable shape instead of talking
to GitHub itself.

- **Schedule:** every 6 hours, plus on-demand via the `Manual Run` trigger.
- **Writes:** `/home/node/mnemora-data/public/github-public-cache__<owner>__<repo>.json`,
  one file per repository, **only when that repository's data changed**; plus
  `public/collector-status.json` every run, which carries the per-repository last-checked
  time. Both live on the `collector_data` volume, which is mounted on both services
  because the worker executes the writes.
- **Contract:** `docs/architecture/github-data.md`.
- **Config:** this directory's `.env` (see `.env.example`), injected by compose.

## Nodes

`Manual Run` / `Every 6 Hours` → `Build Plan` → `Read Existing Cache` → `Extract Cached Records` → `Collect` → `To JSON File` → `Write Public Cache`

`Build Plan` reads configuration; `Collect` does the work in one pass. They are separate
so configuration failures are visible before any network call happens.

`Read Existing Cache` + `Extract Cached Records` load what is already on disk so the
collector can compare against it. The split is not decoration: n8n 2.x keeps binary
payloads in the database, so a Code node is handed a reference rather than bytes, and
n8n's own JSON extractor is the supported way to parse them. Extract nests each parsed
record under `json.data`.

`Collect` is one node rather than a chain of per-repository nodes on purpose: the earlier
version read `$('Node').first()` in several places, which silently processed only the
first repository and still reported `success`. A single pass over the discovered list
cannot drop an entry without also failing.

## Re-runs are cheap — three collection modes

Every record says how it was produced, so a cheap run is visibly cheap:

| mode | when | cost |
|---|---|---|
| `skipped` | the repository's `pushed_at` is unchanged since the cached copy | **zero requests** for it |
| `incremental` | `pushed_at` moved; only commits newer than the cached head are fetched, then merged and deduped by sha | a page or two |
| `full` | no usable cache, or the history mode changed, or `COLLECT_010_FORCE_FULL_RESYNC=true` | the whole history |

Measured on 24 repositories / 6,993 commits:

| scenario | time | requests |
|---|---|---|
| cold cache (first run) | 2 m 36 s | ~95 |
| warm cache, nothing changed | **7.7 s** | 1 listing call |
| one repository changed | 9.3 s | listing + that repo only |

**Rewrite detection:** before merging, the collector checks that the cached head commit
still exists upstream. If it does not, history was rewritten (force-push) and that
repository is re-collected in full instead of merging commits GitHub no longer has.

## Rate limits

The cache reduces API calls **per repository**, not per commit inside one repository.

| what the run does | calls |
|---|---|
| one listing of the account's public repositories | 1 per 100 repos |
| a repository whose `pushed_at` is unchanged | **0** |
| a repository that changed | 1 (languages) + 1 per 100 new commits |
| a repository with no usable cache | 1 + 1 per 100 commits in its whole history |

Measured on 24 repositories / 6,993 commits: **~95 calls cold**, **1 call warm**. Against
5,000/hour authenticated that is comfortable; against 60/hour anonymous, even the listing
plus two calls is more than one run allows, which is why the token is required.

Two guards exist because a full run can still be expensive — a new account, a forced
resync, or a history that grew a lot since it was last collected:

- **Reserve (`COLLECT_010_RATE_RESERVE`, default 25).** Remaining quota is read from
  GitHub's response headers on every call. When it drops to the reserve, the run stops
  spending: repositories not reached are reported as `deferred`, and their cache files are
  left exactly as they were.
- **Never overwrite good data with a failure.** If a commit fetch fails for a repository
  that has a cached copy, the record is marked `stale` with the error recorded and the
  file is not rewritten. Before this, a transient failure would have replaced real history
  with an empty commit list.

What the cache deliberately does **not** do: it keeps no memory of individual commits
between runs, so an `incremental` fetch asks for "everything since the newest cached
commit" and relies on GitHub to return only newer pages. That is one request when nothing
changed and a page or two when a little did — the per-commit bookkeeping would cost more
complexity than it saves calls.


## Targeted writes

A run does **not** rewrite the whole cache. Only repositories whose data changed are handed
to the writer; a `skipped` repository's file keeps its bytes and its mtime.

The "last checked" signal lives in one small file instead:

```
public/collector-status.json     ~7.7 KB, rewritten every run
public/github-public-cache__<owner>__<repo>.json     only when that repository changed
```

Per repository the status entry carries `collection`, `refreshed_at_utc` (last **check**),
`data_changed_at_utc` (last **real change**), `commit_count`, `source_state` and
`source_error`. The data files keep `data_changed_at_utc` and are otherwise immutable
between changes.

Observed on a no-change run: the 24 data files retained their previous mtime while
`collector-status.json` was rewritten, in 6.6 s. After a single repository changed, exactly
one data file was rewritten and the status reported that repository as `incremental`.

## Files

| file | purpose |
|---|---|
| `workflow.json` | The workflow definition. Source of truth; edited here, imported into n8n. |
| `WALKTHROUGH.md` | End-to-end plain-language explanation of every step, plus a worked example and troubleshooting. |
| `.env.example` | Committed template for this workflow's settings. |
| `.env` | Local values. Gitignored. |

## Boundary

Discovery uses `/users/:owner/repos`, the **public** repository listing. That endpoint
does not return private repositories even when an authenticated token is present, so
private work is unreachable by construction rather than by a filter a later edit could
relax. A `visibility !== 'public'` check remains as defence in depth.

The scope is deliberate, chosen over an allowlist: a repository made public appears in
the cache within one run, with no config or code change.

## Honest states

Each record carries `source_state`, and none of the non-complete values is a failure of
the run:

| state | meaning |
|---|---|
| `complete` | every commit in the window was returned and nothing failed |
| `partial` | hit the 100-commit page cap, or one sub-request failed; `source_error` says which |
| `empty` | the repository has no commits (GitHub answers 409); a real state, not an error |
| `error` | commits could not be read at all |

`commit_count_definition` states that `commit_count` is commits returned by the API for
the period — not authored contributions. Bot authors and merges are included; a real
run on `Operator-Syn/arqen` returns `github-actions[bot]` as the newest author.

## Run it

```sh
./scripts/workflows.sh import
./scripts/workflows.sh run collect-010-github-public-cache
```

## History

`COLLECT_010_WINDOW_DAYS` decides how much of each repository is collected:

- `0` (default) — **full history**. No `since` is sent and commits are paginated to the
  end, so `period_start_utc` is the oldest commit actually returned, derived from the
  data rather than assumed from configuration.
- `N` — a rolling window of the last N days. Cheaper, and all a "recent activity"
  dashboard needs.

`COLLECT_010_MAX_COMMIT_PAGES` (default 50, i.e. 5,000 commits per repository) is a
runaway guard. Hitting it sets `source_state: partial` and names the cap in
`source_error`, rather than presenting a truncated history as complete.

Because full history is re-fetched every run rather than merged into the previous file,
there is no incremental-merge logic to get wrong, and a rewritten history on GitHub is
reflected instead of accumulating ghosts. The price is the API calls listed above.

## Cost per run

One repository-listing call per 100 repositories, then 2 per repository (languages,
plus commits paginated 100 at a time to the end of history).

Measured with full history on 24 public repositories: **6,993 commits, ~95 API calls,
2 m 36 s, 2.70 MiB cached**, and the largest single file 1.13 MiB
(`operator-synaciel`, 2,889 commits). All 24 records came back `complete` — nothing
hit the page cap.

Two costs scale with history that did not scale with a window:

- **API calls** grow with total commits, not repository count. ~70 of the 95 calls are
  commit pages.
- **Database growth**, if execution data is kept. See `EXECUTIONS_DATA_SAVE_ON_SUCCESS`
  in the compose file: successful runs store no node data, because the output already
  lives on the cache volume.

Unauthenticated GitHub allows 60 requests/hour, which one run exceeds by itself. The
token is required, not optional.

## Authentication (optional)

The workflow reads `COLLECT_010_GITHUB_TOKEN` and, only if it is non-empty, sends
`Authorization: Bearer <token>`. Empty means anonymous — no header at all.

GitHub allows **60 requests/hour anonymously and 5,000/hour with any valid token**
(measured, not assumed). Authentication changes the quota, not the semantics: this is
still public data, and discovery still cannot see private repositories.

**Use the narrowest token that works.** A classic token with **no scopes** reads public
data and raises the quota. A token carrying `repo` also grants access to your private
repositories — do not put one here.

To verify the header is really sent, put a deliberately invalid token in `.env` and run:
GitHub must answer `401 Bad credentials`. A successful run with an invalid token means
the header is being dropped and the run is silently anonymous.


