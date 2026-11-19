# 00 — Overview

## 1. Problem

The team runs visual regression checks for several client websites (e.g. Stagen,
TransCelerate, BioCelerate, SunAuto) with a local Node CLI (`prototype/`). It works,
but:

* it runs on one laptop (Chrome path, `.env`, `sitemap.txt`, checkpoint file are local);
* one `.env` = one site, so switching projects means swapping files;
* reports are static HTML in R2 with no way to review, approve or discuss changes;
* nobody is notified when a comparison finds changes;
* only a 1280 px desktop viewport is captured.

## 2. Goal

A hosted web application where authorised users can, per project:

1. keep project settings (site name, sitemap, R2 bucket, public URL, basic auth, viewports, thresholds, ignore rules);
2. fetch and inspect the sitemap URL list;
3. start a **capture run** (screenshots + file fingerprints) and watch progress live;
4. **compare** any two runs, review the result in the browser, approve/reject/ignore each change;
5. promote a run to **baseline**;
6. get **notified** (email / Slack) when a comparison finishes with changes;
7. manage storage (usage vs. free tier, delete runs).

Behaviour of capture and diff must match the prototype so results remain comparable
with existing R2 data (and existing prototype runs can be imported).

## 3. Users (personas)

| Persona | Typical actions |
|---------|-----------------|
| **Platform admin** (Vasyl) | Creates projects, invites users, sets credentials, manages storage |
| **Project editor** (developer / QA) | Fetches sitemap, runs captures before/after a deploy, compares, reviews diffs |
| **Project viewer** (PM / client) | Opens comparison reports, reads results, may use a public share link |

## 4. Scope v1

In scope: everything in §2, multiple projects, multiple users, multiple viewports,
notifications, approve/ignore, legacy import of prototype runs, public share links.

## 5. Non-goals (v1)

* Scheduled/cron runs (data model and job API must not block adding them — M6).
* Visual testing of authenticated app flows (login forms, clicks). Only HTTP basic auth is supported, as in the prototype.
* Cross-browser (Firefox/WebKit) capture. Chromium only.
* AI/semantic diffing. Pixel diff + fingerprint only.
* Billing / multi-tenant SaaS. Single organisation, invite-only.
* Replacing the CLI. The prototype keeps working; the new engine package may later back a new CLI.

## 6. Glossary

| Term | Meaning |
|------|---------|
| **Project** | One website under test. Has settings, members, runs. Replaces one prototype `.env`. |
| **Sitemap snapshot** | The URL list produced by fetching `sitemap_index` at a point in time (prototype `sitemap.txt`). |
| **Page URL** | A URL that is screenshotted. |
| **File URL** | A URL whose extension is in `FILE_EXTENSIONS` (pdf, docx, zip, …). Fingerprinted (SHA-256), not screenshotted. |
| **Viewport** | Named width × height used for capture (`desktop` 1280×900 default). |
| **Capture run** (run) | One execution of screenshotting/fingerprinting a URL list for 1..n viewports. Identified by a timestamp label `YYYY-MM-DD_HH-MM-SS` (prototype `<timestamp>`). |
| **Run item** | One (URL, viewport) pair inside a run (or one URL for files). |
| **Comparison** | Diff of two runs: *before* and *after*. Prototype `<before>_vs_<after>`. |
| **Comparison item** | Result for one (URL, viewport) or file: `changed`, `unchanged`, `new`, `missing`, `redirect`, `error`. |
| **Review status** | Human decision on a changed item: `pending`, `approved`, `rejected`, `ignored`. |
| **Baseline** | The run that new runs are compared against by default. One per project. |
| **Ignore rule** | URL pattern, CSS selector or pixel region excluded from capture or diff. |
| **Legacy run** | A screenshot set in R2 created by the prototype (no viewport sub-folder). |
