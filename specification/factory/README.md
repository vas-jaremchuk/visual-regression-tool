# Factory kit (Tessl)

The app is built **in this repository** (`apps/`, `packages/`, … next to `prototype/` and
`specification/`). Development is split into 26 tickets (`issues/T01…T26`), imported as GitHub
issues with native **blocked by** dependencies. The Tessl factory picks up issues labelled `tessl`.

## Files

| File | Purpose |
|------|---------|
| `issues/Txx-*.md` | Ticket text (source of truth — edit here, re-run the importer) |
| `issues.json` | Manifest: ticket id, title, milestone, `dependsOn` |
| `import-issues.mjs` | Importer (Node 18+, `gh` CLI). Idempotent |
| `create-issues.sh` | Wrapper for the importer |
| `issue-map.json` | Written by the importer: ticket id → issue number/URL |
| `github/tessl-release.yml` | GitHub Action: adds `tessl` to waiting issues once all blockers are closed — **copy to `.github/workflows/`** |
| `/.tessl/cloud-launch-setup.sh` | Installs deps before each Tessl cloud run |
| `/AGENTS.md` | Rules every agent run follows (below the Tessl-managed block) |

## Labels

| Label | Meaning |
|-------|---------|
| `tessl` | Ready — the Tessl factory works on it |
| `tessl:waiting` | Blocked by open issues — released automatically |

## Import

```bash
mkdir -p .github/workflows && cp specification/factory/github/tessl-release.yml .github/workflows/
git add -A && git commit -m "chore: tessl factory kit" && git push   # workflow must be on main
gh auth login                                            # once; needs Issues write on the repo
node specification/factory/import-issues.mjs --dry-run   # preview
node specification/factory/import-issues.mjs             # import (label mode: auto)
```

What it does: creates milestones `M0 Foundations` … `M5 Ops & release`, labels `tessl` and
`tessl:waiting`, one issue per ticket (title `T12 — …`, hidden marker `<!-- tessl-ticket:T12 -->`),
rewrites *Depends on* into issue links, adds GitHub *blocked by* relations, and labels:
T01 gets `tessl`, all others `tessl:waiting`.

Options: `--repo owner/name`, `--only T05,T06`, `--label-mode auto|all|none`
(`all` = put `tessl` on every open ticket now; `none` = no labels).

Re-running is safe: existing issues (found by marker or title) are updated, not duplicated, and
missing dependencies/labels are added. To change a ticket, edit `issues/Txx-*.md` or
`issues.json`, then re-run.

## Flow

```
T01 (tessl) ──PR "Closes #1" merged──▶ #1 closed
        └─▶ tessl-release.yml: T02, T03, T04 have no open blockers ─▶ +tessl, −tessl:waiting
                 └─▶ Tessl factory starts T02, T03, T04 in parallel … and so on
```

* Agents must write `Closes #N` in the PR (rule in `/AGENTS.md`); merging closes the issue and
  triggers the release workflow. Closing an issue manually also releases its dependants.
* Run the workflow manually (Actions → *Release unblocked Tessl tickets* → Run) if something was missed;
  it also runs every 6 hours.
* If Tessl does not react to labels added by the workflow's default token, create a fine-grained
  PAT (Issues: read & write on this repo) as secret `TESSL_RELEASE_TOKEN`.
* To pause the factory, remove `tessl` from an issue (Tessl stops work on it); add it back to resume.

## Before the first ticket

1. Commit the Tessl files already in the repo (`tessl.json`, `.tessl/`, `AGENTS.md`, `CLAUDE.md`, …).
2. Connect the repo in Tessl (factory setup) and set environment secrets — only local/dev values;
   agents run against local Supabase and fakes. Real Cloudflare credentials are needed only for T09
   (deploy pipeline) and T26 (staging smoke test).
3. Review each PR; comment on it and the *Shepherd PR* loop applies your feedback.
