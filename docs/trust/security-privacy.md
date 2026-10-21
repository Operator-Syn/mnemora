# Security and privacy considerations

Status: baseline guidance for a proposal, not a completed security review.

## Private repository boundary

- Private repositories are opt-in by explicit owner selection.
- Keep private aggregates behind authentication and authorization. Repo names, language distribution, and activity counts can reveal sensitive work even without commit details.
- Private commit messages, SHAs, authors, and changed-file lists must never be returned to public clients.
- No credentials in browser JavaScript, static artifacts, workflow exports, logs, screenshots, or docs. Redact authorization headers and webhook secrets.
- Use least privilege and separate public collection paths from private collection paths.

## GitHub app and credential handling

A future GitHub App should request only permissions needed for read-only repository data, be restricted to explicitly selected repositories where feasible, and store its private key server-side in a proper secrets manager. Installation access tokens are short-lived, but token expiration does not itself revoke a human user's collaborator access. Never share a personal access token with customers.

## Time-bounded repository access

The paid-access feature grants temporary ability to access the hosted repository; it cannot reliably revoke a clone after download. Removing a collaborator blocks future remote operations but cannot erase local copies. State this clearly in checkout, terms, and help text. Avoid representing the feature as DRM or a technical guarantee that users lose source at expiry.

Before activation, review:

- Dedicated organization and repository isolation; do not expose unrelated personal repositories.
- Read-only permission and exact access scope.
- Payment webhook signature verification, replay resistance, idempotency, event ordering, and amount/currency checks.
- Entitlement start/end, retries, expiry reconciliation, manual revoke, refunds, disputes, chargebacks, and customer support process.
- Audit log access controls, data retention, deletion requests, backup retention, privacy notice, and applicable platform/business terms.

No real paid users or automated grants/revocations until this review is complete, the behavior is tested on a disposable repository, and the operator explicitly approves launch.

## Threat-model prompts

- Can a public endpoint retrieve private repo identifiers or cached aggregates?
- Can a repository flip from private to public (or back) between discovery and collection, and is the public listing the only thing deciding what enters the cache?
- Can repeated or forged billing events extend access, or can a retry revoke an active entitlement?
- What happens if the expiry worker is down or GitHub's API is unavailable at the expiry instant?
- Does a customer retain access through an organization team or another collaborator path after the intended grant is removed?
- Could logs, workflow execution data, exports, analytics, or backups retain data after deletion?