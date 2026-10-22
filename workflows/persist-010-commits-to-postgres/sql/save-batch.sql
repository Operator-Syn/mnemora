-- Persist one batch of repository observations. Atomic: one statement, one transaction.
-- $1 = base64(utf8(json)) of:
--   { "repositories": [ record, ... ], "archived_repository_ids": [ id, ... ] }
--
-- Three rules that protect data:
--   1. PRUNE ONLY ON A FINISHED CRAWL. There are two ways a record can honestly claim to describe
--      a repository's whole history:
--        a. a crawl that reached the oldest commit (commit_crawl_complete = true) — pruning is a
--           sweep by crawl id, so rows confirmed in an earlier run of the same crawl survive;
--        b. a legacy full payload (source_state 'complete', commits_omitted false, no crawl id) —
--           pruning is "delete what this payload does not list". That is how backfill replays a
--           cache file.
--      Anything else — partial, stale, capped, skipped — prunes nothing. Verification: AC-7.
--   2. ARCHIVE, NEVER DELETE. A repository absent upstream gets archived_at_utc instead of
--      being removed, so its commits survive as history (decision D3).
--   3. THE CURSOR MOVES WITH THE DATA. A batch that stores pages 11-20 also stores "resume at 21"
--      on the repository row, in the same transaction. There is no window where the commits landed
--      but the resume point did not, or the reverse.
with payload as (
  select convert_from(decode($1, 'base64'), 'UTF8')::jsonb as j
),
repos as (
  select r as rec,
         (r ->> 'repository_id')::bigint as rid,
         coalesce(r ->> 'source_state', '') as state,
         nullif(r ->> 'commit_crawl_id', '') as crawl_id,
         coalesce((r ->> 'commit_crawl_complete')::boolean, false) as crawl_complete,
         coalesce((r ->> 'commit_page_cursor')::integer, 0) as page_cursor,
         nullif(r ->> 'commit_crawl_started_at_utc', '')::timestamptz as crawl_started
  from payload, jsonb_array_elements(j -> 'repositories') as r
),
archived_ids as (
  select v::bigint as rid
  from payload, jsonb_array_elements_text(coalesce(j -> 'archived_repository_ids', '[]'::jsonb)) as v
),
upserted as (
  insert into mnemora_repositories (
    repository_id, full_name, visibility, default_branch, description, is_fork,
    is_archived, html_url, pushed_at_utc, languages_bytes, history, commit_count,
    source_state, source_error, data_changed_at_utc, refreshed_at_utc,
    archived_at_utc, archived_reason,
    commit_crawl_id, commit_page_cursor, commit_crawl_started_at_utc)
  select
    rid,
    rec ->> 'full_name',
    coalesce(rec ->> 'visibility', 'public'),
    rec ->> 'default_branch',
    rec ->> 'description',
    coalesce((rec ->> 'is_fork')::boolean, false),
    coalesce((rec ->> 'is_archived')::boolean, false),
    rec ->> 'html_url',
    nullif(rec ->> 'pushed_at_utc', '')::timestamptz,
    coalesce(rec -> 'languages_bytes', '{}'::jsonb),
    rec ->> 'history',
    coalesce((rec ->> 'commit_count')::integer, 0),
    rec ->> 'source_state',
    rec ->> 'source_error',
    coalesce(nullif(rec ->> 'data_changed_at_utc', '')::timestamptz, now()),
    coalesce(nullif(rec ->> 'refreshed_at_utc', '')::timestamptz, now()),
    null, null,
    -- A finished crawl closes itself: the cursor is cleared so the next run starts fresh, and the
    -- crawl id stays only on the commit rows it confirmed, where the prune needs it.
    case when crawl_complete then null else crawl_id end,
    case when crawl_complete then 0 else page_cursor end,
    case when crawl_complete then null else crawl_started end
  from repos
  on conflict (repository_id) do update set
    full_name = excluded.full_name,
    visibility = excluded.visibility,
    default_branch = excluded.default_branch,
    description = excluded.description,
    is_fork = excluded.is_fork,
    is_archived = excluded.is_archived,
    html_url = excluded.html_url,
    pushed_at_utc = excluded.pushed_at_utc,
    languages_bytes = excluded.languages_bytes,
    history = excluded.history,
    commit_count = excluded.commit_count,
    source_state = excluded.source_state,
    source_error = excluded.source_error,
    -- Seen again => it is not vanished, so it is no longer archived.
    archived_at_utc = null,
    archived_reason = null,
    data_changed_at_utc = case
      when mnemora_repositories.pushed_at_utc is distinct from excluded.pushed_at_utc
        or mnemora_repositories.commit_count is distinct from excluded.commit_count
      then now()
      else mnemora_repositories.data_changed_at_utc end,
    refreshed_at_utc = excluded.refreshed_at_utc,
    commit_crawl_id = excluded.commit_crawl_id,
    commit_page_cursor = excluded.commit_page_cursor,
    commit_crawl_started_at_utc = excluded.commit_crawl_started_at_utc
  returning repository_id
),
archived as (
  update mnemora_repositories r
     set archived_at_utc = coalesce(r.archived_at_utc, now()),
         archived_reason  = coalesce(r.archived_reason, 'absent from owner public listing')
    from archived_ids a
   where r.repository_id = a.rid
     and r.archived_at_utc is null
     and not exists (select 1 from repos p where p.rid = a.rid)
  returning r.repository_id
),
incoming as (
  select r.rid, r.rec ->> 'full_name' as full_name, c as commit, r.crawl_id as crawl_id
  from repos r, jsonb_array_elements(coalesce(r.rec -> 'commits', '[]'::jsonb)) as c
  where c ->> 'sha' is not null
),
-- Which repositories may be pruned, and on what grounds. A crawl-complete record prunes by sweep;
-- a legacy full payload prunes by absence. Never both, never neither by accident.
prunable as (
  select rid,
         crawl_id,
         crawl_complete,
         (state = 'complete'
          and coalesce((rec ->> 'commits_omitted')::boolean, false) = false
          and crawl_id is null) as legacy_full
  from repos
),
pruned as (
  delete from mnemora_commits mc
  using prunable p
  where mc.repository_id = p.rid
    and (
      -- A finished crawl: everything this crawl did not confirm is gone from the repository.
      -- Rows written in an earlier run of the same crawl carry the same id and are kept, and so
      -- does anything this very batch is about to upsert — without the second guard the sweep
      -- deletes rows the insert below re-creates in the same statement, which reports hundreds of
      -- "pruned" and "new" commits that never actually went anywhere.
      (p.crawl_complete
       and mc.last_seen_crawl_id is distinct from p.crawl_id
       and not exists (
         select 1 from incoming i
         where i.rid = mc.repository_id and i.commit ->> 'sha' = mc.sha))
      or
      -- A one-shot full payload (backfill): anything it does not list is gone.
      (p.legacy_full and not exists (
        select 1 from incoming i
        where i.rid = mc.repository_id and i.commit ->> 'sha' = mc.sha))
    )
  returning mc.sha
),
saved as (
  insert into mnemora_commits (
    sha, repository_id, full_name, authored_at_utc, committed_at_utc, message,
    author_login, author_name, last_seen_crawl_id)
  select
    commit ->> 'sha', rid, full_name,
    nullif(commit ->> 'authored_at_utc', '')::timestamptz,
    nullif(commit ->> 'committed_at_utc', '')::timestamptz,
    commit ->> 'message',
    commit -> 'author' ->> 'login',
    commit -> 'author' ->> 'name',
    crawl_id
  from incoming
  on conflict (sha) do update set
    last_seen_at_utc = now(),
    full_name = excluded.full_name,
    message = excluded.message,
    author_login = excluded.author_login,
    author_name = excluded.author_name,
    -- Only a crawl may move a commit's crawl id. A legacy replay leaves it alone: it is not a
    -- crawl and should not stamp rows with null.
    last_seen_crawl_id = coalesce(excluded.last_seen_crawl_id, mnemora_commits.last_seen_crawl_id)
  returning (xmax = 0) as is_new
)
select
  (select count(*) from upserted)::int           as repositories,
  (select count(*) from archived)::int           as repositories_archived,
  (select count(*) from pruned)::int             as commits_pruned,
  (select count(*) from saved)::int              as commits_seen,
  (select count(*) from saved where is_new)::int as commits_new;
