-- 0002_archive_repositories — a repository that vanishes upstream is archived, not deleted.
--
-- Decision D3 (operator, 2026-10-21): a deleted or renamed-away repository keeps its row and
-- every commit it ever contributed. Its commits stay as history — "in memory of" state — and
-- are never pruned merely because the repository no longer exists on GitHub.
--
-- archived_at_utc  set when the repository stops appearing in its owner's public listing
-- archived_reason  why it was archived, for a human reading the dashboard years later
--
-- NULL archived_at_utc means live. A repository that reappears (made public again, or the
-- listing was temporarily truncated) is un-archived by clearing the column, which the persist
-- workflow does on every upsert of a present repository.
alter table mnemora_repositories
  add column if not exists archived_at_utc timestamptz,
  add column if not exists archived_reason  text;

-- The dashboard's common filter is "live repositories only" and its archive view sorts by
-- when they vanished.
create index if not exists mnemora_repositories_archived_at
  on mnemora_repositories (archived_at_utc nulls first);
