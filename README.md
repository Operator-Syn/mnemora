# Mnemora

Mnemora is a proposed GitHub activity and repository-access project. Its dashboard is intended to make selected repository history easier to explore while keeping private-repository details private.

## At a glance

- Public repositories: weekly activity, language breakdowns, and detailed commit views.
- Private repositories: authenticated aggregate statistics only; no individual commit details.
- Possible paid feature: time-limited read access to selected private repositories, with the important limitation that revoking access cannot remove copies already cloned or downloaded.
- Possible implementation role for n8n: scheduled collection and refresh, subject to a separate deployment and security review.

## What exists today

A working collection pipeline and a read-only dashboard, not a product:

- `compose.yaml` runs a self-hosted n8n (queue mode), PostgreSQL 18 and Redis, bound to loopback.
- `workflows/collect-010-github-public-cache/` discovers **every public repository** of a configured account and caches its full commit history as one JSON file per repository, refreshing only what changed.
- `scripts/workflows.sh` imports workflows from this repository into n8n, runs them on demand, and exports edits back.
- `frontend/` is a TanStack Start dashboard (Cloudflare Workers) that reads that cached data through a server function, so the API key never reaches the browser. It runs locally; nothing is deployed.

Still absent: any private-repository path, payments, and any deployment beyond a local machine. See [product overview](docs/product/overview.md) for scope and open decisions.

## Repository layout

[`AGENTS.md`](AGENTS.md) holds the ownership map — which directory owns what, the shared conventions, and where each stack's own instructions live. Read it before adding a file to an unfamiliar directory.

## Documentation

Start at the [documentation index](docs/README.md). It organizes the product brief, requirements, architecture, GitHub data model, security/privacy guidance, operational considerations, and cited research.

The workflow itself has a plain-language [walkthrough](workflows/collect-010-github-public-cache/WALKTHROUGH.md), and every node carries notes visible in the n8n canvas.

## Committing

**One file per commit**, enforced by `.githooks/pre-commit`. A commit touching one path is reviewable, revertible and bisectable; a commit touching ten is a research project the next time something breaks.

Enable the hook in a fresh clone — `.git/hooks` is not version controlled, so this is a one-time step per clone:

```sh
./scripts/setup-hooks.sh
```

A merge commit is exempt, and `git commit --no-verify` overrides deliberately.
