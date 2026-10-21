#!/usr/bin/env python3
"""Fail when a workflow directory is missing something it needs to be deployable by someone else.

Three rules, each learned from a real mistake in this repository:

1. **Every workflow directory has a README.md.** A workflow is a service; a bare `workflow.json`
   with an encrypted credential requirement and no document is not deployable by anyone but its
   author. Persist shipped without one while its prerequisite — a Postgres credential named
   `Mnemora DB` — was written down nowhere.

2. **A workflow that reads environment variables has an `.env.example`.** The collector is
   configured entirely through `.env`; without the example, a fresh host has to read the Code node
   to discover nine variables. Conversely, persist reads none and deliberately has no `.env.example`
   — its connection is a credential, not configuration. The check enforces the rule, not the file.

3. **A workflow that declares a credential says which one in its README.** Credentials are the one
   prerequisite that a fresh clone cannot infer: they are encrypted with `N8N_ENCRYPTION_KEY` and
   cannot be recovered from the repository.

    ./scripts/check-workflow-layout.py
Exit 0 when every workflow directory is complete, 1 otherwise.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_USAGE = re.compile(r"\$env\b")


def check_dir(path: Path):
    problems = []
    wf_path = path / "workflow.json"
    if not wf_path.exists():
        problems.append("missing workflow.json")
        return problems
    try:
        wf = json.loads(wf_path.read_text())
    except json.JSONDecodeError as e:
        problems.append(f"workflow.json is invalid JSON: {e}")
        return problems

    readme = path / "README.md"
    if not readme.exists():
        problems.append("missing README.md — a workflow without one is deployable only by its author")
        readme_text = ""
    else:
        readme_text = readme.read_text()

    if ENV_USAGE.search(wf_path.read_text()) and not (path / ".env.example").exists():
        problems.append(
            "reads environment variables but has no .env.example — a fresh host cannot discover "
            "the required settings"
        )

    # Credential declarations must be named somewhere a human reads. What matters is the
    # credential's *name* — the string someone has to type when creating it — not the node's
    # internal type key.
    declared = set()
    for node in wf.get("nodes", []):
        for slot in (node.get("credentials") or {}).values():
            name = (slot or {}).get("name")
            if name:
                declared.add(name)
    lower = readme_text.lower()
    for cred_name in sorted(declared):
        if cred_name.lower() not in lower:
            problems.append(
                f"declares a '{cred_name}' credential but the README never names it — "
                f"credentials cannot be recovered from the repository"
            )
    return problems


def main():
    dirs = sorted(p for p in (ROOT / "workflows").iterdir() if p.is_dir())
    if not dirs:
        print("check-workflow-layout: no workflow directories found", file=sys.stderr)
        return 1
    failed = 0
    for d in dirs:
        problems = check_dir(d)
        rel = d.relative_to(ROOT)
        if problems:
            failed += 1
            print(f"FAIL {rel}")
            for p in problems:
                print(f"  - {p}")
        else:
            print(f"ok   {rel}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
