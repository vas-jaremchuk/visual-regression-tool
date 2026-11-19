# T21 — Notifications: email and Slack

**Milestone:** M5
**Depends on:** T15

## Spec refs
- `docs/specification/07-features.md F-NOTIFY-1..5`
- `docs/specification/02-data-model.md notification_*`
- `docs/specification/06-jobs.md §2 step 4, §5 step 9`

## Scope
- Notifications settings tab: channels CRUD, events, test send, delivery log.
- Notifier implementation (Resend email HTML+text, Slack Block Kit) with retries and `notification_log`.
- Personal mute per project in `/account`.
- Wired into capture and compare finalise steps.

## Acceptance criteria
- [ ] Test send works with fakes; Slack webhook URL never returned to client.
- [ ] `comparison_changed` vs `comparison_clean` chosen correctly (pending/rejected changes or changed files).
- [ ] Muted user receives no email.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
- Anything not listed in Scope; see `docs/specification/12-delivery-plan.md` for the owning ticket.
