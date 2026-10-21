-- Persist one batch of repository observations. Atomic: one statement, one transaction.
-- $1 = base64(utf8(json)) of:
--   { "repositories": [ record, ... ], "archived_repository_ids": [ id, ... ] }
--
-- Two rules that protect data:
--   1. PRUNE ONLY ON COMPLETE. A record whose source_state is not 'complete' has an
--      incomplete commit list (rate limit, network, pagination stop). Pruning it would delete
--      rows that were never fetched. Verification: AC-7.
--   2. ARCHIVE, NEVER DELETE. A repository absent upstream gets archived_at_utc instead of
--      being removed, so its commits survive as history (decision D3).
with payload as (
  select convert_from(decode($1, 'base64'), 'UTF8')::jsonb as j
),
repos as (
  select r as rec,
         (r ->> 'repository_id')::bigint as rid,
         coalesce(r ->> 'source_state', '') as state
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
    archived_at_utc, archived_reason)
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
    null, null
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
    refreshed_at_utc = excluded.refreshed_at_utc
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
  select r.rid, r.rec ->> 'full_name' as full_name, c as commit
  from repos r, jsonb_array_elements(coalesce(r.rec -> 'commits', '[]'::jsonb)) as c
  where c ->> 'sha' is not null
),
-- Prune only when this record claims to carry the complete commit list. Two ways a record
-- can fail that: source_state is not 'complete' (fetch stopped early), or commits_omitted
-- is true (a skipped repository, where the commit list was never sent at all and the
-- database's existing rows are the truth).
prunable as (
  select rid from repos
  where state = 'complete'
    and coalesce((rec ->> 'commits_omitted')::boolean, false) = false
),
pruned as (
  delete from mnemora_commits mc
  using prunable p
  where mc.repository_id = p.rid
    and not exists (
      select 1 from incoming i
      where i.rid = mc.repository_id and i.commit ->> 'sha' = mc.sha)
  returning mc.sha
),
saved as (
  insert into mnemora_commits (
    sha, repository_id, full_name, authored_at_utc, committed_at_utc, message,
    author_login, author_name)
  select
    commit ->> 'sha', rid, full_name,
    nullif(commit ->> 'authored_at_utc', '')::timestamptz,
    nullif(commit ->> 'committed_at_utc', '')::timestamptz,
    commit ->> 'message',
    commit -> 'author' ->> 'login',
    commit -> 'author' ->> 'name'
  from incoming
  on conflict (sha) do update set
    last_seen_at_utc = now(),
    full_name = excluded.full_name,
    message = excluded.message,
    author_login = excluded.author_login,
    author_name = excluded.author_name
  returning (xmax = 0) as is_new
)
select
  (select count(*) from upserted)::int           as repositories,
  (select count(*) from archived)::int           as repositories_archived,
  (select count(*) from pruned)::int             as commits_pruned,
  (select count(*) from saved)::int              as commits_seen,
  (select count(*) from saved where is_new)::int as commits_new;