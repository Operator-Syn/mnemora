-- 0005_telemetry — per-repository outcomes, for debugging a run after the fact.
--
-- Why: successful executions are not persisted by n8n in this stack (the collector writes
-- megabytes of JSON per run; EXECUTIONS_DATA_SAVE_ON_SUCCESS=none keeps the database from
-- growing forever). The consequence is that when a run behaves oddly, mnemora_runs tells you
-- *what* happened in aggregate and nothing about *which* repository was slow, capped, or failing.
--
-- One row per repository per run. Deliberately not a general event log: it answers "why did this
-- run look like that", and it is written by the persist workflow from the collector's own report.
create table if not exists mnemora_telemetry (
  id            bigserial primary key,
  at_utc        timestamptz not null default now(),
  run_id        text,
  workflow      text not null,
  kind          text not null default 'repository',
  subject       text,                 -- full_name
  status        text,                 -- collection mode: skipped | full | pending | deferred
  source_state  text,                 -- complete | partial | error | stale | empty | pending
  commit_pages  integer,
  commits       integer,
  duration_ms   integer,              -- time spent on this repository inside Collect
  message       text                  -- source_error, verbatim
);

create index if not exists mnemora_telemetry_run
  on mnemora_telemetry (run_id);
create index if not exists mnemora_telemetry_at
  on mnemora_telemetry (at_utc desc);
-- The debugging query is "show me the problems", so index that shape.
create index if not exists mnemora_telemetry_problems
  on mnemora_telemetry (source_state, at_utc desc)
  where source_state is distinct from 'complete';

comment on table mnemora_telemetry is
  'Per-repository outcome per run: which repository was slow, capped, or failing, and why.';
