# T08 — Projects CRUD, settings tabs, viewports, .env import, bucket check

**Milestone:** M1
**Depends on:** T06, T05

## Spec refs
- `docs/specification/03-configuration.md §1, §5, §6`
- `docs/specification/07-features.md F-PROJ-1..6, F-VIEWPORT-1`
- `docs/specification/08-ui.md §1, §3`

## Scope
- Create project (platform admin) with default viewport; slug generation.
- Settings tabs: General, Storage, Access, Capture, Viewports, Diff, Danger zone (Notifications/Ignore rules tabs are placeholders linking to later tickets).
- Basic auth password encrypted on save; UI shows set/replace/clear.
- Viewports CRUD with presets, reorder, slug immutability once used.
- `.env` import dialog with preview (F-PROJ-4).
- Check bucket / create bucket / test public URL (F-PROJ-5).
- Archive project; delete project = mark `archived_at` + call worker delete later (button disabled with tooltip until T22).
- Project overview page skeleton with cards (data filled by later tickets).

## Acceptance criteria
- [ ] Validation errors shown inline from `projectSettingsSchema`.
- [ ] Prototype `.env.example` with real values imports correctly (fixture).
- [ ] Settings changes audited with secrets redacted.
- [ ] Editor/viewer cannot open settings (403).
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
Notifications (T21), ignore rules (T19).
