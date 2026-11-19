# T03 — Shared package: contracts, env schemas, crypto, HMAC, R2 keys

**Milestone:** M0
**Depends on:** T01

## Spec refs
- `specification/03-configuration.md §2–§5`
- `specification/04-auth-and-roles.md §6`
- `specification/02-data-model.md §3`
- `specification/09-api.md §2–§4`

## Scope
- `env.ts`: zod `webEnv`, `workerEnv`, `containerEnv` with helpful errors; test that keys match each app's `.env.example`.
- `crypto.ts`: AES-256-GCM encrypt/decrypt with `v1:` format and multi-key rotation (WebCrypto only).
- `hmac.ts`: sign/verify `VRT-HMAC` header incl. 5-min skew check.
- `r2-keys.ts`: builders for every key in 02 §3 incl. legacy layout; parsers for legacy listings.
- `contracts/`: zod schemas for all API bodies/responses in 09 (web routes, worker routes, queue messages, container `/diff`), `projectSettingsSchema` with min/max.
- `constants.ts`: defaults (viewport, thresholds, timeouts, free tier 10 GB).

## Acceptance criteria
- [ ] Runs in Node, Next.js edge/server and Workers (no Node-only APIs) — verified by a test using `@cloudflare/vitest-pool-workers` or equivalent.
- [ ] Encrypt→decrypt round-trip; decrypt with rotated key; tampered ciphertext rejected.
- [ ] HMAC rejects wrong body, wrong path, skew > 5 min.
- [ ] R2 key builders covered by tests incl. viewport and legacy cases.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
R2 network client (T05).
