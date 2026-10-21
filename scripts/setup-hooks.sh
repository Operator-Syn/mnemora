#!/usr/bin/env bash
# Enable the repository's commit hooks for this clone.
#
# Hooks live in .githooks/ (tracked) because .git/hooks is not version controlled, so
# every clone has to opt in once. Run this after cloning.
set -euo pipefail

cd "$(dirname "$0")/.."

chmod +x .githooks/pre-commit
git config core.hooksPath .githooks

echo "core.hooksPath -> $(git config core.hooksPath)"
echo "Enforced: one file per commit (override with: git commit --no-verify)"
