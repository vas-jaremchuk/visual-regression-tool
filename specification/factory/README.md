# Factory kit (Tessl)

Tessl's factory picks up **GitHub issues labelled `tessl`** and turns each into a pull request
(loops: *Implement ticket*, *Shepherd PR*, *Follow ticket changes*, *Merge conflict sweep*).
This folder contains what the repository needs so those agent runs succeed.

| File | Copy to (in the new app repo) | Purpose |
|------|-------------------------------|---------|
| `AGENTS.md` | `/AGENTS.md` | Rules every agent run follows (stack, conventions, DoD, where the spec is) |
| `.tessl/cloud-launch-setup.sh` | `/.tessl/cloud-launch-setup.sh` | Installs deps + Supabase CLI before each cloud run |
| `issues/Txx-*.md` | GitHub issues | One ticket per file; first line = title |
| `create-issues.sh` | run locally | Creates the issues with `gh` (without the `tessl` label) |

## Setup

```bash
# 1. In the new repo
mkdir -p docs/reference/prototype && cp -R ../visual-regression-tool/specification docs/specification
# reference copy of the prototype: sources only — no .env, no sitemap*.txt, no node_modules
cp ../visual-regression-tool/prototype/{*.js,package.json,README.md,.env.example} docs/reference/prototype/
cp docs/specification/factory/AGENTS.md ./AGENTS.md
mkdir -p .tessl && cp docs/specification/factory/.tessl/cloud-launch-setup.sh .tessl/
git add . && git commit -m "docs: add specification and agent rules" && git push

# 2. Connect the repo to Tessl (Tessl app → factory setup), select this repo.

# 3. Create issues (milestones M0..M5) — needs gh auth
bash docs/specification/factory/create-issues.sh <owner/repo>

# 4. Hand work to the factory in dependency order (12-delivery-plan.md):
gh issue edit <T01 number> --add-label tessl
```

## Working rhythm

* Label only tickets whose dependencies are merged. T02, T03, T04 can run in parallel after T01.
* Review each PR yourself; comment on the PR — the *Shepherd PR* loop applies feedback.
* If a ticket turns out too large, ask the agent (in the issue) to split it and stop.
* When a spec decision changes, edit `docs/specification/*` in a normal PR **first**, then
  label dependent tickets — agents read the spec from the default branch.
* Tickets needing real Cloudflare/Supabase credentials (T09 deploy, T26 smoke) need secrets in the
  Tessl environment; everything else must run against local Supabase and fakes.
