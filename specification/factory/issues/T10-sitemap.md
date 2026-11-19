# T10 — Sitemap workflow and sitemap UI

**Milestone:** M2
**Depends on:** T04, T08, T09

## Spec refs
- `specification/05-engine.md §3`
- `specification/06-jobs.md §1`
- `specification/07-features.md F-SITEMAP-1..5`
- `specification/10-non-functional.md NFR-14`

## Scope
- `POST /api/projects/:id/sitemap` → snapshot row → worker `/jobs/sitemap` → `SitemapWorkflow`: fetch, child sitemaps, manual URLs, redirect check, ignore url rules, write `sitemap_urls`, counts, status.
- SSRF guard used for every outbound fetch.
- Sitemap page: snapshots list, URL table with filters/search/counts, export `.txt`, diff vs previous snapshot, manual URL management.
- Realtime status of the running snapshot.

## Acceptance criteria
- [ ] Fixture site: index with 2 children → correct URL count; redirect excluded with target; PDF kind=file; 404 kept with warning.
- [ ] Basic-auth fixture site works with stored credentials.
- [ ] Private IP sitemap URL rejected.
- [ ] Exported `.txt` matches prototype `sitemap.txt` format.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
- Anything not listed in Scope; see `specification/12-delivery-plan.md` for the owning ticket.
