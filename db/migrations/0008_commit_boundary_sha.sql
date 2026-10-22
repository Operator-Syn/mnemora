-- 0008_commit_boundary_sha — anchor a resumable crawl to a commit, not a page number.
--
-- Page numbers are positions in a mutable list. Resuming at cursor + 1 is only correct while the
-- history above the cursor is unchanged: if commits are added at the top, positions shift down and
-- the resume re-covers a few already-seen commits (deduped by sha — harmless). If history is
-- force-pushed shorter, positions shift up and resuming at the old cursor steps over commits that
-- moved above it. Nothing in the crawl noticed.
--
-- commit_boundary_sha is the sha of the oldest commit fetched so far. Before resuming, the collector
-- re-reads the page the cursor points at and asks whether that commit is still on it:
--   present -> the list has not shifted up past our anchor; resume at cursor + 1
--   absent  -> it has shifted, so start a new crawl at page 1 rather than skip anything
--
-- The anchor is a commit, not the branch head: new commits at the top change the head constantly and
-- would force a needless full restart, while they cannot cause a skip.
alter table mnemora_repositories
  add column if not exists commit_boundary_sha text;

comment on column mnemora_repositories.commit_boundary_sha is
  'Oldest commit confirmed by the open crawl; the resume anchor. Null when no crawl is open.';
