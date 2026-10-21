# Requirements and guided user journeys

Status: proposed requirements, not implemented.

## Portfolio dashboard

### Public repository overview

- Collect **every public repository** the account owns, discovered from the public repository listing rather than from a hand-maintained list. A newly published repository therefore appears in the cache without a code or config change.
- The public repository listing never returns private repositories, so discovery cannot pull private work into the public path. That property is the reason this is safe to automate; it must not be replaced by an endpoint that can see everything and then filters in software.
- Show repository name/link, selected date range, activity totals, primary languages, and last-refresh time.
- Let visitors navigate repositories and time ranges. Clearly label week boundaries and timezone (UTC recommended).

### Public commit exploration

- Show a recent/selected-period commit list and an expandable detail view.
- Where GitHub supplies the data, show SHA, author/committer attribution, timestamps, commit message, changed paths, additions/deletions, and link to the canonical GitHub commit/diff.
- Explain that GitHub identity fields may be missing or differ from profile identity, and language bytes do not measure effort.

### Private repository overview

- Include only private repositories explicitly approved for metrics.
- Display aggregate counts and language summaries only; do not return individual commit records, commit messages, SHAs, authors, or changed paths.
- Require authenticated authorization to view private aggregates. Default to owner-only until an access model is deliberately selected.
- Never send private metrics into public static assets, shared public caches, analytics events, or unauthenticated APIs.

## Possible paid temporary read access

1. Customer sees the exact repository, access duration, price, and limitations before checkout.
2. Access is granted only after trusted payment confirmation, with an auditable expiry timestamp.
3. Customer receives read-only access to the hosted repository for the stated period.
4. At expiry, access to the hosted repository is revoked and the outcome is recorded/verified.
5. Refunds, chargebacks, cancellations, failed payments, grace periods, and manual support require explicit policy and tested handling before launch.

**Disclosure requirement:** access expiry prevents future authorized remote access, but cannot erase a local clone, cached archive, screenshot, or other copy already obtained. Do not promise time-limited possession or use of downloaded source. If that is the desired business rule, Git clone access is the wrong delivery mechanism; consider a separately licensed product/package and obtain appropriate legal advice.

## Acceptance criteria for a future implementation

- Public data is demonstrably separated from private data at API, cache, and presentation layers.
- Private commit details are absent from every public response, not merely hidden by the UI.
- GitHub credentials never appear in client code, HTML, logs, or exported workflow JSON.
- API errors, rate limits, delayed statistics, stale data, and partial results are clearly represented.
- Paid-access grant/revoke uses idempotent, authenticated events; duplicate or reordered billing events do not create incorrect entitlements.
- Expiry has a reliable scheduled or event-driven revocation check plus an auditable manual recovery path.
- Automated tests cover authorization boundaries, expiry, and failure cases before external launch.