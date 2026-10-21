#!/usr/bin/env python3
"""Fail before import if a workflow refers to a node that does not exist.

n8n resolves `$('Node Name')` at runtime and returns undefined when the node is missing or has
been renamed — the expression renders as empty, the run continues, and the workflow reports
success while doing the wrong thing. A branch can also be wired to an output index that the node
type does not have (a Code node has exactly one), which silently orphans a whole branch.

Neither failure is visible from the editor or from a green execution. This check makes them
visible before import.

    ./scripts/check-workflow-refs.py                 # every workflows/*/workflow.json
    ./scripts/check-workflow-refs.py path/to/workflow.json

Exit 0 when every reference resolves, 1 otherwise.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REF = re.compile(r"\$\(\s*['\"]([^'\"]+)['\"]\s*\)")

# How many outputs each node type actually has. Only the shapes this repo uses need to be right;
# an unknown type is skipped rather than guessed at.
OUTPUTS = {
    "n8n-nodes-base.code": 1,
    "n8n-nodes-base.readWriteFile": 1,
    "n8n-nodes-base.convertToFile": 1,
    "n8n-nodes-base.extractFromFile": 1,
    "n8n-nodes-base.postgres": 1,
    "n8n-nodes-base.httpRequest": 1,
    "n8n-nodes-base.webhook": 1,
    "n8n-nodes-base.scheduleTrigger": 1,
    "n8n-nodes-base.executeWorkflowTrigger": 1,
    "n8n-nodes-base.respondToWebhook": 1,
    "n8n-nodes-base.if": 2,
    "n8n-nodes-base.switch": 4,
}


def walk_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from walk_strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from walk_strings(v)


def check(path):
    problems = []
    wf = json.loads(Path(path).read_text())
    nodes = {n["name"]: n for n in wf.get("nodes", [])}

    # 0. an import upserts by id. A file without one is created as a NEW workflow every time,
    #    so edits silently land on a duplicate and the real one keeps running the old version.
    if not wf.get("id"):
        problems.append(
            "workflow.json has no top-level \"id\": every import would create a new workflow "
            "instead of updating this one"
        )

    # 1. expressions referencing a missing node
    for node in wf.get("nodes", []):
        for text in walk_strings(node.get("parameters", {})):
            for ref in REF.findall(text):
                if ref not in nodes:
                    problems.append(
                        f"{node['name']}: refers to $('{ref}') but no node has that name"
                    )

    # 2. connections pointing at nodes or outputs that do not exist
    for source, outputs in wf.get("connections", {}).items():
        if source not in nodes:
            problems.append(f"connection from unknown node '{source}'")
            continue
        out_type = nodes[source].get("type")
        declared = OUTPUTS.get(out_type)
        for index, targets in enumerate(outputs.get("main", [])):
            if declared is not None and index >= declared:
                problems.append(
                    f"{source}: wired to output {index}, but {out_type} has {declared} output(s) "
                    f"— that branch will never run"
                )
            for target in targets or []:
                if target.get("node") not in nodes:
                    problems.append(
                        f"{source} → unknown node '{target.get('node')}'"
                    )
    return problems


def main(argv):
    if argv:
        files = [Path(a) for a in argv]
    else:
        files = sorted(ROOT.glob("workflows/*/workflow.json"))
    if not files:
        print("check-workflow-refs: no workflow.json files found", file=sys.stderr)
        return 1

    failed = 0
    for f in files:
        problems = check(f)
        rel = f.relative_to(ROOT) if f.is_absolute() and ROOT in f.parents else f
        if problems:
            failed += 1
            print(f"FAIL {rel}")
            for p in problems:
                print(f"  - {p}")
        else:
            print(f"ok   {rel}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
