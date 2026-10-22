-- GET /api/commits — commits newest first, either across every repository or scoped to one.
-- $1 = "v1" | repository key (empty for all) | limit | before_ms
--
-- One route serves both feeds because they differ by one predicate: the landing page's "latest
-- activity" and a repository's commit list are the same query with a filter. Two endpoints would
-- duplicate the paging, the cursor and the projection.
--
-- The cursor is epoch MILLISECONDS, not an ISO string. Postgres has no safe cast — `not-a-date` and
-- `2026-02-30` both raise, which turned a malformed query string into a 500. An integer cursor is
-- also what a browser already has (Date.now()), and `next_before_ms` comes back in the response.
--
-- Cursor, not offset: `before_ms` is the oldest commit the caller has already seen, so a commit
-- landing between two requests cannot make the next page repeat or skip a row. next_before_ms is
-- null when the page was not full.
--
-- This is the query db/migrations/0009_committed_at.sql exists for. The per-repository case is
-- served by mnemora_commits_repo_time instead; with no repository filter Postgres picks the
-- committed_at index and stops after `limit` rows.
with raw as (
  select
    split_part($1, '|', 2) as repo_key,
    split_part($1, '|', 3) as lim_raw,
    split_part($1, '|', 4) as before_raw
),
bad as (
  select
    (lim_raw <> '' and lim_raw !~ '^[0-9]+$')    as limit_bad,
    (before_raw <> '' and before_raw !~ '^[0-9]+$') as before_bad
  from raw
),
arg as (
  -- Casts are guarded by the same predicates that produce the 400, so a bad value can never reach a
  -- cast: that is what makes the error path total instead of a second failure.
  select
    nullif(repo_key, '')                                        as repo_key,
    case when lim_raw ~ '^[0-9]+$' then least(greatest(lim_raw::int, 1), 200) else 50 end as lim,
    case when before_raw ~ '^[0-9]+$' then before_raw::bigint end as before_ms
  from raw
),
page as (
  select c.sha, c.message, c.author_login, c.author_name,
         c.authored_at_utc, c.committed_at_utc,
         r.repository_id, r.full_name
  from mnemora_commits c
  join mnemora_repositories r on r.repository_id = c.repository_id
  cross join arg
  where r.visibility = 'public'
    and not (select limit_bad or before_bad from bad)
    and (arg.repo_key is null
         or (arg.repo_key ~ '^[0-9]+$' and c.repository_id::text = arg.repo_key)
         or (arg.repo_key !~ '^[0-9]+$' and lower(r.full_name) = lower(arg.repo_key)))
    and (arg.before_ms is null or c.committed_at_utc < to_timestamp(arg.before_ms / 1000.0))
  order by c.committed_at_utc desc nulls last
  limit (select lim from arg)
)
select
  'commits'::text as route,
  400 as status,
  jsonb_build_object(
    'error', 'bad_request',
    'route', 'commits',
    'reason', concat_ws('; ',
      case when limit_bad then 'limit must be a positive integer' end,
      case when before_bad then 'before_ms must be epoch milliseconds (or omit it)' end)
  ) as data
from bad
where limit_bad or before_bad
union all
select
  'commits'::text as route,
  200 as status,
  jsonb_build_object(
    'repository', (select repo_key from arg),
    'limit',      (select lim from arg),
    'before_ms',  (select before_ms from arg),
    'returned',   (select count(*) from page),
    'next_before_ms', (
      select floor(extract(epoch from min(committed_at_utc)) * 1000)::bigint from page
    ),
    'commits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sha', sha,
        'message', message,
        'author_login', author_login,
        'author_name', author_name,
        'authored_at_utc', authored_at_utc,
        'committed_at_utc', committed_at_utc,
        'repository_id', repository_id,
        'full_name', full_name,
        -- Composed here so a client never has to know the URL shape, and never has to trust a url
        -- we stored. GitHub is the canonical source; this API is a view of it.
        'html_url', 'https://github.com/' || full_name || '/commit/' || sha
      ) order by committed_at_utc desc nulls last)
      from page
    ), '[]'::jsonb)
  ) as data
where not (select limit_bad or before_bad from bad);
