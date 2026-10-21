# Product overview

## Purpose

Mnemora is a proposed, read-only GitHub portfolio and repository-access service. It presents a navigable account of selected development work without treating private source history as public portfolio material.

## Product principles

1. **Show work without oversharing.** Public and private repositories have different display rules.
2. **Make provenance visible.** Activity links back to GitHub; the dashboard is a view, not the canonical source.
3. **Be honest about time-limited access.** Access revocation can stop future pulls, but cannot retrieve a copy already downloaded.
4. **Prefer a small, reviewable first release.** Read-only capabilities only, and one clearly bounded scope: all public repositories, discovered rather than hand-listed.
5. **Keep automation replaceable.** Collection tooling (potentially n8n) should not be inseparable from the dashboard or data contract.

## Proposed audience and value

- The repository owner wants a polished portfolio view of recent work and technology use.
- Visitors want to understand selected public projects and inspect their development history.
- If later validated, customers may pay for temporary read access to selected private repositories.

## Proposed repository visibility behavior

| Repository visibility | Dashboard information | Individual commits | Viewer access |
|---|---|---|---|
| Public | Selected activity and language metrics | Yes, with GitHub links | Public |
| Private | Explicitly selected aggregate metrics only; names and language mix may themselves be sensitive | Never in the dashboard | Owner-only or authenticated, authorized view |

Do not assume that hiding individual commits makes all private metadata safe to publish. Private repository data should default to owner-only.

## Current state

The local project contains a documentation scaffold only. There is no application, database, GitHub App, payment integration, n8n workflow, or deployment. All architecture and paid-access material is provisional until reviewed and approved.