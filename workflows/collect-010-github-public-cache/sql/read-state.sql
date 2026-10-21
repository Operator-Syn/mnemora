select repository_id, full_name, pushed_at_utc, commit_count, source_state,
       source_error, history, default_branch, data_changed_at_utc, archived_at_utc,
       languages_bytes
from mnemora_repositories
order by full_name;