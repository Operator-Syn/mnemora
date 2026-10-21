# Research notes and references

Checked: 2026-10-20. These are external platform references, not product decisions. Recheck before implementation because platform behavior and terms can change.

## GitHub REST API

- [REST API endpoints for commits](https://docs.github.com/en/rest/commits/commits) — commit listing and commit detail. Use for public individual commit views; private commit detail is excluded by the proposed product requirements.
- [REST API endpoints for repository statistics](https://docs.github.com/en/rest/metrics/statistics) — weekly commit activity and contributor statistics. GitHub may return `202 Accepted` while calculating statistics; collector design needs pending/retry handling.
- [REST API endpoints for repositories](https://docs.github.com/en/rest/repos) — includes repository language listing. Language totals are bytes by language, not time or effort.
- [Generating a GitHub App installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app) — installation tokens expire after one hour. This is an API token lifetime, not customer access entitlement expiry.
- [Personal repository permission levels](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository) — GitHub notes local clones remain with a removed collaborator.
- [Remove a collaborator from a personal repository](https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-github-user-account/managing-access-to-your-personal-repositories/removing-a-collaborator-from-a-personal-repository) — repository access management reference.

## Hosting/automation

- [n8n install using Docker Compose](https://docs.n8n.io/deploy/host-n8n/install-options/install-using-docker-compose) — official installation guide. n8n is only a candidate collection/orchestration component; it is not a product requirement.

## Evidence boundary

This file records external documentation and checked date. It is not an endorsement by GitHub or n8n of Mnemora, a decision to sell repository access, or legal advice. The repository's proposed behavior is documented separately in `product/` and `trust/`.