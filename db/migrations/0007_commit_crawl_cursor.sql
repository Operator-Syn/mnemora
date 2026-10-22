-- 0007_commit_crawl_cursor — let a commit crawl continue where it stopped.
--
-- Before this, a repository whose history needed more pages than MAX_COMMIT_PAGES could never
-- finish: the run stopped at the cap, marked the record 'partial', and the next run started again
-- at page 1 and stopped at the same cap. It re-fetched the same pages forever and never reached
-- the oldest commits. The unit of progress was the whole repository, all or nothing.
--
-- Now a crawl is a named thing that can span several runs:
--   commit_crawl_id            which crawl a commit row was last confirmed by
--   commit_page_cursor         last page successfully fetched; the next run starts at cursor + 1
--   commit_crawl_started_at_utc when the multi-run crawl began, for "why is this still going?"
--
-- The cursor is what makes resumption possible; the crawl id is what makes pruning safe across
-- runs. A completed crawl deletes rows whose last_seen_crawl_id is not this crawl — rows seen in
-- an earlier run of the same crawl carry the same id, so they survive. That replaces "send the
-- whole history in one payload" as the condition for pruning, which also removes the memory
-- ceiling that came with it.
alter table mnemora_repositories
  add column if not exists commit_crawl_id text,
  add column if not exists commit_page_cursor integer not null default 0,
  add column if not exists commit_crawl_started_at_utc timestamptz;

comment on column mnemora_repositories.commit_crawl_id is
  'Open multi-run crawl; null when the last crawl finished or never started.';
comment on column mnemora_repositories.commit_page_cursor is
  'Last commit page fetched in the open crawl. The next run resumes at cursor + 1.';

-- Nullable on purpose: rows written before crawls existed have no crawl id, and the first
-- completed crawl after this migration prunes them as "not seen in this crawl" — which is correct,
-- because that crawl re-confirmed every commit that still exists.
alter table mnemora_commits
  add column if not exists last_seen_crawl_id text;

create index if not exists mnemora_commits_crawl
  on mnemora_commits (repository_id, last_seen_crawl_id);

-- A crawl that is open but not advancing would block pruning forever; the collector clears it on
-- completion or failure. This index keeps the "which repositories have an open crawl?" question
-- cheap for the telemetry endpoint.
create index if not exists mnemora_repositories_open_crawl
  on mnemora_repositories (commit_crawl_id)
  where commit_crawl_id is not null;
