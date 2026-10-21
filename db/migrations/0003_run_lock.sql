-- 0003_run_lock — one collector run at a time.
--
-- A single row holding the current claim. The acquire is one atomic statement:
-- INSERT ... ON CONFLICT DO UPDATE ... WHERE expired. Two runs racing both attempt the insert;
-- exactly one wins because the conflict clause only fires when the existing lease has expired.
-- A separate "read then write" would have a window between the two, which is the whole bug the
-- claim exists to prevent.
--
-- Only the persist workflow writes here. The collector asks for the claim over the pipe and is
-- still read-only against everything else.
create table if not exists mnemora_run_lock (
  lock_name     text primary key,
  run_id        text not null,
  workflow      text,
  started_at_utc timestamptz not null default now(),
  expires_at_utc timestamptz not null
);

comment on table mnemora_run_lock is
  'Lease table: one row = one running collector. Expired rows are reclaimed by the next acquire.';
