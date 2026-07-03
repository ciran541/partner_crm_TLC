# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
npm run sync-schema  # Regenerate supabase/migrations/20260101000000_initial_schema.sql from live DB
npx supabase db push # Apply pending migration files to remote Supabase
```

No test suite exists. TypeScript checking: `npx tsc --noEmit` (one pre-existing Next.js internal error is expected and can be ignored).

## Architecture

### Two separate apps, one codebase

This is a multi-tenant platform serving two completely separate user groups:

| App | URL prefix | Users | DB table |
|-----|-----------|-------|----------|
| Property Agent | `/property/*` | Property agents + admins | `property_cases`, `property_case_documents`, etc. |
| Insurance CRM | `/insurance/*` | Insurance agents + admins | `cases` |

There is also a shared `/admin/*` area (user management, analytics) used by admins of both apps.

The `profiles` table is shared. The `app_type` column (`'insurance'` or `'property'`) and `role` column (`'agent'`, `'admin'`, `'super_admin'`) control what each user can access.

### Auth model

- **Login pages are per-app**: `/property/login`, `/insurance/login`
- **Middleware** (`middleware.ts`) protects `/property/*` and `/insurance/*` — bounces unauthenticated users to the correct login page. Login and forgot-password pages are excluded from the gate.
- **Authorization** (role + app_type checks) happens in layout components client-side and in API routes server-side. Middleware only handles authentication (session existence).
- **Password reset flow**: Admin sets a temp password via `/admin/users` → agent changes it from their Profile page. There is no self-service email reset for agents.

### Supabase client usage

Three clients — use the right one:

| File | Use when |
|------|----------|
| `lib/supabase/client.ts` (exports `supabase` singleton) | `'use client'` components |
| `lib/supabase/server.ts` (`createServerSupabaseClient()`) | API route handlers, Server Components |
| `lib/supabase/admin.ts` (`createAdminClient()`) | API routes that need to bypass RLS (user creation, admin overrides) |

`lib/supabaseClient.ts` is a backward-compat shim — existing imports work, but new code should import from the specific client files above.

### API route auth pattern

Every `/api/admin/*` route must guard with `requireAdminUser()`:
```ts
const auth = await requireAdminUser()
if (!auth.authorized) return auth.response
```

Property-agent routes use `requirePropertyUser()` from `lib/auth/requirePropertyUser.ts`.

### DB migrations

Schema changes must go through migration files in `supabase/migrations/`. Filename must match `<timestamp>_name.sql` (e.g. `20260530000000_add_column.sql`). Never use the Supabase SQL Editor directly for schema changes — those won't be tracked.

After writing a migration: `npx supabase db push`

After any SQL Editor change (emergency only): `npm run sync-schema` to update the reference schema file.

### Types

All domain types are in `lib/types/`:
- `shared.ts` — `Profile`, `UserRole`, `AppType`, user management inputs
- `insurance.ts` — `Case`, `CaseType`, `PipelineStage`, `AssistantData` (legacy)
- `workflow.ts` — Per-case-type workflow engine interfaces (`RefinancingWorkflow`, `PurchaseWorkflow`, etc.) and flag computation helpers
- `property.ts` — Property case, commission, document types

Import from `@/lib/types` (the barrel `index.ts`) for convenience.

### Permissions

Use `lib/permissions/index.ts` helpers — never write inline role string comparisons:
- `canAccessInsurance(role, appType)`
- `canAccessProperty(role, appType)`
- `isAdmin(role)`
- `getSafeRoute(role, appType)` — correct home route per user type

### Insurance CRM — Workflow Engine

The core feature of the insurance app. Cases store workflow answers in the `workflow_data` JSONB column (typed per case type in `lib/types/workflow.ts`). The old `sales_assistant_data` column is legacy and no longer written to.

- Workflow UI: `app/insurance/dashboard/cases/[id]/workflow/page.tsx`
- Refinancing steps component: `components/insurance/workflow/RefinancingWorkflow.tsx`
- Shared step primitives: `components/insurance/workflow/WorkflowStep.tsx`
- Auto-saves via 800ms debounce on every answer change

Closed Won and Closed Lost stage changes are intercepted by modals in the case detail page — they cannot be set without filling in required closure data.

### Mortgage Packages (rates)

In-app bank rate packages (`mortgage_packages` table), replacing the old external iframe (`mortgage-package.vercel.app`). Rates are stored **structured** — `rate_schedule` JSONB is an ordered array of per-year entries (`{year|thereafter, type:'fixed'|'floating', rate? , reference?, spread?}`) — so they are filterable/sortable now and computable by the workflow engine later (Step 4 auto-recommendation, phase 2).

- Page: `app/insurance/dashboard/rates/page.tsx` (shared by both apps; the Property `/dashboard/rates` route redirects here). Agents browse + filter published packages; admins also get create / edit / **duplicate** / delete and see drafts.
- Editor: `components/insurance/rates/RatePackageEditorModal.tsx` — year-by-year rate builder (fixed % or floating reference + spread).
- Helpers: `lib/insurance/rateSchedule.ts` — `parseLegacyRates` (free-text → structured), `formatRateSchedule` (structured → display lines), `deriveFirstYearRate` (sort key). Types in `lib/types/rates.ts`.
- APIs: `GET /api/insurance/rates` (insurance **or** property auth; agents see published only), `POST/PATCH/DELETE /api/admin/rates` (`requireAdminUser()`; POST `{duplicateId}` clones as a draft).
- `first_year_rate` is a rough sort key derived on save (fixed→rate, floating→spread).
- **Ingestion ("Import from sheet")**: admins paste a bank's block from their Google Sheet → Gemini extracts structured packages (`lib/insurance/extractPackages.ts`, JSON-mode, temp 0, transcribe-only) → **human review** screen (`RateIngestionModal.tsx`, editable rows + per-category diff) → confirm → **atomic replace by bank+category** via the `replace_bank_packages()` SQL function (`POST /api/admin/rates/extract` then `/replace`). The admin picks the bank (the LLM never decides the delete target); replace scope = the categories present in the reviewed rows. `min_loan_note` holds Premier/threshold wording.

### Decision Support — live SORA + Step 4 auto-recommendation

Phase 2 of rates: structured packages become *computable*.

- **Daily SORA** from the MAS "Domestic Interest Rates – Daily" API (`lib/insurance/sora.ts`, `sora_rates` table). Auth = `keyid` header (`MAS_API_KEY`). The gateway ignores field/date filters and returns the full history, so we fetch all and take the latest non-null compounded row. A daily Vercel cron (`/api/cron/sora`, `vercel.json`) upserts it; admins can also "Refresh SORA" from the Rates page (`POST /api/admin/rates/sora`). Reads are instant via `getCurrentSora()`, and it travels with `GET /api/insurance/rates` so Step 4 gets packages + SORA in one call.
- **Rate computation** (`lib/insurance/rateRecommend.ts`): `effectiveRate(entry, sora)` (fixed→rate; floating→SORA+spread; `1M/3M`→**lower** of 1M/3M; FD-pegged→not computed), `projectPackage()` re-amortises per-year installments, `recommendPackages()` filters by loan/tenure/property/preference, computes net savings (`computeRefiSavings` in `loanCalc.ts`) + TDSR eligibility, and ranks best-first.
- **Step 4 UI**: `Step4Recommendations.tsx` shows the ranked list; selecting one fills the proposal and stores a **frozen `selected_package_snapshot`** in `workflow_data` (so an admin editing the package later can't silently change a client's proposal). Dual-benchmark / FD packages degrade gracefully (shown, not auto-priced).

### Emails

Resend is used for transactional email (`lib/email/sendFollowUpReminder.ts`). Configured via `RESEND_API_KEY` and `RESEND_FROM_EMAIL` env vars. Currently only the property app sends emails.

### Google Calendar / Google Drive

OAuth flow + calendar sync lives in `lib/google/`. Property agents connect their Google account from `/property/profile`. Follow-up dates sync to Google Calendar via `lib/google/syncFollowUp.ts`. Insurance app does not yet use calendar integration.

### Styling

Tailwind CSS v4 with a global stylesheet at `app/globals.css`. Reusable CSS classes (`.card`, `.btn-primary`, `.sidebar-link`, `.sidebar-container`, etc.) are defined there. Components in `components/shared/` cover common UI patterns (Spinner, Modal, InlineAlert, Skeleton, EmptyState, etc.).

## Environment variables required

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
RESEND_FROM_EMAIL
NEXT_PUBLIC_APP_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GEMINI_API_KEY          # Google AI Studio (free tier) — knowledge assistant answer synthesis, rate ingestion
DEEPSEEK_API_KEY        # platform.deepseek.com — mortgage news relevance classification + summaries
MAS_API_KEY             # MAS Data API (keyid header) — daily SORA fetch for Step 4 rate computation
FRED_API_KEY            # St. Louis Fed — US Fed funds rate chart
CRON_SECRET             # optional — Vercel cron auth (Bearer) for /api/cron/* routes
```

### Insurance CRM — Knowledge Engine (Layer 4)

Admin-managed knowledge repository (`knowledge_articles` table) surfaced to agents only via search/contextual APIs (never an unfiltered list — RLS on, all access through service-role server routes).

- **Semantic search**: `embedText()` (`lib/insurance/embed.ts`) calls the Supabase `embed` Edge Function (`supabase/functions/embed`, free `gte-small`, 384-dim) → `match_knowledge_articles` RPC (pgvector cosine). Falls back to Postgres full-text then ILIKE.
- **Grounded RAG answers**: `/api/insurance/knowledge/ask` retrieves articles then `composeAnswer()` (`lib/insurance/askGemini.ts`) has Gemini phrase an answer ONLY from them. Strictly grounded — refuses when nothing relevant matches; degrades to article cards if `GEMINI_API_KEY` absent. Agent UI: `components/insurance/knowledge/KnowledgeAsk.tsx`.
- Auto-embed on create/update; `/api/admin/knowledge/reindex` backfills.
- **Deploy note**: `supabase functions deploy embed` is a separate step from `db push`.

### Insurance CRM — Resources: Mortgage News (Layer 6)

Auto-curated news feed (`mortgage_news_articles` table) from Business Times and CNA, filtered to mortgage/property-finance relevance, with one-click cached AI summaries. Part of the Resources area alongside Rate Comparison and Domestic Rates — first of three planned additions (Economic Calendar and CME FedWatch remain design-only, not built).

- **Sourcing**: each source's genuine, official **native RSS feed** (`lib/types/news.ts`'s `NEWS_SOURCES`) — confirmed by fetching the raw XML directly (real article URLs, real content snippets, no ToS ambiguity). An earlier design used a site-scoped Google News RSS trick for a 7-source list (Business Times, EdgeProp, Bloomberg, MAS, URA, CNA, MND); that was replaced after finding it had no real content snippets, non-resolving redirect URLs, and a ToS restriction to "personal, non-commercial use." Only Business Times and CNA had a working native feed with real news content — EdgeProp's only feed was property listings not news, MAS/URA/MND block automated requests, and Bloomberg has no free feed — so scope was narrowed to these two rather than falling back to a lower-quality mechanism for the rest.
- Business Times' feed carries genuine `<category>` tags — `BT_RELEVANT_CATEGORIES` in `news.ts` pre-filters to plausibly-relevant categories (Property, Banking & Finance, etc.) before anything reaches the classifier, for free and with no API cost. CNA's feed carries a genuine `<media:thumbnail>` (real photo) on every item, captured via `rss-parser`'s `customFields`; CNA has no comparable category field, so it relies on classification alone.
- **AI provider: DeepSeek, not Gemini** (`callDeepSeek()` in `news.ts`) — deliberately different from every other AI feature in this codebase (Knowledge Engine, rate ingestion both still use Gemini). Switched after finding Gemini's free tier caps at **20 requests/day per model** (confirmed against a real key's error response — far tighter than general documentation suggests), and DeepSeek is cheaper per token besides. OpenAI-compatible chat completions API (`deepseek-v4-flash` primary, `deepseek-v4-pro` fallback), `response_format: {type:'json_object'}` for the classification step. Also fixed in passing: Gemini's 2.5-flash/flash-lite are "thinking" models whose invisible reasoning tokens can silently truncate a response mid-sentence unless `thinkingConfig: {thinkingBudget:0}` is set — this was missing in `askGemini.ts` (Knowledge Engine still uses Gemini) and has been added there too.
- **Ingestion** (`ingestAll()`, daily cron `/api/cron/news`): fetch both sources → **date-filter to the last 7 days** → dedupe by URL → classifies new items for relevance (JSON mode, refuses-safe — never assumes relevant on failure) → stored. Respects a wall-clock time budget separate from the item cap, since a fully rate-limited key still burns through the full retry cascade per item.
- **Summaries**: on-demand only (`getOrCreateSummary()`, `POST /api/insurance/resources/news/[id]/summarize`), generated from the RSS title+snippet only — never scrapes article HTML (avoids paywall/ToS issues) — and cached in the `summary` column so repeat clicks don't re-generate.
- Admin console (`/admin/insurance/news`, `components/insurance/news/NewsAdminView.tsx`) is QA-only (hide/unhide, delete, manual one-off add, "Refresh now") — the pipeline needs zero manual data entry to function day-to-day.
