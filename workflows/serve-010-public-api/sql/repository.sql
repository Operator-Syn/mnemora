-- GET /api/repository?id=<numeric id or owner/name> — one repository, or 404.
-- $1 = "v1" | repository key.
--
-- The key accepts either form because both are natural at the call site: a dashboard links by name,
-- a script links by id. Comparison is textual on the id column so a non-numeric key can never raise
-- a cast error — it simply falls through to the name comparison.
--
-- This statement MUST return exactly one row even when nothing matched. A plain
-- `select ... from (select ...) s` returns zero rows for an unknown key, the Postgres node passes
-- zero items on, the rest of the workflow never executes, and n8n answers 200 with an empty body —
-- a silent "found nothing" that looks like success. Hence exists()/subselect rather than a straight
-- scan.
with arg as (
  select nullif(split_part($1, '|', 2), '') as key
),
matched as (
  select jsonb_build_object(
    'repository_id',       repository_id,
    'full_name',           full_name,
    'description',         description,
    'html_url',            html_url,
    'default_branch',      default_branch,
    'languages_bytes',     coalesce(languages_bytes, '{}'::jsonb),
    'commit_count',        commit_count,
    'pushed_at_utc',       pushed_at_utc,
    'refreshed_at_utc',    refreshed_at_utc,
    'data_changed_at_utc', data_changed_at_utc,
    'source_state',        source_state,
    -- Served even when not complete, but the caller must be able to say so: the dashboard shows
    -- "last refreshed" from these two fields, and a partial crawl is not fresh.
    'source_error',        source_error,
    'archived',            archived_at_utc is not null
  ) as r
  from mnemora_repositories, arg
  where visibility = 'public'
    and arg.key is not null
    and (
      (arg.key ~ '^[0-9]+$' and repository_id::text = arg.key)
      or (arg.key !~ '^[0-9]+$' and lower(full_name) = lower(arg.key))
    )
  limit 1
)
select
  'repository'::text as route,
  case when exists (select 1 from matched) then 200 else 404 end as status,
  (select r from matched) as data;
