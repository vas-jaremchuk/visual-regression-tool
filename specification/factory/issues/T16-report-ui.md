# T16 — Report UI and item viewer

**Milestone:** M3
**Depends on:** T15

## Spec refs
- `docs/specification/07-features.md F-CMP-2..6`
- `docs/specification/08-ui.md §3 Report, Item viewer`
- `docs/specification/10-non-functional.md NFR-4`

## Scope
- Report page: header, summary chips (clickable filters), viewport tabs, virtualised changed list sorted by %, severity colours, files/redirect/new/missing sections, empty state wording.
- Item viewer modes: side-by-side, slider, overlay, diff only; sync scroll/zoom; deep link route; keyboard navigation (review keys wired in T18).
- Image URLs: public URL or signed URL endpoint `/api/r2/sign`.

## Acceptance criteria
- [ ] 1 000-item comparison renders within NFR-4 budget (Playwright perf assertion on fixture data).
- [ ] Signed URL endpoint refuses keys of other projects.
- [ ] All four viewer modes covered by e2e screenshots.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
Review actions (T18), share links (T17).
