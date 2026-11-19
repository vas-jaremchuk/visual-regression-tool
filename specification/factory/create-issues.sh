#!/bin/bash
# Wrapper kept for convenience — the real importer is import-issues.mjs (Node 18+, gh CLI).
# Usage: bash specification/factory/create-issues.sh [--repo owner/name] [--dry-run] [--label-mode auto|all|none]
set -eo pipefail
exec node "$(cd "$(dirname "$0")" && pwd)/import-issues.mjs" "$@"
