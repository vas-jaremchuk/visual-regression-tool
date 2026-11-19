# 04 — Authentication & roles

## 1. Sign-in

* Supabase Auth with **email magic link** and **Google OAuth** (Google optional, enabled by env).
* **Invite-only.** A user can complete sign-up only if a valid, unexpired invitation exists for
  the email (case-insensitive). Enforced server-side with a Supabase *before user created* auth
  hook (or, if unavailable, a check in the auth callback that deletes the user and shows
  "Not invited"). REQ-AUTH-1.
* First platform admin is created by `pnpm seed:admin <email>` (script using service role). REQ-AUTH-2.
* Sessions via `@supabase/ssr` cookies; Next.js middleware refreshes the session and redirects
  unauthenticated users to `/login?next=…`. REQ-AUTH-3.
* Disabled users (`profiles.disabled_at`) are signed out on next request and cannot sign in. REQ-AUTH-4.

## 2. Roles

* **Platform admin** (`profiles.is_platform_admin`): everything, including creating projects,
  managing all users, global storage page.
* **Project role** in `project_members`: `admin` > `editor` > `viewer`.

## 3. Permission matrix

| Action | viewer | editor | project admin | platform admin |
|--------|:-:|:-:|:-:|:-:|
| See project, runs, comparisons, reports | ✓ | ✓ | ✓ | ✓ |
| Fetch sitemap, add manual URLs | | ✓ | ✓ | ✓ |
| Start / cancel / retry run | | ✓ | ✓ | ✓ |
| Start comparison | | ✓ | ✓ | ✓ |
| Approve / reject / ignore diffs | | ✓ | ✓ | ✓ |
| Set baseline | | ✓ | ✓ | ✓ |
| Manage ignore rules | | ✓ | ✓ | ✓ |
| Create / revoke public share link | | ✓ | ✓ | ✓ |
| Edit project settings, viewports, notifications | | | ✓ | ✓ |
| Manage members / invite to project | | | ✓ | ✓ |
| Delete runs / comparisons | | | ✓ | ✓ |
| Archive / delete project | | | | ✓ |
| Create project | | | | ✓ |
| Manage users (disable, promote admin) | | | | ✓ |

Every permission is enforced **twice**: RLS in the database and a server-side check
(`assertCan(user, action, projectId)`) in every route/action. UI hides actions the user cannot
perform but never relies on hiding. REQ-AUTH-5.

## 4. Invitations

* Project admin enters email + role → invitation row + email with link `APP_URL/invite/<token>`.
* If the user already exists, they are added to `project_members` directly and notified.
* Accepting: link → sign-in → membership created → invitation `accepted_at` set.
* Invitations expire after 7 days; can be resent/revoked. REQ-AUTH-6.

## 5. Public share links

* An editor can create a share link for a comparison: random 32-byte token, only its sha256 is
  stored; optional expiry (default 30 days).
* `GET /share/<token>` renders a **read-only** report without login (no review buttons, no
  settings, no other pages). Images are served via short-lived signed R2 URLs (or the public
  bucket URL if configured). REQ-AUTH-7.
* Revoking clears the hash; old links return 404.

## 6. Service-to-service auth

* Web → Worker: `Authorization: VRT-HMAC <timestamp>:<hex hmac_sha256(secret, timestamp + "\n" + method + "\n" + path + "\n" + sha256(body))>`;
  reject if clock skew > 5 min. REQ-AUTH-8.
* Worker → Container: bearer `DIFF_CONTAINER_SHARED_SECRET`.
* Worker/Container → Supabase: service role key; never exposed to browsers.
