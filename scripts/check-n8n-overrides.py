#!/usr/bin/env python3
"""Verify the n8n vendor override is mounted and still doing what it was mounted for.

`ops/n8n/overrides/workflow-import-url-removed.rule.js` replaces a file inside n8n's compiled
distribution to stop the migration report listing an item that can never leave it. That is a
vendor patch, so it has two failure modes worth catching early:

  1. the mount is dropped from compose.yaml (upgrade, tidy-up, merge) and the notice quietly
     returns;
  2. n8n changes the module shape and the patched file stops registering — the report either
     shows the item again or the container throws on boot.

This checks both. The live check needs a running container; without one it reports skipped
rather than passing, because "could not check" is not "checked and fine".
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMPOSE = ROOT / "compose.yaml"
OVERRIDE = ROOT / "ops/n8n/overrides/workflow-import-url-removed.rule.js"
TARGET = (
    "/usr/local/lib/node_modules/n8n/dist/modules/breaking-changes/rules/v3/"
    "workflow-import-url-removed.rule.js"
)

failures: list[str] = []


def check_mounts() -> None:
    text = COMPOSE.read_text()
    if not OVERRIDE.exists():
        failures.append(f"{OVERRIDE.relative_to(ROOT)} is missing")
        return
    # the mount has to be on both services: n8n answers the report, the worker runs executions
    for service in ("n8n", "worker"):
        block = service_block(text, service)
        if not block:
            failures.append(f"compose.yaml has no '{service}:' service")
            continue
        if TARGET not in block:
            failures.append(
                f"'{service}' no longer mounts the failure-report override "
                f"({TARGET}) — the notice will come back"
            )


def service_block(text: str, service: str) -> str:
    lines = text.splitlines()
    out: list[str] = []
    inside = False
    for line in lines:
        if line.rstrip() == f"  {service}:":
            inside = True
            continue
        if inside:
            if line.startswith("  ") and not line.startswith("    ") and line.strip():
                break
            out.append(line)
    return "\n".join(out)


def check_source() -> None:
    if not OVERRIDE.exists():
        return
    src = OVERRIDE.read_text()
    if "isAffected: false" not in src:
        failures.append("the override no longer suppresses the rule (isAffected: false missing)")
    for needle in ("WorkflowImportUrlRemovedRule", "workflow-import-url-removed-v3", "@n8n/decorators"):
        if needle not in src:
            failures.append(f"the override is missing '{needle}' — registration may break")


def check_live() -> str:
    ps = subprocess.run(
        ["docker", "compose", "ps", "--format", "{{.Service}} {{.State}}"],
        cwd=ROOT, capture_output=True, text=True,
    )
    if "n8n running" not in ps.stdout:
        return "skipped (n8n is not running)"

    script = (
        "const m = require(%r);"
        "const r = new m.WorkflowImportUrlRemovedRule();"
        "r.detect().then(d => {"
        "  if (d.isAffected !== false || (d.instanceIssues || []).length !== 0) {"
        "    console.error('rule still reports affected'); process.exit(1);"
        "  }"
        "  console.log('ok');"
        "});" % TARGET
    )
    run = subprocess.run(
        ["docker", "compose", "exec", "-T", "n8n", "node", "-e", script],
        cwd=ROOT, capture_output=True, text=True,
    )
    if run.returncode != 0:
        failures.append(
            "the rule inside the running container still reports affected "
            f"(node: {run.stderr.strip().splitlines()[-1] if run.stderr.strip() else 'no output'})"
        )
        return "FAILED"
    return "ok"


def main() -> int:
    check_mounts()
    check_source()
    live = check_live()
    if failures:
        print("FAIL n8n overrides")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"ok   n8n override mounted on n8n and worker; rule suppressed (live: {live})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
