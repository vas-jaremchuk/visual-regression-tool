# T23 — Legacy import of prototype runs

**Milestone:** M5
**Depends on:** T12

## Spec refs
- `specification/07-features.md F-RUN-6`
- `specification/02-data-model.md §3 legacy`
- `specification/05-engine.md §1–§2, §5`

## Scope
- List `screenshots/<ts>/` prefixes not in DB; select and import as `is_legacy` runs.
- Items from `.png` (viewport `desktop`, ignore legacy file screenshots) and `.txt` (parse fingerprint).
- URL reconstruction from latest snapshot by filename; unknown URLs keep `url=null` and show filename.

## Acceptance criteria
- [ ] Fixture bucket in prototype layout imports with correct counts.
- [ ] Legacy run compares with a new desktop run without errors.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
- Anything not listed in Scope; see `specification/12-delivery-plan.md` for the owning ticket.
