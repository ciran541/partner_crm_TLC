# Production Deployment Guide

This document covers everything that must be changed or configured when deploying
the TLC Partner CRM from local development to live production.

---

## 1. Vercel — Environment Variables

Go to **Vercel Dashboard → Project → Settings → Environment Variables**.

Add every variable below. All of them should be set for the **Production** environment.

### Copy as-is from `.env.local` (no change needed)

| Variable | Note |
|----------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Same Supabase project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | Same Supabase project — keep secret, never expose |
| `RESEND_API_KEY` | Same Resend account |
| `RESEND_FROM_EMAIL` | `hello@theloanconnection.com.sg` |
| `GOOGLE_CLIENT_ID` | Same Google Cloud credential |
| `GOOGLE_CLIENT_SECRET` | Same Google Cloud credential |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Same service account |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Same service account key — paste the full value including `-----BEGIN PRIVATE KEY-----` |
| `TLC_GOOGLE_CALENDAR_ID` | Same TLC calendar ID |
| `GOOGLE_APPS_SCRIPT_URL` | Same Apps Script deployment URL |
| `APPS_SCRIPT_SECRET` | Same secret |

### Must change for production

| Variable | Dev value | Production value |
|----------|-----------|-----------------|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | `https://yourdomain.com` |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/api/property/google/callback` | `https://yourdomain.com/api/property/google/callback` |

### Do NOT add to Vercel (local dev only)

| Variable | Why |
|----------|-----|
| `SUPABASE_PROJECT_REF` | Only used for `npm run sync-schema` locally |
| `SUPABASE_ACCESS_TOKEN` | Only used for `npm run sync-schema` locally |

### Optional

| Variable | Purpose |
|----------|---------|
| `CRON_SECRET` | If set, the daily reminder cron endpoint (`/api/property/reminders/process`) requires `Authorization: Bearer <CRON_SECRET>` for manual calls. Vercel's own cron calls it automatically without this. Recommended for security. |

---

## 2. Google Cloud Console

URL: [console.cloud.google.com](https://console.cloud.google.com) → project `tlc-calendar-service`

### OAuth Redirect URI

1. **APIs & Services → Credentials → `TLC CRM Agent OAuth`** (your Web Application client)
2. Under **Authorised redirect URIs** → **Add URI**:
   ```
   https://yourdomain.com/api/property/google/callback
   ```
3. Keep the `http://localhost:3000/...` URI as well (for ongoing local dev)
4. Click **Save**

### Publish the OAuth App

1. **APIs & Services → Audience**
2. Click **Publish App** → **Confirm**
   > The "Publish" button only works once the redirect URIs are all HTTPS.
   > After publishing, any Google account can connect — no need to add test users.

---

## 3. Vercel Cron Job

Already configured in `vercel.json` — no changes needed.

```json
{
  "crons": [
    {
      "path": "/api/property/reminders/process",
      "schedule": "0 1 * * *"
    }
  ]
}
```

Runs daily at **1 AM UTC** (9 AM Singapore time).
Vercel automatically calls this endpoint on the schedule — no manual setup required.

> **Note:** Vercel Cron is only available on Pro plan and above. Verify your plan supports it.

---

## 4. What Does NOT Need Supabase URL Config

The property agent app does **not** use Supabase email-based auth flows
(forgot password and magic links have been removed).

- ❌ No Supabase Site URL needed
- ❌ No Supabase Redirect URLs needed
- ✅ Supabase just handles session auth — works out of the box

> If the insurance app is on the same Supabase project and uses forgot password,
> configure Supabase auth URLs for that domain separately.

---

## 5. After Deploying — Verify These Work

Go through this checklist after the first deploy:

- [ ] Login at `https://yourdomain.com/property/login` works
- [ ] Agent can create a case — check the case appears in Supabase
- [ ] Agent can connect Google Calendar at `/property/profile` → Integrations
- [ ] Creating a case with `followup_preference = 'self'` creates a calendar event in the agent's Google Calendar
- [ ] Creating a case with `followup_preference = 'tlc'` creates a calendar event in the TLC shared calendar
- [ ] Follow-up date change updates the calendar event
- [ ] Marking follow-up as done deletes the calendar event
- [ ] Follow-up reminder email arrives on the `follow_up_date` (test by setting a case's follow-up date to today and manually triggering `GET /api/property/reminders/process` with the `CRON_SECRET` header)
- [ ] Google Sheets sync works — submit a case and check the Google Sheet

---

## 6. Summary — Only 2 Things Actually Change

Everything else is copy-paste from `.env.local`.

| # | What | Where | Change |
|---|------|-------|--------|
| 1 | `NEXT_PUBLIC_APP_URL` | Vercel env vars | `http://localhost:3000` → `https://yourdomain.com` |
| 2 | `GOOGLE_REDIRECT_URI` | Vercel env vars | `http://localhost:3000/...` → `https://yourdomain.com/...` |
| 3 | Add production redirect URI | Google Cloud Console | Add `https://yourdomain.com/api/property/google/callback` |
| 4 | Publish OAuth app | Google Cloud Console | Click Publish App (one time) |
