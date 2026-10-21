-- One row, three answers: what recent runs did, what is currently wrong, and what is slow.
-- Read-only role, so this endpoint cannot change anything even if its token leaks.
select
  (select coalesce(jsonb_agg(r), '[]'::jsonb) from (
     select run_id, status, repositories_total, repositories_fetched, repositories_skipped,
            repositories_pending, repositories_failed, commits_new, commits_pruned,
            api_calls, started_at_utc, finished_at_utc,
            round(extract(epoch from (finished_at_utc - started_at_utc)))::int as seconds
     from mnemora_runs order by finished_at_utc desc limit 20
   ) r) as recent_runs,
  (select coalesce(jsonb_agg(i), '[]'::jsonb) from (
     select run_id, at_utc, subject, status, source_state, commit_pages, commits, duration_ms, message
     from mnemora_telemetry
     where source_state is distinct from 'complete'
     order by at_utc desc limit 25
   ) i) as recent_issues,
  (select coalesce(jsonb_agg(s), '[]'::jsonb) from (
     -- max(), not sum(): a repository's commit count is a property of the repository, not
     -- something that accumulates per run. Summing counted a skipped run's copy of the same
     -- number and doubled it.
     select subject, max(duration_ms) as slowest_ms, max(commits) as commits,
            count(*) filter (where status = 'full') as times_fetched
     from mnemora_telemetry
     where at_utc > now() - interval '7 days' and duration_ms is not null
     group by subject order by max(duration_ms) desc nulls last limit 10
   ) s) as slowest_repositories,
  jsonb_build_object(
    'last_run_age_seconds', (select round(extract(epoch from (now() - max(finished_at_utc))))::int from mnemora_runs),
    'last_run_status',      (select status from mnemora_runs order by finished_at_utc desc limit 1),
    'repositories',         (select count(*) from mnemora_repositories),
    'commits',              (select count(*) from mnemora_commits),
    'pending',              (select count(*) from mnemora_repositories where source_state = 'pending'),
    'not_complete',         (select count(*) from mnemora_repositories where source_state is distinct from 'complete'),
    'archived',             (select count(*) from mnemora_repositories where archived_at_utc is not null),
    'run_lock_held',        (select count(*) from mnemora_run_lock),
    'migrations_applied',   (select count(*) from mnemora_schema_migrations)
  ) as health;