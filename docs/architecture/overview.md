# Architecture overview

Status: conceptual. This describes boundaries, not a chosen framework or deployment.

## Logical components

1. **Presentation** — public dashboard for explicitly selected public repos; authenticated owner view for private aggregate metrics.
2. **Application/API boundary** — enforces visibility and authorization before returning data. Private aggregates must not be accessible through a public endpoint.
3. **Collector** — reads permitted GitHub data, handles pagination, rate limits, retries, delayed statistics, and refresh scheduling. n8n is one candidate for orchestration, not a requirement.
4. **Cache/store** — persists only the minimum data needed for the views and separates public from private records/keys. Retention and encryption choices remain open.
5. **Entitlement service (future, gated)** — maps verified billing state to time-bounded read access and revokes access at expiry. It must not be implemented until GitHub ownership model, payment provider, policies, and security have been reviewed.

## Data flow

```text
GitHub REST API -> collector -> visibility-separated cache/store -> authorization-aware API -> dashboard
Payment provider -> verified webhook -> entitlement record -> narrowly scoped GitHub access grant/revoke
```

The payment path is optional and deliberately separate from dashboard data collection. A public visitor must not be able to influence a GitHub permission change by directly calling an unauthenticated endpoint.

## Deployment-neutral design constraints

- Use the public repository listing for discovery and least-privilege read access, so private repositories are unreachable by construction rather than filtered out in code.
- Keep secrets server-side and out of workflow exports, logs, browser bundles, and documentation.
- Use idempotency keys and compare-and-set/state transitions for payment events and access expiry.
- Ensure a failed collector run preserves the last-known-good dataset while marking its freshness accurately.
- Provide a manual revoke and reconciliation path; do not rely solely on one scheduled job.
- The current node1 capacity assessment is preliminary and applies only to a small, low-frequency demo. It does not approve any deployment; see the cloud-manager project notes.

## Decisions still open

- ~~Repository discovery vs owner-maintained allowlist~~ — **decided:** discovery of all public repositories via the public repository listing. An allowlist was considered and rejected as the v1 scope.
- Static build plus server-side API, or fully dynamic application.
- Persistence technology and retention periods.
- Whether any customer-facing private aggregate view is needed at all.
- Whether paid access belongs in the initial product or a later, separately reviewed phase.