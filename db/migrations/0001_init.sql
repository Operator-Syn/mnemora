-- 0001_init — repositories and commits.
--
-- The product database, `mnemora`, owned by role `mnemora_app`. n8n's own database is
-- separate and this role cannot connect to it.
--
-- Written by the persist workflow. The collector reads it; nothing else writes it.

-- One row per repository ever seen. Also the collector's source of truth for "what do I
-- already have": pushed_at_utc decides whether a repository needs re-fetching at all.
create table if not exists mnemora_repositories (
  repository_id       bigint primary key,
  full_name           text        not null,
  visibility          text        not null default 'public',
  default_branch      text,
  description         text,
  is_fork             boolean     not null default false,
  is_archived         boolean     not null default false,
  html_url            text,
  pushed_at_utc       timestamptz,
  languages_bytes     jsonb       not null default '{}'::jsonb,
  history             text,
  commit_count        integer     not null default 0,
  source_state        text,
  source_error        text,
  data_changed_at_utc timestamptz,
  refreshed_at_utc    timestamptz
);

create index if not exists mnemora_repositories_full_name
  on mnemora_repositories (full_name);
create index if not exists mnemora_repositories_visibility
  on mnemora_repositories (visibility);

-- One row per observed commit. Pruned: a commit that no longer exists upstream is deleted,
-- never tombstoned. first_seen_at_utc is when *we* observed it, which is not pushed_at.
create table if not exists mnemora_commits (
  sha               text primary key,
  repository_id     bigint      not null
                    references mnemora_repositories (repository_id) on delete cascade,
  full_name         text        not null,
  authored_at_utc   timestamptz,
  committed_at_utc  timestamptz,
  message           text,
  author_login      text,
  author_name       text,
  first_seen_at_utc timestamptz not null default now(),
  last_seen_at_utc  timestamptz not null default now()
);

create index if not exists mnemora_commits_repo_time
  on mnemora_commits (repository_id, committed_at_utc desc);
create index if not exists mnemora_commits_first_seen
  on mnemora_commits (first_seen_at_utc desc);
create index if not exists mnemora_commits_author
  on mnemora_commits (author_login);
