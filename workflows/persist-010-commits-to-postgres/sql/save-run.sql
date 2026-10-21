-- Run summary + per-repository telemetry. $1 = base64(utf8(json)) of { "run_summary": {...} }
--
-- Two writes in one statement: the run row, and one telemetry row per repository the run touched.
-- Telemetry is what makes a finished run debuggable — which repository was slow, capped or failing —
-- because successful executions are not stored by n8n in this stack.
with payload as (
  select convert_from(decode($1, 'base64'), 'UTF8')::jsonb as j
),
summary as (
  select j -> 'run_summary' as s from payload
),
saved_run as (
  insert into mnemora_runs (
    run_id, workflow, started_at_utc, finished_at_utc, status,
    repositories_total, repositories_fetched, repositories_skipped, repositories_pending,
    repositories_failed, repositories_archived,
    commits_seen, commits_new, commits_pruned, api_calls, note, trigger_mode)
  select
    s ->> 'run_id',
    coalesce(s ->> 'workflow', 'collect-010'),
    nullif(s ->> 'started_at_utc', '')::timestamptz,
    coalesce(nullif(s ->> 'finished_at_utc', '')::timestamptz, now()),
    coalesce(s ->> 'status', 'success'),
    (s ->> 'repositories_total')::int,
    (s ->> 'repositories_fetched')::int,
    (s ->> 'repositories_skipped')::int,
    (s ->> 'repositories_pending')::int,
    (s ->> 'repositories_failed')::int,
    (s ->> 'repositories_archived')::int,
    (s ->> 'commits_seen')::int,
    (s ->> 'commits_new')::int,
    (s ->> 'commits_pruned')::int,
    (s ->> 'api_calls')::int,
    s ->> 'note',
    s ->> 'trigger_mode'
  from summary
  where s ->> 'run_id' is not null
  on conflict (run_id) do update set
    finished_at_utc       = excluded.finished_at_utc,
    status                = excluded.status,
    repositories_total    = excluded.repositories_total,
    repositories_fetched  = excluded.repositories_fetched,
    repositories_skipped  = excluded.repositories_skipped,
    repositories_pending  = excluded.repositories_pending,
    repositories_failed   = excluded.repositories_failed,
    repositories_archived = excluded.repositories_archived,
    commits_seen          = excluded.commits_seen,
    commits_new           = excluded.commits_new,
    commits_pruned        = excluded.commits_pruned,
    api_calls             = excluded.api_calls,
    note                  = excluded.note,
    trigger_mode          = excluded.trigger_mode
  returning run_id, status
),
telemetry as (
  insert into mnemora_telemetry (
    run_id, workflow, kind, subject, status, source_state, commit_pages, commits, duration_ms, message)
  select
    s ->> 'run_id',
    coalesce(s ->> 'workflow', 'collect-010'),
    'repository',
    t ->> 'full_name',
    t ->> 'mode',
    t ->> 'state',
    nullif(t ->> 'pages', '')::int,
    nullif(t ->> 'commits', '')::int,
    nullif(t ->> 'ms', '')::int,
    t ->> 'error'
  from summary s
  cross join lateral jsonb_array_elements(coalesce(s.s -> 'telemetry', '[]'::jsonb)) as t
  where s ->> 'run_id' is not null
  returning 1
)
select
  (select run_id from saved_run)            as run_id,
  (select status from saved_run)            as status,
  (select count(*) from telemetry)::int     as telemetry_rows;