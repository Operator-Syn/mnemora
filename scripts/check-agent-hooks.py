#!/usr/bin/env python3
"""Check agent hook registrations, their targets, and their trust state. Read-only.

Why this exists: hook state lives in four places that drift independently — the registration
files in the repository, the scripts they invoke, the trust ledger each agent keeps outside the
repository, and the documentation that describes all of it. Nothing reconciles them, so a moved
file or a changed command turns into a hook that silently stops running.

What it checks
  1. Every registration file that this repository relies on exists and parses.
  2. Every command in those registrations points at a file that exists, resolved the way the tool
     would resolve it from the repository root or from the stack directory.
  3. Registration files that a tool will never discover (nested `.codex/`) are reported, because
     they look active and are not.
  4. Codex's trust ledger (`~/.codex/config.toml`, [hooks.state]) is compared against the hooks
     actually declared: an untrusted hook will not run, and an entry for a hook that no longer
     exists is stale. The same sweep covers every repository in the ledger.
  5. Claude's workspace trust for this repository (`~/.claude.json`) is reported.
  6. Generated artifacts are not tracked.

What it cannot check: Codex records trust as a hash of the exact hook definition and the
canonicalisation is not documented, so this reports whether trust is recorded, not whether the
recorded hash still matches the current command. A changed command shows up as "trusted, hash
unverifiable" only if you trust it again first — so re-run this after editing a hook and expect
the ledger to ask again.

  ./scripts/check-agent-hooks.py            # exit 1 if a registration or target is broken
  ./scripts/check-agent-hooks.py --verbose  # also list every ledger entry
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Registration files this repository relies on. `discovered_as` explains why each one is where it
# is; a file that is not in this table is checked for the opposite reason.
EXPECTED = {
    ".codex/hooks.json": ("Codex", "repository layer: <repo>/.codex/hooks.json"),
    ".claude/settings.json": ("Claude Code", "project settings of the session's working directory"),
    "frontend/.claude/settings.json": (
        "Claude Code",
        "nested project settings, read only by sessions started inside frontend/",
    ),
}

AGENT_HOME = {
    "Codex": Path.home() / ".codex",
    "Claude Code": Path.home() / ".claude",
}

# `"$(git rev-parse --show-toplevel)/path"` and `${CLAUDE_PROJECT_DIR}/path` are the two portable
# anchor forms in use. A bare relative path resolves against the session cwd, which is why the
# Codex docs tell you not to use one.
GIT_ROOT_RE = re.compile(r"\$\(git rev-parse --show-toplevel\)/([^\"'\\\s]+)")
PROJECT_DIR_RE = re.compile(r"\$\{CLAUDE_PROJECT_DIR\}/([^\"'\\\s]+)")
BARE_RELATIVE_RE = re.compile(r'(?<![/\w])"?((?:\.agents|\.intent|\.claude|\.codex|scripts)/[^"\s]+)')


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


class Report:
    def __init__(self) -> None:
        self.problems: list[str] = []
        self.notes: list[str] = []

    def problem(self, text: str) -> None:
        self.problems.append(text)

    def note(self, text: str) -> None:
        self.notes.append(text)


def load_json(path: Path, report: Report) -> dict | None:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        report.problem(f"{rel(path)}: missing")
        return None
    except json.JSONDecodeError as error:
        report.problem(f"{rel(path)}: invalid JSON ({error})")
        return None


def hook_commands(payload: dict, base: Path, report: Report, label: str) -> list[tuple[str, str, int, int]]:
    """Return (event, command, group_index, hook_index) for every command hook."""
    found = []
    hooks = payload.get("hooks")
    if not isinstance(hooks, dict):
        report.problem(f"{label}: no top-level 'hooks' object")
        return found
    for event, groups in hooks.items():
        if not isinstance(groups, list):
            report.problem(f"{label}: '{event}' is not a list")
            continue
        for gi, group in enumerate(groups):
            for hi, hook in enumerate(group.get("hooks", []) if isinstance(group, dict) else []):
                if not isinstance(hook, dict):
                    continue
                command = hook.get("command")
                args = hook.get("args")
                if isinstance(command, str):
                    text = command + (" " + " ".join(str(a) for a in args) if isinstance(args, list) else "")
                    found.append((event, text, gi, hi))
    return found


def verify_targets(text: str, base: Path, report: Report, label: str) -> int:
    """Check that every script path in a command resolves. Returns the count verified.

    `base` is the file that declared the hook; ${CLAUDE_PROJECT_DIR} resolves to its grandparent,
    because the settings file lives inside the project's .claude/ directory.
    """
    checked = 0
    project_dir = base.parent if base.name == ".claude" else base
    for pattern, anchor in ((GIT_ROOT_RE, ROOT), (PROJECT_DIR_RE, project_dir)):
        for match in pattern.finditer(text):
            target = anchor / match.group(1)
            checked += 1
            if not target.exists():
                report.problem(f"{label}: command references {match.group(0)} but {rel(target)} does not exist")
    for match in BARE_RELATIVE_RE.finditer(text):
        if GIT_ROOT_RE.search(text) or PROJECT_DIR_RE.search(text):
            break
        target = project_dir / match.group(1)
        checked += 1
        report.problem(
            f"{label}: command uses the cwd-relative path '{match.group(1)}' — "
            f"breaks when the tool is started from a subdirectory"
        )
        if target.exists():
            report.note(f"{label}: '{match.group(1)}' happens to exist relative to {rel(base)}, but that is not guaranteed")
    return checked


def read_codex_ledger() -> dict[str, str]:
    """Map 'path:event:group:hook' -> trusted hash from ~/.codex/config.toml."""
    config = AGENT_HOME["Codex"] / "config.toml"
    if not config.is_file():
        return {}
    try:
        data = tomllib.loads(config.read_text())
    except tomllib.TOMLDecodeError:
        return {}
    state = data.get("hooks", {}).get("state", {})
    return {
        key: (value or {}).get("trusted_hash", "")
        for key, value in state.items()
        if isinstance(value, dict)
    }


SNAKE = re.compile(r"(?<!^)(?=[A-Z])")


def ledger_key(path: Path, event: str, gi: int, hi: int) -> str:
    return f"{path}:{SNAKE.sub('_', event).lower()}:{gi}:{hi}"


def declared_keys(path: Path, payload: dict) -> set[str]:
    keys = set()
    for event, groups in (payload.get("hooks") or {}).items():
        for gi, group in enumerate(groups):
            for hi, _ in enumerate(group.get("hooks", []) or []):
                keys.add(ledger_key(path, event, gi, hi))
    return keys


def check_ledger(ledger: dict[str, str], report: Report, verbose: bool) -> None:
    """Untrusted declarations here, and stale entries everywhere."""
    # 1. This repository: declared hooks that Codex would skip.
    for name, (tool, _) in EXPECTED.items():
        if tool != "Codex":
            continue
        path = (ROOT / name).resolve()
        payload = load_json(path, report)
        if not payload:
            continue
        declared = declared_keys(path, payload)
        trusted = {key for key in declared if key in ledger}
        missing = sorted(declared - trusted)
        print(f"  Trust      {name:<34} {len(trusted)}/{len(declared)} hooks recorded (hash not verified)")
        if missing:
            report.problem(
                f"{name}: {len(missing)} hook(s) not trusted — Codex will skip them until you approve: "
                + ", ".join(k.split(":", 1)[1] for k in missing)
            )

    # 2. Every repository in the ledger: entries pointing at hooks that no longer exist.
    stale = []
    for key in sorted(ledger):
        path_text, rest = key.rsplit(":", 3)[0], key.rsplit(":", 3)[1:]
        hook_path = Path(path_text)
        event, gi, hi = rest[0], int(rest[1]), int(rest[2])
        if not hook_path.is_file():
            stale.append((key, "hooks file no longer exists"))
            continue
        try:
            payload = json.loads(hook_path.read_text())
        except (OSError, json.JSONDecodeError):
            stale.append((key, "hooks file unreadable"))
            continue
        groups = (payload.get("hooks") or {}).get(_pascal(event), [])
        if gi >= len(groups) or hi >= len(groups[gi].get("hooks", [])):
            stale.append((key, "no such event/group/hook index"))

    repos = {k.rsplit(":hooks", 1)[0] if ":hooks" in k else str(Path(k.rsplit(":", 3)[0]).parent) for k in ledger}
    print(f"  Ledger     {len(ledger)} entries across {len(repos)} hook files, {len(stale)} stale")
    if verbose:
        for key in sorted(ledger):
            print(f"               {key}")
    for key, why in stale:
        report.note(f"stale trust entry: {key} ({why}) — Codex carries it forever; pruning is manual")


def _pascal(snake: str) -> str:
    return "".join(part.capitalize() for part in snake.split("_"))


def check_claude_trust(report: Report) -> None:
    config = Path.home() / ".claude.json"
    if not config.is_file():
        report.note("~/.claude.json absent — Claude Code has not run for this user")
        return
    try:
        data = json.loads(config.read_text())
    except json.JSONDecodeError:
        report.problem("~/.claude.json is not valid JSON")
        return
    projects = data.get("projects", {})
    entry = projects.get(str(ROOT))
    state = "trusted" if entry and entry.get("hasTrustDialogAccepted") else "NOT trusted"
    print(f"  Trust      {'Claude workspace':<34} {state} ({ROOT})")
    if not entry or not entry.get("hasTrustDialogAccepted"):
        report.problem(
            f"Claude Code has no accepted workspace trust for {ROOT} — project hooks do not run until you accept"
        )
    nested = projects.get(str(ROOT / "frontend"))
    print(
        f"  Trust      {'Claude workspace (frontend/)':<34} "
        f"{'trusted' if nested and nested.get('hasTrustDialogAccepted') else 'not trusted / no entry'}"
    )


def check_unexpected_registrations(report: Report) -> None:
    """Any Codex registration beyond the root one is a second layer that applies only sometimes.

    Codex's project layer is the directory the session treats as its root, so a nested
    `.codex/hooks.json` is read when the agent is started in that directory and ignored otherwise.
    That inconsistency — not the nested file itself — is the hazard.
    """
    for candidate in ROOT.rglob(".codex/hooks.json"):
        if ".git" in candidate.parts or "node_modules" in candidate.parts:
            continue
        name = rel(candidate)
        if name not in EXPECTED:
            report.problem(
                f"{name}: a second Codex registration layer — it applies only to sessions started in "
                f"{rel(candidate.parent.parent)}/ and not to the rest of the repository; keep one root registration"
            )
    for candidate in ROOT.rglob(".claude/settings.json"):
        if ".git" in candidate.parts or "node_modules" in candidate.parts:
            continue
        if rel(candidate) not in EXPECTED:
            report.note(f"{rel(candidate)}: not in the expected table — confirm this layer is intentional")


def check_generated_untracked(report: Report) -> None:
    tracked = os.popen("git -C %s ls-files" % ROOT).read().splitlines()
    watched = {
        "frontend/src/routeTree.gen.ts": "generated by the route plugin",
        "frontend/worker-configuration.d.ts": "generated by wrangler types",
    }
    for path, why in watched.items():
        if path not in tracked:
            report.note(f"{path} is not tracked ({why}) — expected")
    vendored = [p for p in tracked if p.startswith("frontend/.agents/")]
    if vendored:
        report.problem(f"frontend/.agents/ is generated but {len(vendored)} file(s) are tracked")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--verbose", action="store_true", help="list every ledger entry")
    args = parser.parse_args()

    report = Report()
    print(f"Agent hook doctor — {ROOT.name}")
    print(f"  root       {ROOT}\n")

    total_targets = 0
    implementations = set()
    for name, (tool, why) in EXPECTED.items():
        path = ROOT / name
        payload = load_json(path, report)
        if payload is None:
            print(f"  {tool:<10} {name:<34} MISSING")
            continue
        commands = hook_commands(payload, path.parent, report, name)
        events = sorted((payload.get("hooks") or {}).keys())
        print(f"  {tool:<10} {name:<34} {len(commands)} hook(s) on {', '.join(events) or 'no events'}")
        print(f"  {'':<10} {'':<34} {why}")
        for event, text, gi, hi in commands:
            total_targets += verify_targets(text, path.parent, report, f"{name} [{event}:{gi}:{hi}]")
            for match in re.finditer(r"(?:scripts/hooks|\.intent/hooks)/[^\"'\s]+", text):
                implementations.add(match.group(0))

    if implementations:
        print(f"  Impl       {', '.join(sorted(implementations))}")
    print(f"  Targets    {total_targets} command path(s) verified\n")

    check_ledger(read_codex_ledger(), report, args.verbose)
    check_claude_trust(report)
    check_unexpected_registrations(report)
    check_generated_untracked(report)

    if report.notes:
        print("\nNotes")
        for note in report.notes:
            print(f"  - {note}")

    if report.problems:
        print("\nProblems")
        for problem in report.problems:
            print(f"  ! {problem}")
        print(f"\n{len(report.problems)} problem(s)")
        return 1

    print("\nNo problems. Registration and targets line up; recorded trust exists for every Codex hook.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
