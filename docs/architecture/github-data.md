# GitHub data model and collection guide

Status: proposed. Date checked: 2026-10-20.

## Data contract (conceptual)

### Repository summary

- `repository_id` — GitHub repository numeric ID; stable internal identity.
- `full_name` — owner/name; treat private values as sensitive.
- `visibility` — `public` or `private`.
- `default_branch` — used only when a view has not selected another branch.
- `languages_bytes` — language-to-byte-count mapping from GitHub; not an effort estimate.
- `period_start_utc`, `period_end_utc` — exact window represented.
- `commit_count` — count with a documented definition (e.g. commits returned for branch/period, not necessarily a person's authored contribution).
- `refreshed_at_utc`, `source_state` — freshness and complete/partial/stale/error state.

### Public commit detail only

- `sha`, `html_url`, `message`, author and committer display/identity fields, authored/committed timestamps.
- Changed file paths and additions/deletions only where available from the detailed commit endpoint.
- Never ingest or serve this entity for private-repository dashboard views.

## API mapping

- Repository commits endpoint: [REST commits](https://docs.github.com/en/rest/commits/commits).
- Weekly repository activity/contributor statistics: [REST repository statistics](https://docs.github.com/en/rest/metrics/statistics).
- Repository language breakdown: [REST repositories](https://docs.github.com/en/rest/repos) (list repository languages).

Use GitHub's documented API version and media type headers; follow pagination links and rate-limit headers. Some statistics endpoints may return `202 Accepted` while GitHub computes data. Treat this as pending, retry with bounded backoff, and avoid replacing good cached data with an empty result. Handle `403`/`429`, transient `5xx`, deleted/renamed repositories, empty repositories, and partial pages explicitly.

## Counting semantics

A weekly repository activity count is not automatically the same as “commits by the owner this week.” Branch merges, bot authors, author/committer discrepancies, force-pushes, and GitHub's statistics definition can change what a count means. The UI must state the chosen definition and link to source commits when public. Pin UTC week boundaries and test daylight-saving/local-week edge cases if local time is ever offered.

## Cache and privacy rules

- Separate public and private namespaces or enforce an equivalent reviewed authorization boundary.
- Do not use a public static export containing private aggregates.
- Minimize retained raw commit detail; it is needed only for the public commit-explorer feature.
- Track freshness so stale or incomplete data is not presented as current.
- Add contract tests proving that private responses contain only allowed aggregate fields.