#!/bin/bash
# Creates one GitHub issue per ticket file, with milestone labels. Does NOT add the `tessl` label.
# Usage: bash create-issues.sh <owner/repo>
set -eo pipefail
REPO="${1:?usage: create-issues.sh owner/repo}"
DIR="$(cd "$(dirname "$0")/issues" && pwd)"
for m in M0 M1 M2 M3 M4 M5; do gh label create "$m" --repo "$REPO" --color BFD4F2 --force >/dev/null; done
gh label create tessl --repo "$REPO" --color 5319E7 --description "Hand to Tessl factory" --force >/dev/null
for f in "$DIR"/T*.md; do
  title="$(head -1 "$f" | sed "s/^# //")"
  ms="$(grep -m1 "^\*\*Milestone:\*\*" "$f" | sed -E "s/.*(M[0-9]).*/\1/")"
  if gh issue list --repo "$REPO" --state all --search "\"$title\" in:title" --json number --jq ".[0].number" | grep -q .; then
    echo "skip (exists): $title"; continue
  fi
  gh issue create --repo "$REPO" --title "$title" --body-file "$f" --label "$ms"
done
echo "Done. Add the tessl label in dependency order (see 12-delivery-plan.md)."
