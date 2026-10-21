-- 0004_runs — one row per collector run.
--
-- Why this exists: every run overwrote public/collector-status.json, so the only record of what
-- happened yesterday was gone tomorrow, and it lived on a volume outside the database the
-- dashboard reads. n8n's execution_entity is not a substitute — it is n8n's own table, pruned at
-- 168 hours, and CLI-run executions never leave the "running" state.
--
-- What belongs here: facts a run can attest to about itself — how many repositories it looked at,
-- how many it fetched, skipped, deferred or failed, how many API calls it spent, and what the
-- persist workflow reported back. Per-repository "last checked" lives on the repository row as
-- refreshed_at_utc; this table is the run, not the repository.
create table if not exists mnemora_runs (
  run_id               text primary key,
  workflow             text not null,
  started_at_utc       timestamptz,
  finished_at_utc      timestamptz not null default now(),
  status               text not null default 'success',
  repositories_total   integer,
  repositories_fetched integer,
  repositories_skipped integer,
  repositories_pending integer,
  repositories_failed  integer,
  repositories_archived integer,
  commits_seen         integer,
  commits_new          integer,
  commits_pruned       integer,
  api_calls            integer,
  note                 text
);

-- The dashboard's question is almost always "the last N runs".
create index if not exists mnemora_runs_finished
  on mnemora_runs (finished_at_utc desc);

comment on table mnemora_runs is
  'One row per collector run: what it looked at, what it spent, and what the pipe reported back.';
