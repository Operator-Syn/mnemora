#!/usr/bin/env python3
"""Import a workflow into n8n from a URL — the capability n8n 3.0 removes from the editor.

n8n 3.0 drops "Import from URL", which is how you pull a workflow out of a GitHub repository
without cloning it. Losing the menu item does not have to mean losing the workflow:

    ./scripts/workflows.sh import-url <url> [--save <dir>] [--yes] [--print-url]

What it does that the old menu did not:

  - **Rewrites GitHub URLs.** A `github.com/o/r/blob/ref/path` link becomes
    `raw.githubusercontent.com/...`; gist and plain raw links pass through.
  - **Inspects before importing.** A workflow is code that runs with this instance's environment
    and credentials. The scan reports what it would gain: Execute Command nodes, `$env` access,
    outbound HTTP hosts, webhook triggers, credential slots. Anything risky requires `--yes`.
  - **Records provenance.** `--save` writes `workflows/<dir>/workflow.json` plus a README naming the
    source URL and the import time, and stamps the workflow id so later imports update rather than
    duplicate.

Exit codes: 0 imported, 1 error, 2 refused pending `--yes`.
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOB = re.compile(r"^https?://github\.com/([^/]+)/([^/]+)/blob/(.+)$")
RISKY_NODES = {
    "n8n-nodes-base.executeCommand": "runs shell commands in the container",
    "n8n-nodes-base.ssh": "opens SSH connections",
    "n8n-nodes-base.localFileTrigger": "watches the filesystem",
}


def rewrite(url: str) -> str:
    m = BLOB.match(url)
    if m:
        owner, repo, rest = m.groups()
        return f"https://raw.githubusercontent.com/{owner}/{repo}/{rest}"
    return url


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "mnemora-import/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def scan(wf: dict):
    """What would this workflow be able to do once imported?"""
    findings = []
    text = json.dumps(wf)
    nodes = wf.get("nodes", [])

    for node in nodes:
        t = node.get("type", "")
        if t in RISKY_NODES:
            findings.append(f"node '{node.get('name')}' {RISKY_NODES[t]}")
        if t == "n8n-nodes-base.webhook":
            path = (node.get("parameters") or {}).get("path")
            findings.append(f"node '{node.get('name')}' opens a webhook at /webhook/{path}")
        if t == "n8n-nodes-base.httpRequest":
            url = str((node.get("parameters") or {}).get("url", ""))
            host = re.sub(r"^https?://([^/]+).*$", r"\1", url) or "an expression"
            findings.append(f"node '{node.get('name')}' calls {host}")

    if "$env" in text:
        # Every env var in this container is readable, including N8N_ENCRYPTION_KEY.
        findings.append("reads environment variables (every variable in the container is visible)")

    creds = sorted({slot.get("name") for n in nodes for slot in (n.get("credentials") or {}).values()
                    if slot.get("name")})
    for c in creds:
        findings.append(f"references credential '{c}' (it will need to exist here)")

    if any(n.get("type") == "n8n-nodes-base.code" for n in nodes):
        findings.append("contains Code nodes, which execute JavaScript in the task runner")
    return findings


def compose(*args, **kw):
    return subprocess.run(["docker", "compose", *args], cwd=ROOT, capture_output=True, text=True, **kw)


def import_file(path: Path) -> str:
    cp = compose("cp", str(path), "n8n:/tmp/import-url.json")
    if cp.returncode != 0:
        raise SystemExit(f"copy into n8n failed: {cp.stderr.strip()}")
    run = compose("exec", "-T", "n8n", "n8n", "import:workflow", "--input=/tmp/import-url.json")
    out = (run.stdout + run.stderr)
    compose("exec", "-T", "n8n", "rm", "-f", "/tmp/import-url.json")
    if run.returncode != 0 or "Successfully imported" not in out:
        raise SystemExit(f"import failed:\n{out.strip()}")
    return out.strip().splitlines()[-1]


def workflow_id_by_name(name: str) -> str:
    """Newest workflow with this name. psql receives the string verbatim, so an escaped quote
    arrives literally and the query fails — quote the identifier plainly."""
    safe = name.replace("'", "''")
    q = (
        "select id from workflow_entity "
        f"where name = '{safe}' "
        'order by "updatedAt" desc limit 1;'
    )
    r = compose("exec", "-T", "postgres", "psql", "-U", "n8n", "-d", "n8n", "-tAc", q)
    if r.returncode != 0:
        return ""
    return r.stdout.strip()

def write_saved(wf: dict, name: str, source: str, wf_id: str) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "imported-workflow"
    d = ROOT / "workflows" / slug
    d.mkdir(parents=True, exist_ok=True)
    wf = dict(wf)
    wf["id"] = wf_id          # so the next import updates this workflow instead of duplicating it
    (d / "workflow.json").write_text(json.dumps(wf, indent=2) + "\n")
    (d / "README.md").write_text(
        f"# {name}\n\n"
        f"Imported from a URL on {datetime.now(timezone.utc).isoformat(timespec='seconds')}.\n\n"
        f"- **Source:** {source}\n"
        f"- **n8n id:** `{wf_id}`\n\n"
        "## Before relying on it\n\n"
        "1. Read the workflow. It arrived from outside this repository and has not been reviewed.\n"
        "2. Check the Prerequisites it implies — credentials referenced by name must exist on this\n"
        "   instance; they cannot be recovered from the repository.\n"
        "3. Publish it: an import writes a draft and deactivates the workflow.\n"
        "4. Run `./scripts/workflows.sh check` — the layout and reference gates apply to this\n"
        "   directory like any other.\n"
    )
    return d


def main():
    ap = argparse.ArgumentParser(prog="import-url")
    ap.add_argument("url")
    ap.add_argument("--save", metavar="DIR", help="also write it into workflows/<dir> with provenance")
    ap.add_argument("--yes", action="store_true", help="import despite the risk findings")
    ap.add_argument("--print-url", action="store_true", help="show the resolved URL and exit")
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch and inspect, import nothing — proves the path without changing the instance")
    args = ap.parse_args()

    url = rewrite(args.url)
    if args.print_url:
        print(url)
        return 0
    if url != args.url:
        print(f"resolved: {args.url}\n       -> {url}")

    try:
        raw = fetch(url)
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"fetch failed: {e}", file=sys.stderr)
        return 1

    try:
        wf = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"not a workflow: response is not JSON ({e})", file=sys.stderr)
        return 1
    if not isinstance(wf, dict) or "nodes" not in wf:
        print("not a workflow: no 'nodes' array", file=sys.stderr)
        return 1
    name = wf.get("name") or "imported-workflow"

    findings = scan(wf)
    if findings:
        print(f"\nThis workflow ({name}, {len(wf['nodes'])} nodes) would be able to:")
        for f in findings:
            print(f"  - {f}")
        if not args.yes:
            print("\nRefusing to import without --yes. Verify the source before granting this.")
            return 2
        print()

    if args.dry_run:
        print(f"\ndry run: {name} ({len(wf['nodes'])} nodes) would import; nothing was written.")
        print(f"  name:      {name}")
        print(f"  id:        {wf.get('id') or '(none — a new workflow would be created)'}")
        print(f"  triggers:  {', '.join(sorted({n.get('type','').split('.')[-1] for n in wf['nodes'] if 'rigger' in n.get('type','') or n.get('type','').endswith('webhook')})) or 'none'}")
        print(f"  findings:  {len(findings)}")
        return 0

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as t:
        t.write(json.dumps(wf))
        tmp = Path(t.name)
    try:
        print(import_file(tmp))
    finally:
        tmp.unlink(missing_ok=True)

    wf_id = workflow_id_by_name(name)
    print(f"workflow id: {wf_id}")
    if args.save:
        d = write_saved(wf, name, args.url, wf_id)
        print(f"saved to {d.relative_to(ROOT)}")
    print("note: imported as a DRAFT and deactivated. Publish it before any trigger will fire.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
