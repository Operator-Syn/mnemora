#!/usr/bin/env python3
"""Fail when the instance would be silently weakened, or when a workflow depends on a limit
nobody recorded.

n8n 3.0 moved several limits that are invisible until an execution hits them:
  - Code-node task timeout default 300s -> 60s
  - Compression decompressed size 2 GiB -> 256 MiB, zip entries 5000 -> 1000
  - unverified community packages on by default -> off
  - manual executions on the main instance -> always on workers

Pinning those values in compose fixes today. This check keeps them fixed: it reads the *rendered*
compose configuration (what the container will actually receive, not what `.env` appears to say)
and refuses the deployment if a pinned value is missing or has drifted to something unworkable.

It also enforces a contract for Compression nodes: if one is ever added, its Notes must state the
payload size it is expected to handle. The node that needs a 2 GiB ceiling then says so, instead of
failing at 256 MiB in production with no way to know what it used to accept.

    ./scripts/check-instance-env.py
Exit 0 when the instance is safe to run, 1 otherwise.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMPRESSION_NODE = "n8n-nodes-base.compression"

# key -> (kind, minimum/precondition, why)
REQUIRED = {
    "N8N_RUNNERS_TASK_TIMEOUT": (
        "int",
        300,
        "Code-node timeout. The collector's Collect node runs ~157 s in one task; 3.0's 60 s "
        "default would abort it mid-crawl.",
    ),
    "N8N_COMPRESSION_NODE_MAX_DECOMPRESSED_SIZE_BYTES": (
        "int",
        1,
        "Compression ceiling must be stated, not inherited: 3.0 lowers it from 2 GiB to 256 MiB.",
    ),
    "N8N_COMPRESSION_NODE_MAX_ZIP_ENTRIES": (
        "int",
        1,
        "Compression entry ceiling must be stated, not inherited: 3.0 lowers it from 5000 to 1000.",
    ),
    "N8N_UNVERIFIED_PACKAGES_ENABLED": (
        "bool",
        None,
        "3.0 disables unverified community packages by default; the value must be deliberate.",
    ),
    "OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS": (
        "bool",
        None,
        "3.0 removes this variable and always routes manual runs to workers; set it explicitly.",
    ),
}

# The values n8n 3.0 would use on its own. Matching them is not wrong, it is just worth naming.
DEFAULT_BYTES = 268435456
DEFAULT_ENTRIES = 1000


def rendered_env():
    """What the container will actually receive, with .env applied and defaults resolved."""
    try:
        out = subprocess.run(
            ["docker", "compose", "config", "--format", "json"],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        detail = getattr(e, "stderr", "") or str(e)
        print(f"check-instance-env: cannot render compose config: {detail.strip()}", file=sys.stderr)
        return None
    services = json.loads(out)["services"]
    merged = {}
    for name in ("n8n", "worker"):
        for k, v in (services.get(name, {}).get("environment") or {}).items():
            if v is not None:
                merged[k] = str(v)
    return merged, services


def compression_nodes():
    found = []
    for f in sorted(ROOT.glob("workflows/*/workflow.json")):
        try:
            wf = json.loads(f.read_text())
        except json.JSONDecodeError as e:
            found.append((f, None, f"invalid JSON: {e}"))
            continue
        for node in wf.get("nodes", []):
            if node.get("type") == COMPRESSION_NODE:
                found.append((f, node, None))
    return found


def main():
    result = rendered_env()
    if result is None:
        return 1
    env, services = result
    problems, warnings = [], []

    for key, (kind, minimum, why) in REQUIRED.items():
        value = env.get(key)
        if value is None or value == "":
            problems.append(f"{key} is not set in the rendered config — {why}")
            continue
        if kind == "int":
            try:
                number = int(value)
            except ValueError:
                problems.append(f"{key}={value!r} is not an integer — {why}")
                continue
            if number < minimum:
                problems.append(f"{key}={number} is below {minimum} — {why}")
        elif kind == "bool":
            if str(value).lower() not in ("true", "false"):
                problems.append(f"{key}={value!r} is not a boolean — {why}")

    for name in ("n8n", "worker"):
        if name not in services:
            problems.append(f"service '{name}' is missing from compose")

    # A Compression node is allowed, but it must carry its own size contract.
    nodes = compression_nodes()
    for path, node, err in nodes:
        rel = path.relative_to(ROOT)
        if err:
            problems.append(f"{rel}: {err}")
            continue
        notes = (node.get("notes") or "").strip()
        if not re.search(r"\b(compression|archive|zip|bytes|mib|gib)\b", notes, re.I):
            problems.append(
                f"{rel}: node '{node.get('name')}' is a Compression node with no size contract. "
                f"Record in its Notes the largest payload it must handle and the reason. "
                f"Current ceilings: {env.get('N8N_COMPRESSION_NODE_MAX_DECOMPRESSED_SIZE_BYTES')} bytes, "
                f"{env.get('N8N_COMPRESSION_NODE_MAX_ZIP_ENTRIES')} entries — exceeding either fails "
                f"the execution, and 3.0 lowered both without warning."
            )

    if nodes and not problems:
        ceilings = (
            int(env["N8N_COMPRESSION_NODE_MAX_DECOMPRESSED_SIZE_BYTES"]),
            int(env["N8N_COMPRESSION_NODE_MAX_ZIP_ENTRIES"]),
        )
        if ceilings == (DEFAULT_BYTES, DEFAULT_ENTRIES):
            warnings.append(
                f"Compression is in use at the platform defaults ({DEFAULT_BYTES} bytes / "
                f"{DEFAULT_ENTRIES} entries). If any workflow needs more, raise "
                f"N8N_COMPRESSION_NODE_MAX_* in .env deliberately and say why."
            )

    for w in warnings:
        print(f"warn  {w}")
    for p in problems:
        print(f"FAIL  {p}")
    if problems:
        print(f"\n{len(problems)} problem(s). Refusing to call this instance safe.")
        return 1
    print(f"ok    instance settings pinned; compression nodes: {len(nodes)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
