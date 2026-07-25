# 04 – Auth & Security

Who can see what, and the three layers that enforce it. The layers are deliberately redundant — each catches a different class of failure.

## The model in one paragraph

Supabase Auth handles identity (passwords, sessions, cookies). The shared `profiles` table adds *what kind* of user each identity is (`role`: `agent` / `admin` / `super_admin`; `app_type`: `insurance` / `property`; `status`: active/disabled). Layer 1 (middleware) checks you're logged in; layer 2 (route guards + layouts) checks you're the right kind of user; layer 3 (Row Level Security) makes the database itself refuse to serve rows you don't own.

## Layer 1 — Middleware ([middleware.ts](../middleware.ts))

Runs at the edge on every `/property/*` and `/insurance/*` **page** navigation (its matcher excludes `/api` and static assets). It does exactly three cheap things:

1. **Refreshes the Supabase session cookie** (and carries rotated cookies onto redirects — a subtle bug fix documented in the file: lose those and a browser gets stuck with a dead refresh token).
2. **Bounces unauthenticated visitors** to the correct login page for their URL prefix. Login / signup / forgot-password pages are excluded from the gate.
3. **Bounces disabled accounts** to login with `?reason=suspended` (checked via a direct service-role query on `profiles.status`).

It deliberately does **not** check roles — that keeps it fast and keeps authorization logic in one place further down.

## Layer 2 — Route guards and layouts

**Server-side (the real enforcement).** Every API route starts with a guard:

| Guard | File | Protects |
|-------|------|----------|
| `requireAdminUser()` | `lib/auth/requireAdmin.ts` | Every `/api/admin/*` route. Accepts `admin` and `super_admin` |
| `requirePropertyUser()` | `lib/auth/requirePropertyUser.ts` | `/api/property/*` routes |
| `requireInsuranceUser()` / `getServerUser()` + `canAccessInsurance()` | `lib/auth/` | `/api/insurance/*` routes |
| `requireCron()` | `lib/auth/requireCron.ts` | `/api/cron/*` — requires `Bearer CRON_SECRET`; **fail-closed in production** (no secret set = no cron runs) |

The pattern is always the same guard-clause shape:

```ts
const auth = await requireAdminUser()
if (!auth.authorized) return auth.response   // 401 or 403, already built
```

**Client-side (UX only).** Each app's `layout.tsx` also checks role/app_type and redirects wrong-app users to their home via `getSafeRoute()`. This makes the UI honest but is *not* security — a curious user can bypass any client-side check. The server-side guards are the enforcement.

**Role checks always go through `lib/permissions/`** (`canAccessInsurance()`, `canAccessProperty()`, `isAdmin()`, `getSafeRoute()`). Never write `profile.role === 'admin'` inline in feature code — one file owns the meaning of every role.

## Layer 3 — Row Level Security (RLS)

Postgres policies that run *inside the database*, so even buggy application code can't leak rows. Reference: `supabase/schema/full_current_schema.sql` (includes all policies); hardening migration: `supabase/migrations/20260705000000_rls_hardening.sql`.

Three patterns in use:

1. **Owner-scoped tables** (`cases`, `property_cases`, …): agents' queries only return rows where they are the owner; admin access goes through the `is_admin_user()` SECURITY DEFINER function. *Gotcha preserved in the migration: never subquery `profiles` directly inside a `profiles` policy — it recurses infinitely; that's exactly what the SECURITY DEFINER function exists to avoid.*
2. **Column-restricted self-update on `profiles`**: users may update only identity fields (`name`, `full_name`, `mobile`, `cea_registration_no`, `agency_name`). `role`, `app_type`, `status`, Google tokens, and session columns are writable only via service-role API routes. **Do not widen this grant** — it is the difference between "user edits their phone number" and "user promotes themselves to admin."
3. **No-client-policy tables** (knowledge, rates, news, calendar, SORA): RLS is enabled with *zero* policies for browser roles, so the anon key can read nothing. All access flows through guarded server routes using the service-role client. This is deliberate: content is a curated product, served only through APIs that decide what agents may see (e.g. agents get published rate packages only; admins also see drafts).

## Signup, sessions, and account lifecycle

- **Insurance signup is invite-gated**: admins issue invites (`agent_invites`, email-locked tokens) after offline payment; the signup page requires a valid invite. Rate limiting (Upstash) and an admin audit log harden the auth surface.
- **Single concurrent session**: on every login, `/api/auth/register-session` revokes the previous device's refresh token (`admin.signOut(token, 'others')`). The old device's next auth check fails naturally — no local bookkeeping.
- **Password reset is admin-mediated**: an admin sets a temporary password from `/admin/users`; the agent changes it on their Profile page. There is no self-service email reset for agents.
- **Admin actions are audited** in `admin_audit_log` (`lib/auth/auditLog.ts`), viewable at `/admin/audit-log`.
- **Consent**: `LegalConsentModal` + `lib/legal/` track versioned T&C/privacy acceptance in `user_consents`; `/consent/renew` handles re-acceptance when versions bump.

## Why three layers (the architect's summary)

| Layer | Protects against |
|-------|-----------------|
| Middleware | Strangers (no session at all) |
| Route guards | The wrong *kind* of insider (property agent calling insurance APIs, agent calling admin APIs) |
| RLS | **Your own future bugs** — a mistake in a new route can't leak rows the database itself refuses to release |

When adding any new feature, walk this checklist: does the new API route have the right guard? Does the new table have RLS + the right policy pattern (owner-scoped vs. no-client-policy)? Does the UI use `lib/permissions/` helpers?
