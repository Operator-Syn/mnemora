# Operations and deployment guide

Status: no deployment has been selected or performed. This guide is a future checklist, not authorization to operate node1.

## Local development (future)

- Document runtime/version and repeatable setup only after the implementation stack is chosen.
- Keep secrets in an ignored local environment file or supported secret store; include only a safe example template if needed.
- Provide fixture data and a mock GitHub API mode so UI and privacy tests do not require live credentials.
- Add a command that validates docs/config and tests the public/private response boundary.

## Before any node1 deployment

1. Reconcile the historical n8n Compose state and exited containers without starting or deleting them.
2. Review current proxy routes, TLS, editor/admin authentication, webhook exposure, firewall boundaries, and service ownership.
3. Establish persistent data location, backup/restore test, recorded image digests for rollback, resource limits, health checks, logs and retention.
4. Take a representative host capacity sample and approve a specific deployment plan; previous readings are snapshots, not a benchmark.
5. Prepare rollback that protects existing data and other Compose projects.
6. Obtain explicit authorization before creating or changing services, publishing a route, or enabling recurring collection.
7. After an approved change, verify real API authorization, private-data non-disclosure, public UI reachability, and rollback readiness.

## Operational failure behavior

- Preserve last-known-good data and label it stale when refresh fails.
- Retry transient API failures with bounded backoff; honor GitHub rate-limit reset guidance.
- Alert privately on failed refreshes; do not leak private repo names or response payloads to public channels.
- Reconcile paid entitlements and repository grants against source-of-truth billing state; provide a manual revocation route.
- Avoid autonomous remediation of node1. The cloud-manager operating scope is on-demand; this project does not authorize scheduled repair tasks.