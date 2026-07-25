# 11 – Operations

Running the system: environments, secrets, deployment, scheduled jobs, backups, and the isolation model for future developers.

## Environments

- **Production**: Vercel (hosting + crons) + Supabase (DB/auth/storage). Deploys from `main`. Step-by-step production checklist: [DEPLOYMENT.md](../DEPLOYMENT.md).
- **Local dev**: `npm run dev` with `.env.local`. Currently local dev points at the production Supabase project — acceptable for a solo operator, **not** acceptable once anyone else joins (see the staging model below).
- **Hosting decision (2026-07)**: staying on Vercel — the cron jobs and puppeteer/chromium PDF generation depend on it.

## Environment variables (`.env.local` locally, Vercel dashboard in prod)

| Variable | Used for |
|----------|----------|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase — safe for the browser (RLS limits what the anon key can do) |
| `SUPABASE_SERVICE_ROLE_KEY` | **The god key** — bypasses RLS entirely. Server-only, never expose, rotate on any suspected leak |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Transactional email |
| `NEXT_PUBLIC_APP_URL` | Absolute URLs in emails/links |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth (calendar sync) |
| `GEMINI_API_KEY` | Knowledge-engine answers, rate-sheet extraction (free tier: ~20 req/day/model) |
| `DEEPSEEK_API_KEY` | News classification, bank-report summaries (paid, higher volume) |
| `MAS_API_KEY` | Daily SORA fetch (`keyid` header) |
| `FRED_API_KEY` | US CPI values + Fed funds chart |
| `CRON_SECRET` | Auth for `/api/cron/*` — **required in production; crons fail closed without it** |

DEPLOYMENT.md lists a few additional Google service-account / Apps Script variables used by legacy property-side integrations. `NEXT_PUBLIC_*` variables are compiled into browser code — everything else stays server-side. Never commit `.env.local`; never put a secret in a `NEXT_PUBLIC_*` name.

## Deploying

1. Merge/push to `main` → Vercel builds and deploys automatically.
2. Schema changed? `npx supabase db push` (migration files) — deploy code and schema together thoughtfully: additive migrations first, then code that uses them.
3. Touched the embedding function? `supabase functions deploy embed` (separate from `db push` — easy to forget).
4. Sanity gates before pushing: `npm test` (financial core), `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## Scheduled jobs (`vercel.json`)

All five crons authenticate via `Bearer CRON_SECRET` (`lib/auth/requireCron.ts`, fail-closed in prod). Times are UTC; chosen so data is fresh by Singapore morning:

| UTC | SGT | Job |
|-----|-----|-----|
| 01:00 | 09:00 | Property follow-up reminder emails |
| 02:00 | 10:00 | SORA fetch (MAS publishes ~09:30 SGT — cron runs just after) |
| 05:00 | 13:00 | News ingestion + classification |
| 06:00 | 14:00 | Economic calendar refresh (FOMC + FRED values) |
| 07:00 | 15:00 | Bank report discovery + summarization |

Every cron also has a manual "Refresh now" path in the relevant admin console, so a failed run never blocks the day.

**Shared cron rules:** upserts exclude admin-owned columns (an automated run must never overwrite a human edit); classification failures degrade safely (news defaults to *not relevant*; extraction failures fall back or wait for `reExtract`).

## Backups & recovery

Runbooks: [BACKUP_SETUP.md](BACKUP_SETUP.md) and [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md). The structural half of recovery is already in the repo: `supabase/migrations/` can rebuild the entire schema (incl. RLS) on an empty project; `schema/full_current_schema.sql` is the human-readable reference (`npm run sync-schema` regenerates it). Data is the part that needs the backup runbooks.

## Monitoring & errors

Sentry (`@sentry/nextjs`) captures runtime errors. Server routes log with prefixed tags (e.g. `[send-report]`) — visible in Vercel's function logs. Rate limiting on the auth surface uses Upstash Redis.

## Future developer onboarding (the isolation model)

Decided policy (2026-07): a hired developer must never see production/business data. The model:

1. **Two worlds.** Developer gets: the repo, a **separate staging Supabase project** (schema rebuilt via `npx supabase db push` + `supabase functions deploy embed`, seeded with fake data — `seed-test-cases.sql`), and a `.env.local` containing **staging keys only**. Developer does *not* get: production Supabase/Vercel dashboard accounts (no account at all, not a restricted one), production keys, or data exports.
2. **The bridge is code review.** Branch protection on `main`; every change lands via a pull request the owner personally reviews. Review is a security control — code that runs in production can read production data regardless of who wrote it, so the diff review is what stands between a malicious change and the data.
3. **Vercel previews** must use staging keys in the preview environment, so PR preview builds run against fake data.
4. **Key hygiene:** rotate all keys at hire/fire or any suspected exposure (Supabase and Resend regenerate in minutes).
5. **Debugging policy, decided in advance:** production data is never handed over "to debug." Reproduce on staging with mimicking fake data, or the owner screen-shares specific rows with sensitive fields covered.
