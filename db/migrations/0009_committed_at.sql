-- 0009_committed_at — make "the newest commits across every repository" an index lookup.
--
-- The read API needs two things the collection path never did:
--   GET /commits?limit=N      the global activity feed, ordered by when a commit landed
--   GET /activity?days=90     a per-day histogram over a date range
--
-- Every commit index so far leads with repository_id, because writing and pruning are always
-- scoped to one repository. None of them can serve a query that sorts or ranges over the whole
-- table, so the feed fell back to a sequential scan plus a top-N heapsort — measured at 6,993 rows
-- as 314 shared buffers and ~1.8 ms, which is fine now and grows linearly with history.
--
-- On Postgres 18 the histogram is already index-only via a skip scan over
-- mnemora_commits_repo_time (the same index, entered on its second column). That is a pleasant
-- accident of having 24 distinct repositories, not a guarantee: skip scan degrades as the leading
-- column gains values. This index makes both queries independent of that.
--
-- NULLS LAST is deliberate. The column is nullable, and `order by committed_at_utc desc` defaults
-- to NULLS FIRST — so a commit with no committer date would sit at the top of "newest commits",
-- which is the one position it must not occupy. The query says `nulls last` too; the index matches
-- it so the ordering can be read straight off the index instead of re-sorted.
--
-- Not CONCURRENTLY: scripts/migrate.sh runs each file inside one transaction, and CREATE INDEX
-- CONCURRENTLY cannot run in a transaction. At this table's size the exclusive lock is
-- milliseconds. A table large enough to care would need the statement run by hand outside the
-- runner, and that is a deliberate exception to record at the time, not a silent default.
create index if not exists mnemora_commits_committed_at
  on mnemora_commits (committed_at_utc desc nulls last);

comment on index mnemora_commits_committed_at is
  'Serves the cross-repository activity feed and date-range histograms; collection and pruning use mnemora_commits_repo_time and mnemora_commits_crawl instead.';
