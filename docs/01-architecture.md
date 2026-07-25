# 01 – Architecture

The big picture: what this system is, the five structural decisions that shape it, and how a single request flows through the stack.

## What this is

One Next.js application serving **two separate businesses** for two separate user groups who never see each other's data:

- **Property Agent CRM** (`/property/*`) — property agents log referral cases, track commissions, upload documents, get follow-up reminders.
- **Insurance CRM** (`/insurance/*`) — insurance agents run mortgage advisory workflows (refinancing, purchase, decoupling, equity loans), compare live bank rates, search a knowledge base, and read curated market intelligence.
- **Shared admin area** (`/admin/*`) — user management, analytics, and content curation for both apps.

## Decision 1 — One codebase, two products (multi-tenancy)

The two apps share one deployment, one login system, one database, and one component library. They are separated **by URL prefix and by data checks**, not by physical isolation.

> **Why:** one person operates everything. Two codebases would double the deploys, bills, and maintenance. The cost of this choice is discipline: nothing physically stops an insurance agent's request from touching property data — every page and API route must check *which kind of user* is asking. That check (`app_type` + `role` on the shared `profiles` table) is the single most repeated pattern in the codebase. See [04 – Auth & Security](04-auth-security.md).

## Decision 2 — Rent the commodities, own the logic

| Need | Provider | Where it's wired up |
|------|----------|---------------------|
| Database, login, file storage, RLS | Supabase | `lib/supabase/` (three clients — see below) |
| Hosting, scheduled jobs, previews | Vercel | `vercel.json` (5 daily crons) |
| Transactional email | Resend | `lib/email/` |
| PDF generation | puppeteer-core + @sparticuz/chromium-min | `lib/email/generatePdf.ts` |
| AI: knowledge answers, rate-sheet extraction | Gemini | `lib/insurance/askGemini.ts`, `extractPackages.ts` |
| AI: news classification, bank report summaries | DeepSeek | `lib/insurance/news.ts`, `bankIntelligence.ts` |
| Rate limiting | Upstash Redis | `@upstash/ratelimit` |
| Error monitoring | Sentry | `@sentry/nextjs` |

> **Why:** the only genuinely proprietary asset is `lib/insurance/` — the Singapore mortgage math (BSD/ABSD tiers, TDSR/MSR, IWAA), the workflow engine, and the data pipelines. Everything else is rented plumbing. That's also why the financial core has unit tests pinned to IRAS/MAS rules while most UI code has none: the tests guard the part that would be expensive to get wrong.

## Decision 3 — Security in three layers

1. **Middleware** (`middleware.ts`) — authentication only: "are you logged in at all?" Unauthenticated users bounce to the right login page.
2. **Route guards** — authorization: layouts check client-side, API routes check server-side (`requireAdminUser()`, `requirePropertyUser()`, `canAccessInsurance()`).
3. **Row Level Security (RLS)** — the database itself refuses to serve rows the requesting user shouldn't see, even if application code has a bug.

Full detail in [04 – Auth & Security](04-auth-security.md).

## Decision 4 — Three Supabase clients, one rule each

| Client | File | Use when |
|--------|------|----------|
| Browser singleton | `lib/supabase/client.ts` | `'use client'` components |
| Server client | `lib/supabase/server.ts` (`createServerSupabaseClient()`) | API routes, Server Components — carries the *user's* session, so RLS applies |
| Admin client | `lib/supabase/admin.ts` (`createAdminClient()`) | API routes that must bypass RLS (user creation, cross-agent admin views) — **always behind a route guard** |

> **Why three:** each client answers "who is the database talking to?" differently. The admin client is the service-role "god key" — it sees everything, so it only ever runs server-side inside a route that has already verified the caller is allowed. (`lib/supabaseClient.ts` is a backward-compat shim; new code imports the specific client.)

## Decision 5 — AI extracts, humans approve

Every AI feature that produces agent-facing content has a human gate:

- Rate-sheet ingestion: Gemini extracts → admin reviews an editable diff → confirm → atomic replace.
- Bank report summaries: DeepSeek summarizes automatically, but `is_published` defaults false until an admin reviews.
- Knowledge answers: strictly grounded — Gemini may only phrase answers from retrieved articles, and refuses when nothing matches.
- News: DeepSeek classifies relevance, but an admin can override any call with one click.

> **Why:** agents show these numbers to real clients. The system treats AI as a fast-but-fallible clerk whose work a human signs off, not an authority.

## How a request flows (worked example)

An insurance agent clicks "Send Report" on a case:

```
Browser (React component, 'use client')
  │  fetch POST /api/insurance/cases/<id>/send-report
  ▼
middleware.ts            — session exists? (else redirect to /insurance/login)
  ▼
app/api/insurance/cases/[id]/send-report/route.ts
  ├─ getServerUser()             — who is this? (401 if nobody)
  ├─ canAccessInsurance(...)     — right kind of user? (403 if not)
  ├─ createAdminClient()         — fetch the case row
  ├─ lib/insurance/refiCalc.ts   — pure math on workflow_data
  ├─ lib/insurance/refiPresentation.ts — build report HTML
  ├─ lib/email/generatePdf.ts    — HTML → PDF (headless Chromium)
  └─ lib/email/sendWorkflowReport.ts — email via Resend
  ▼
NextResponse.json({ ok: true })
```

The pattern generalizes: **UI components stay thin, API routes do auth + orchestration, `lib/` does the real work.** Pure calculation modules (no network, no database) are deliberately separate from the routes that call them — that's what makes them unit-testable.

## Background work (crons)

Five Vercel crons run daily (times in UTC, chosen so data is fresh by Singapore morning), all authenticated via `CRON_SECRET` (fail-closed in production — `lib/auth/requireCron.ts`):

| Cron | Time (UTC) | Does |
|------|-----------|------|
| `/api/property/reminders/process` | 01:00 | Sends property follow-up reminder emails |
| `/api/cron/sora` | 02:00 | Fetches daily SORA from MAS (published ~09:30 SGT) |
| `/api/cron/news` | 05:00 | Ingests + AI-classifies mortgage news from 7 sources |
| `/api/cron/economic-calendar` | 06:00 | Refreshes FOMC dates + CPI figures from Fed/FRED |
| `/api/cron/bank-intelligence` | 07:00 | Discovers + summarizes new bank research reports |

## Reading order from here

[02 – Directory Map](02-directory-map.md) shows where everything lives; [03 – Database](03-database.md) covers the data model these features sit on.
