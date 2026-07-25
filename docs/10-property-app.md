# 10 – Property App

The property agent CRM: agents log mortgage-referral cases, the system computes and tracks their commissions, reminds them when a client's lock-in period ends (the next referral opportunity), and syncs follow-ups to Google Calendar.

This app predates the insurance CRM and is simpler by design — its center of gravity is **commission accounting**, not advisory workflows.

## The business in one paragraph

A property agent refers a client's mortgage to TLC. When the referral converts, commission is computed from the outstanding loan (`lib/property/commission.ts`: gross = 0.15% of outstanding loan; split 90% agent / 10% TLC — constants live in that one file). The `property_cases` table carries both **projected** figures (what this case should pay out) and **actual** figures (what it did), plus recurring-conversion tracking — which is why it has a dozen numeric columns where the insurance app has a JSONB blob: money reporting wants queryable columns.

## Pages (`app/property/*`)

| Route | What it does |
|-------|--------------|
| `/property/dashboard` | Overview: stats, urgent items |
| `/property/cases`, `/cases/new`, `/cases/[id]`, `/cases/[id]/edit` | Case list / create / detail / edit |
| `/property/earnings` | Commission summaries (`CommissionHero` component) |
| `/property/followup` | Upcoming follow-ups |
| `/property/notifications` | In-app notifications |
| `/property/profile` | Profile + Google account connection |
| `/property/login`, `/signup`, `/forgot-password` | Auth pages (excluded from the middleware gate) |

Admin side: `/admin/property/cases` (with `update-case` override API), `/admin/property/analytics`, `/admin/property/reminders` (inspect/trigger the reminder queue). The old `app/dashboard/*` tree is a legacy remnant of the pre-split app; `/dashboard/rates` now just redirects to the shared insurance rates page.

## Cases and documents

- Case shape and status/commission enums: `lib/types/property.ts` (statuses flow `draft → submitted → under_review → verified → paid`, plus `on_hold` / `opportunity_due`; the DB enforces them as Postgres enums, unlike the insurance app's text stages).
- **Documents**: `DocumentUploader.tsx` uploads to Supabase Storage; `property_case_documents` stores the URLs per case, via `/api/property/cases/[id]/documents`.
- **Duplicate flagging**: `is_duplicate` / `duplicate_reason` columns let admins mark double-entered referrals without deleting history.
- **Activity log**: `property_case_activity_logs` records changes (old/new value JSONB).

## The reminder engine (the retention feature)

A mortgage lock-in ending is a re-referral opportunity, so the system tracks it automatically:

- `property_reminders` queues reminders (e.g. lock-in ending) with a `trigger_date`.
- Daily cron `/api/property/reminders/process` (01:00 UTC) → `lib/property/processReminders.ts`: finds due unsent reminders, transitions eligible cases to `opportunity_due`, emails the agent (`lib/email/sendFollowUpReminder.ts` via Resend), marks reminders sent. Errors are collected per-item, not thrown — one bad row can't block the batch.
- Admin can inspect and manually run the queue (`/api/admin/property/reminders/run`).

## Google Calendar integration

Property agents connect Google from `/property/profile`:

- OAuth flow: `/api/property/google/auth` → Google consent → `/api/property/google/callback`; refresh token stored on `profiles.google_refresh_token` (a service-role-only column — see [04 – Auth & Security](04-auth-security.md)).
- Follow-up dates sync to the agent's calendar (`lib/google/syncFollowUp.ts`); `property_calendar_events` maps case ↔ Google event IDs so later date changes update/delete the same event instead of duplicating.
- `/api/property/google/status` and `/disconnect` power the profile UI. (The insurance app has a parallel, newer sync path: `syncFollowUpInsurance.ts` + `/api/insurance/google/*`.)

## Legacy/recovery paths

`lib/services/sheets-sync.ts` plus `/api/admin/property/restore-from-sheets` and `/restore-agents` exist for restoring data from the pre-CRM Google Sheets era. `scripts/google-apps-script/` holds the Apps Script sources from that era. Not part of daily operation — don't build on them.
