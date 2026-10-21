-- 0006_trigger_mode — record how a run was started.
--
-- Why: successful executions are not stored by n8n in this stack, so a scheduled run never appears
-- in the editor's Executions list. In mnemora_runs it was indistinguishable from a manual one,
-- which made "are my scheduled runs happening?" unanswerable from the data. That is the wrong
-- answer to a question the system should be able to settle by itself.
--
-- Values: 'schedule' when the Every 6 Hours trigger fired, 'manual' when Manual Run did, and
-- n8n's `$execution.mode` (test|production) as the fallback when neither node ran.
alter table mnemora_runs
  add column if not exists trigger_mode text;

comment on column mnemora_runs.trigger_mode is
  'n8n execution mode: trigger | manual | cli. Null for rows written before this column existed.';

create index if not exists mnemora_runs_trigger_mode
  on mnemora_runs (trigger_mode, finished_at_utc desc);
