#!/bin/bash
# Tessl cloud setup hook — runs from the clone root before each agent run.
# Must be idempotent and exit 0. Do not replace Node.js.
set -eo pipefail

echo "== Node: $(node --version)"

echo "== Enabling pnpm via corepack"
mkdir -p "$HOME/.local/bin"
if ! command -v pnpm >/dev/null; then
  corepack enable --install-directory "$HOME/.local/bin" || npm install -g pnpm --prefix "$HOME/.local"
fi
export PATH="$HOME/.local/bin:$PATH"

if [ -f pnpm-lock.yaml ]; then
  echo "== Installing dependencies from lockfile"
  pnpm install --frozen-lockfile
else
  echo "== No lockfile yet (bootstrap ticket T01) — skipping install"
fi

echo "== Installing Supabase CLI (local DB for tests)"
if ! command -v supabase >/dev/null; then
  SUPA_VER="${SUPABASE_CLI_VERSION:-latest}"
  if [ "$SUPA_VER" = "latest" ]; then
    URL="https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz"
  else
    URL="https://github.com/supabase/cli/releases/download/v${SUPA_VER}/supabase_linux_amd64.tar.gz"
  fi
  curl -fsSL "$URL" | tar -xz -C "$HOME/.local/bin" supabase || echo "WARN: supabase CLI install failed (DB tests will be skipped)"
fi

if [ -d apps/web ] && [ -f apps/web/package.json ]; then
  echo "== Installing Playwright Chromium (e2e)"
  pnpm --filter web exec playwright install --with-deps chromium || echo "WARN: playwright browser install failed"
fi

echo "== Setup complete"
