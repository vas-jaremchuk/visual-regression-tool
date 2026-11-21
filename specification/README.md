# Visual Regression Tool (VRT) — Specification

Specification for turning the CLI prototype in `../prototype` into a multi-project,
multi-user web application hosted on **Vercel**, backed by **Supabase** (users,
projects, settings, run metadata) and **Cloudflare** (R2 storage, Browser Rendering,
Workflows, Queues, Containers for the heavy jobs).

The spec is written to be consumed by autonomous coding agents (a Tessl
"dark factory" or any other agent harness) as well as by humans. Every requirement
has an ID (`REQ-xxx`) so tickets, tests and PRs can reference it.

## How to read this

| # | Document | What it answers |
|---|----------|-----------------|
| 00 | [Overview](00-overview.md) | Why, who, scope, non-goals, glossary |
| 01 | [Architecture](01-architecture.md) | Components, data flow, key decisions (ADRs) |
| 02 | [Data model](02-data-model.md) | Supabase schema, RLS, R2 key layout |
| 03 | [Configuration](03-configuration.md) | `.env` for each app, per-project settings, secrets |
| 04 | [Auth & roles](04-auth-and-roles.md) | Sign-in, invitations, permissions matrix |
| 05 | [Capture & compare engine](05-engine.md) | Exact behaviour ported from the prototype |
| 06 | [Jobs & orchestration](06-jobs.md) | How runs execute on Cloudflare, progress, retries, cancel |
| 07 | [Features](07-features.md) | Functional requirements per feature area |
| 08 | [UI](08-ui.md) | Screens, navigation, states |
| 09 | [API](09-api.md) | Web app routes, worker contract, payloads |
| 10 | [Non-functional](10-non-functional.md) | Limits, performance, security, observability, cost |
| 11 | [Testing & acceptance](11-testing.md) | Test strategy, fixtures, definition of done |
| 12 | [Delivery plan](12-delivery-plan.md) | Milestones and ticket order |
| 13 | [Deployment setup](13-deployment-setup.md) | Secrets for GitHub/Cloudflare/Vercel/Supabase and how they link |
| — | [factory/](factory/) | Tessl factory kit: repo rules, setup hook, one issue file per ticket |

## Source of truth

* The **prototype** is the source of truth for *capture/compare behaviour*
  (normalisation CSS, lazy-load, thresholds, filename scheme, fingerprinting,
  redirect detection). `05-engine.md` restates it; if they disagree, raise it in
  the PR instead of guessing.
* This spec is the source of truth for everything else.

## Decisions taken with the product owner (2026-11-19)

| Topic | Decision |
|-------|----------|
| Job runner | Cloudflare (Browser Rendering + Workflows + Queues; Containers for pixel diff) |
| Auth | Supabase Auth, invite-only, global admin + per-project roles (admin / editor / viewer) |
| Settings | Per-project settings edited in the UI and stored in Supabase; `.env` only holds platform credentials |
| v1 extras | Multiple viewports, notifications (email + Slack), approve/ignore diffs |
| Out of v1 | Scheduled runs (designed for, not built — see `12-delivery-plan.md` M6) |

## Using this spec with Tessl

The app is built in this same repository (next to `prototype/` and `specification/`).
See [factory/README.md](factory/README.md): import the 26 tickets as GitHub issues with
`node specification/factory/import-issues.mjs` — they get native *blocked by* dependencies,
milestones, and the `tessl` label as soon as they are unblocked
(`factory/github/tessl-release.yml`, copied to `.github/workflows/`, does that automatically when blockers close).
