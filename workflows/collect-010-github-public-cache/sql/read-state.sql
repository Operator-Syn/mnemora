-- What the collector already has, and where any unfinished crawl stopped.
-- commit_rows is the number of commit rows already stored for the repository: a resumed crawl adds
-- to it, so the total survives a crawl split across runs. commit_crawl_id / commit_page_cursor are
-- the resume point; both are null/zero when no crawl is open.
select r.repository_id, r.full_name, r.pushed_at_utc, r.commit_count, r.source_state,
       r.source_error, r.history, r.default_branch, r.data_changed_at_utc, r.archived_at_utc,
       r.languages_bytes, r.commit_crawl_id, r.commit_page_cursor, r.commit_boundary_sha,
       r.commit_crawl_started_at_utc,
       (select count(*) from mnemora_commits mc where mc.repository_id = r.repository_id) as commit_rows,
       -- Rows this crawl has already confirmed. Counting every row would double-count commits
       -- that already existed from a previous crawl: they are upserted, not added again.
       (select count(*) from mnemora_commits mc
          where mc.repository_id = r.repository_id
            and r.commit_crawl_id is not null
            and mc.last_seen_crawl_id = r.commit_crawl_id) as crawl_rows
from mnemora_repositories r
order by r.full_name;
