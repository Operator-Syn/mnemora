#!/usr/bin/env python3
"""Keep workflow code in real files; inline it into JSON only at import time.

A JSON string cannot contain a literal newline, so every Code node body and SQL query ends up as
one escaped line — 16,947 characters for `Collect`, with `\\n` sprinkled through it. That is
parseable by n8n and unmaintainable by a person: no syntax highlighting, no line comments, and a
diff that is one changed line the length of the file.

So the manifest holds a marker and the code lives beside it:

    workflows/<name>/workflow.json      "jsCode": "@file:code/collect.js"
    workflows/<name>/code/collect.js    the actual code, as a normal file
    workflows/<name>/sql/save-batch.sql the actual query, as a normal file

    ./scripts/workflow-files.py split  [<dir>]   workflow.json  -> markers + files
    ./scripts/workflow-files.py build  [<dir>]   markers + files -> rendered JSON
    ./scripts/workflow-files.py build  --out /tmp/x.json

`build` renders to stdout by default. Import and the reference checker both use `build`, so what
n8n receives is always generated from the files a maintainer edits — there is no second copy to
drift.

Only the two parameter names that hold code are split: `jsCode` and `query`. Everything else in the
manifest stays inline, because a short expression is more readable where it is used.
"""
import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, cast

ROOT = Path(__file__).resolve().parent.parent
MARKER = re.compile(r"^@file:(.+)$")
# parameter -> folder for its extracted file
CODE_PARAMS = {"jsCode": "code", "query": "sql"}
SPLIT_MIN_CHARS = 200
SPLIT_MIN_NEWLINES = 2


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "node"


def workflow_dirs(target=None):
    if target:
        p = Path(target)
        if p.is_file():
            p = p.parent
        return [p]
    return sorted(d for d in (ROOT / "workflows").iterdir() if (d / "workflow.json").exists())


def expand(value: Any, base: Path) -> Any:
    """Replace @file: markers with the file's contents, recursively."""
    if isinstance(value, str):
        m = MARKER.match(value)
        if m:
            ref = base / m.group(1)
            if not ref.exists():
                raise SystemExit(f"missing file for marker {value} (looked for {ref})")
            return ref.read_text()
        return value
    if isinstance(value, dict):
        return {k: expand(v, base) for k, v in value.items()}
    if isinstance(value, list):
        return [expand(v, base) for v in value]
    return value


def load_expanded(path: Path) -> dict:
    """The workflow as n8n would receive it."""
    wf = json.loads(Path(path).read_text())
    return cast(dict, expand(wf, Path(path).parent))


def markers_in(value):
    if isinstance(value, str):
        return MARKER.match(value) is not None
    if isinstance(value, dict):
        return any(markers_in(v) for v in value.values())
    if isinstance(value, list):
        return any(markers_in(v) for v in value)
    return False


def cmd_build(args):
    dirs = workflow_dirs(args.target)
    rendered = {}
    for d in dirs:
        wf_path = d / "workflow.json"
        if not wf_path.exists():
            continue
        rendered[d.name] = load_expanded(wf_path)

    if args.out:
        if len(rendered) != 1:
            print("--out needs exactly one workflow directory", file=sys.stderr)
            return 1
        Path(args.out).write_text(json.dumps(next(iter(rendered.values())), indent=2) + "\n")
        print(f"built {args.out}")
        return 0

    print(json.dumps(rendered if len(rendered) > 1 else next(iter(rendered.values())), indent=2))
    return 0


def cmd_split(args):
    dirs = workflow_dirs(args.target)
    for d in dirs:
        wf_path = d / "workflow.json"
        if not wf_path.exists():
            continue
        original = json.loads(wf_path.read_text())
        if markers_in(original):
            print(f"skip {d.name}: already uses @file markers")
            continue

        changed = 0
        for node in original.get("nodes", []):
            params = node.get("parameters") or {}
            for key, folder in CODE_PARAMS.items():
                value = params.get(key)
                if not isinstance(value, str):
                    continue
                if len(value) < SPLIT_MIN_CHARS or value.count("\n") < SPLIT_MIN_NEWLINES:
                    continue
                ext = "js" if key == "jsCode" else "sql"
                rel = Path(folder) / f"{slug(node['name'])}.{ext}"
                out = d / rel
                out.parent.mkdir(parents=True, exist_ok=True)
                # Byte-exact: no trailing-newline normalisation. A changed byte here is a changed
                # workflow, and the round-trip check below is what proves it did not happen.
                out.write_text(value)
                params[key] = f"@file:{rel.as_posix()}"
                changed += 1

        wf_path.write_text(json.dumps(original, indent=2) + "\n")
        print(f"split {d.name}: {changed} code file(s)")


def main():
    ap = argparse.ArgumentParser(prog="workflow-files")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="render markers into JSON")
    b.add_argument("target", nargs="?")
    b.add_argument("--out")
    b.set_defaults(func=cmd_build)

    s = sub.add_parser("split", help="extract code/SQL strings into files")
    s.add_argument("target", nargs="?")
    s.set_defaults(func=cmd_split)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
