#!/usr/bin/env python3
"""Lint the n8n Code-node JavaScript with Biome, without lying about either side.

Two facts collide:

  * n8n executes a Code node's `jsCode` inside its own wrapper, so `return [...]` and top-level
    `await` are legal in these files;
  * a JavaScript parser that sees the same text as a script or module reports
    "Illegal return statement outside of a function" and stops linting that file.

Linting the raw file therefore reports eight parse errors that are artifacts of the execution
model, and hides the rules that would actually catch a bug. This wraps every file in an async
function before handing it to Biome and maps reported lines back to the original file, so the
output points at real code.

Usage:
    scripts/check-js-lint.py            # report, exit 1 on errors
    scripts/check-js-lint.py --fix      # apply safe fixes, then report
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GLOBS = ["workflows/*/code/*.js", "scripts/*.js"]
# Biome resolves its own config from the repo root; the temp file lives outside it, so pass the
# config explicitly.
CONFIG = ROOT / "biome.json"


def code_files() -> list[Path]:
    files: list[Path] = []
    for pattern in GLOBS:
        files.extend(sorted(ROOT.glob(pattern)))
    return files


def wrapped(src: str) -> str:
    # One line of wrapper so a reported line N corresponds to source line N-1.
    return "async function __n8nCodeNode() {\n" + src.rstrip("\n") + "\n}\n"


def main() -> int:
    biome = shutil.which("biome")
    if not biome:
        print("biome not found on PATH — install it or skip this check", file=sys.stderr)
        return 2

    fix = "--fix" in sys.argv
    unsafe = "--unsafe" in sys.argv
    files = code_files()
    if not files:
        print("ok   no Code-node JavaScript to lint")
        return 0

    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        for path in files:
            source = path.read_text()
            temp = Path(tmp) / f"{path.parent.parent.name}__{path.stem}.js"
            temp.write_text(wrapped(source))

            cmd = [biome, "lint"]
            if CONFIG.exists():
                cmd += ["--config-path", str(CONFIG)]
            if fix:
                cmd += ["--write"]
                if unsafe:
                    cmd += ["--unsafe"]
            cmd += ["--error-on-warnings", "--max-diagnostics=200", str(temp)]
            run = subprocess.run(cmd, capture_output=True, text=True)
            output = run.stdout + run.stderr

            # Map the temp path and the wrapper offset back onto the real file.
            output = output.replace(str(temp), str(path.relative_to(ROOT)))

            def shift(match: re.Match[str]) -> str:
                line = int(match.group(1))
                return f"{match.group(0).split(':')[0]}:{max(line - 1, 1)}"

            output = re.sub(
                rf"{re.escape(str(path.relative_to(ROOT)))}:(\d+)", shift, output
            )

            if fix:
                # Take the fixed body back out of the wrapper and write it to the real file.
                lines = temp.read_text().splitlines()
                if lines and lines[0].startswith("async function __n8nCodeNode()"):
                    end = len(lines)
                    while end > 1 and not lines[end - 1].strip():
                        end -= 1
                    if end > 1 and lines[end - 1].strip() == "}":
                        path.write_text("\n".join(lines[1 : end - 1]) + "\n")

            if run.returncode != 0:
                failures += 1
                print(output.rstrip())
                print()

    if failures:
        print(f"FAIL biome reported problems in {failures} of {len(files)} file(s)")
        return 1
    print(f"ok   biome clean on {len(files)} Code-node file(s) (linted as wrapped bodies)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
