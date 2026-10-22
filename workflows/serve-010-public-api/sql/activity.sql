-- GET /api/activity?days=N — commits per day, for a heatmap or a totals strip.
-- $1 = "v1" | days, clamped to 1..365 (default 90). The clamp lives in SQL: an unbounded window is
-- how a public endpoint becomes expensive from a query string.
--
-- Only days that have commits are returned. Filling the gaps with zeros is a presentation decision
-- (the heat map's calendar depends on it), and doing it here would bake one chart's shape into the
-- contract; the window start is returned so the caller can render its own axis.
--
-- A non-numeric `days` is a 400, not a silent default: the caller asked for something and deserves
-- to know it was not understood. The cast is guarded, so the error path cannot fail while producing
-- the error.
with raw as (
  select split_part($1, '|', 2) as days_raw
),
arg as (
  select case when days_raw ~ '^[0-9]+$' then least(greatest(days_raw::int, 1), 365) end as days
  from raw
),
bad as (
  select (days_raw <> '' and days_raw !~ '^[0-9]+$') as days_bad from raw
),
bucket as (
  select date_trunc('day', c.committed_at_utc)::date as day, count(*) as commits
  from mnemora_commits c
  join mnemora_repositories r on r.repository_id = c.repository_id
  cross join arg
  where r.visibility = 'public'
    and not (select days_bad from bad)
    and c.committed_at_utc >= now() - (coalesce(arg.days, 90) || ' days')::interval
  group by 1
)
select
  'activity'::text as route,
  400 as status,
  jsonb_build_object('error', 'bad_request', 'route', 'activity',
                     'reason', 'days must be a positive integer') as data
from bad
where days_bad
union all
select
  'activity'::text as route,
  200 as status,
  jsonb_build_object(
    'window_days', coalesce((select days from arg), 90),
    'window_start_utc', now() - (coalesce((select days from arg), 90) || ' days')::interval,
    'total', coalesce((select sum(commits) from bucket), 0),
    'active_days', (select count(*) from bucket),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('date', day, 'commits', commits) order by day)
      from bucket
    ), '[]'::jsonb),
    -- Beyond the window on purpose: a heatmap whose left half is empty is otherwise
    -- indistinguishable from a collector that stopped a year ago.
    'first_commit_at_utc', (select min(committed_at_utc) from mnemora_commits),
    'last_commit_at_utc',  (select max(committed_at_utc) from mnemora_commits)
  ) as data
where not (select days_bad from bad);
