-- GET /api/repos — the portfolio index.
-- $1 = "v1" | include_archived flag. The literal version prefix is not decoration: n8n binds no
-- parameter at all when the replacement string is empty, so a request without ?include_archived
-- produced "there is no parameter $1" rather than a default. Passing "v1|" keeps $1 present.
--
-- Public only, by WHERE clause *and* by the read role: mnemora_reader has SELECT and nothing else,
-- and the collector only ever writes public repositories. The filter is here as the contract, so
-- the day a private path exists it cannot arrive through this endpoint by accident.
--
-- Languages are returned as the raw byte map GitHub reports. They are not effort, and the caller
-- aggregates them; doing that here would bake one chart's arithmetic into the API.
with arg as (
  select split_part($1, '|', 2) in ('1', 'true', 'yes') as include_archived
)
select
  'repos'::text as route,
  200 as status,
  jsonb_build_object(
    'count', count(*),
    'repositories', coalesce(jsonb_agg(r order by r ->> 'full_name'), '[]'::jsonb)
  ) as data
from (
  select jsonb_build_object(
    'repository_id',    repository_id,
    'full_name',        full_name,
    'description',      description,
    'html_url',         html_url,
    'default_branch',   default_branch,
    'languages_bytes',  coalesce(languages_bytes, '{}'::jsonb),
    'commit_count',     commit_count,
    'pushed_at_utc',    pushed_at_utc,
    'refreshed_at_utc', refreshed_at_utc,
    'source_state',     source_state,
    'archived',         archived_at_utc is not null
  ) as r
  from mnemora_repositories, arg
  where visibility = 'public'
    and (arg.include_archived or archived_at_utc is null)
) s;
