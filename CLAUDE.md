# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
npm test             # Vitest — unit tests for the financial calc core (lib/insurance/__tests__)
npm run sync-schema  # Regenerate supabase/schema/full_current_schema.sql from live DB (tables + RLS policies)
npx supabase db push # Apply pending migration files to remote Supabase
```

TypeScript checking: `npx tsc --noEmit`. Tests cover the pure financial engines (BSD/ABSD tiers, IWAA, annuity math, Step 4 effective rates) — run them after touching `lib/insurance/*Calc.ts`, `stampDuty.ts`, `loanCalc.ts` or `rateRecommend.ts`.

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

After any SQL Editor change (emergency only): `npm run sync-schema` to update the reference schema file (it dumps tables, FKs **and RLS policies**, so policy drift is visible in the repo).

**RLS notes** (see `20260705000000_rls_hardening.sql`): admin checks in policies use the `is_admin_user()` SECURITY DEFINER function (never subquery `profiles` directly inside a `profiles` policy — infinite recursion). The client's UPDATE grant on `profiles` is **column-restricted** to identity fields (`name`, `full_name`, `mobile`, `cea_registration_no`, `agency_name`) — `role` / `app_type` / `status` / Google-token / session columns are writable only via service-role API routes; do not widen that grant. Insurance content tables (knowledge, rates, news, calendar, SORA) have RLS on with **no client policies** by design — all access goes through guarded server routes.

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
- **Step 4 UI**: `RefiPackages.tsx` / `PurchasePackages.tsx` show the ranked list; selecting one fills the proposal and stores a **frozen `selected_package_snapshot`** in `workflow_data` (so an admin editing the package later can't silently change a client's proposal). Dual-benchmark / FD packages degrade gracefully (shown, not auto-priced). Both (and the Rates page) show an amber warning when the stored SORA is stale (`isSoraStale()` in `rateSchedule.ts`, > 5 days old).

### Insurance CRM — Bank Promotions

Time-boxed bank campaigns (`bank_promotions` table) — the promo blasts banks send partners over WhatsApp/email ("SCB National Day cash rebate, submit 3–16 Aug, $800 for $1m–$1.5m loans, $1,200 above that"). Stored **structured** (`benefit_tiers` JSONB) rather than as text, so a tier resolves against a case's actual loan at Step 4 — same reasoning as `rate_schedule`.

- **The load-bearing column is `audience`** (`client` | `agent` | `both`). One bank message routinely carries two different things: a cash rebate the CLIENT receives and a referral-fee bump only the AGENT gets. The SCB blast this was built from has both, with *different end dates* (rebate 16 Aug, referral 31 Aug). They become separate rows, and an agent incentive appearing in a client-facing document is a commercial problem, not a cosmetic one — so `visibleTo()` gates it, the agent-only badge is drawn violet-with-people-icon rather than amber-with-gift (these screens get turned toward a client mid-conversation), and the extractor **defaults an unrecognised audience to `agent`, not `client`** — an incentive hidden internally is a harmless miss, the reverse is not.
- **Matching engine** (`lib/insurance/promotions.ts`, pure/testable): `resolveTier()` walks tiers **in order, first match wins** — that is what settles the boundary bank wording leaves ambiguous ("1m to 1.5m" and "above 1.5m" both claim exactly $1.5m; it resolves to the lower tier, pinned by test). `matchPromotions()` **drops** a promotion whose tiers exclude this loan rather than greying it out — badging a card with a rebate the client can't claim risks a misquote. `promoSnapshot()` freezes what applied at selection time into `workflow_data.promo_snapshot` alongside `selected_package_snapshot`, for the same reason: a promotion is perishable by design, so re-deriving it on reopen would let an expired one silently change a quoted figure.
- **`todaySgt()`** exists because `new Date().toISOString()` is UTC, which reports *yesterday* between midnight and 8am SGT. On Vercel (UTC) that would keep an expired promo live all morning, and it would never reproduce on a local SGT machine. Singapore has no DST so a fixed +8 is exact.
- **Ingestion**: admin pastes the bank's message → `extractPromotion.ts` (DeepSeek, JSON mode, temp 0, transcribe-only) returns an **array** (it is explicitly told to split by audience) → human review (`PromotionIngestionModal.tsx`, each row's audience shown prominently and editable) → save. No Gemini fallback here, unlike `extractPackages.ts`: `deepseek.ts` now reserves Gemini for reading pixels only. Verified live against the real SCB blast (`promotionExtract.dbtest.ts`, `npm run test:db`) — it splits both halves and reads tiers/window/clawback/LTV correctly.
- **Delivery**: promotions ride along with `GET /api/insurance/rates` (like `sora`) so Step 4 and the Rates page get everything in one call; the dashboard uses the slim `GET /api/insurance/promotions` instead, since it has no other reason to download the whole package table. Both read `promotionsCache.ts` (60s, mirrors `ratesCache.ts`). The rates route's promotions load is **fail-soft** — promotions are an enhancement, packages are the product, so a promotions outage must never take Step 4 down. Expired rows are filtered server-side, so a finished promo disappears from agents' screens with no admin action; "extending to 31 Aug" is just editing `ends_on`.
- **Agent surfaces**: dashboard banner (`DashboardPromoBanner`), Rates page strip + per-card badges (badges resolve to an exact figure once a loan size is typed, a range otherwise), and Step 4 package cards in `RefiPackages`/`PurchasePackages`. `RefiPackages` is shared by Refinancing, Equity Loan and Decoupling, so it takes a `caseType` prop to filter promotions correctly.
- **Deliberately NOT done** (both reversible, revisit after live use): the rebate is **not** folded into `recommendPackages()` ranking — a perishable promo shouldn't move a package to #1 when it may expire before submission; and `affects_ltv` ("rebate nett off purchase price for LTV computation") is **surfaced as a warning, not auto-applied** — silently changing regulated max-loan math off a pasted WhatsApp message is the wrong risk. The client-facing proposal line is also not built yet; the `audience` gate is in place so adding it is a render change.
- Admin console: `/admin/insurance/promotions`. Unlike news or bank insights there is **no discovery cron** — promotions arrive as a message to a person, so this screen is the data-entry path.

### Shared financial core

The regulated, client-facing numbers each live in exactly ONE module — never re-implement them locally:

- `lib/insurance/stampDuty.ts` — BSD tiers (`BSD_TIERS`, `calculateBSD`, `computeBsdBreakdown`) and ABSD (`absdRate`, `worstResidency`, `Residency`). The purchase/decoupling engines and the stamp-duty calculator all derive from it.
- `lib/insurance/loanCalc.ts` — annuity/TDSR/MSR math, **`incomeWeightedAge()`** (the one IWAA implementation; per-engine wrappers in `refiCalc`/`purchaseCalc`/`decoupleCalc` state their rounding + zero-income semantics via options), and cross-engine constants (`CANCELLATION_FEE_RATE`, `MIN_TENURE`, `DEFAULT_REFERENCE_RATE`).

`lib/insurance/__tests__/financialCore.test.ts` pins tier boundaries and wrapper semantics — update the tests together with any IRAS/MAS rate change.

### Emails

Resend is used for transactional email (`lib/email/sendFollowUpReminder.ts`). Configured via `RESEND_API_KEY` and `RESEND_FROM_EMAIL` env vars. Currently only the property app sends emails.

### Google Calendar / Google Drive

OAuth flow + calendar sync lives in `lib/google/`. Property agents connect their Google account from `/property/profile`. Follow-up dates sync to Google Calendar via `lib/google/syncFollowUp.ts`. Insurance app does not yet use calendar integration.

**Drive document backup** (`lib/google/driveSync.ts` + `driveSyncRun.ts`, daily cron `/api/cron/drive-sync`): mirrors both apps' Storage document buckets (`property-documents`, `insurance-documents`) into a shared Drive folder for ops to browse without touching Supabase/S3 tooling — `GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID`, split into `Property CRM` / `Insurance CRM` subfolders, then one subfolder per case (`<client name> - <case id prefix>`). Reuses the same service account as the TLC calendar sync (needs the Drive API enabled on it, and the root folder shared with its email as Editor) — full `drive` scope, not `drive.file`, since the root folder is owned by a human and merely shared with the service account. `drive_sync_log` tracks which `(bucket, storage_path)` pairs are already synced so re-runs only upload what's new; a run that hits its time budget mid-backlog just picks up the rest tomorrow (same pattern as `news.ts`'s `ingestAll()`). This is a convenience mirror for ops, not the backup of record — the daily R2 workflow (`.github/workflows/db-backup.yml`) remains the actual disaster-recovery path until Supabase Pro's own backups replace it.

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
FRED_API_KEY             # St. Louis Fed — US Fed funds rate chart
CRON_SECRET              # Vercel cron auth (Bearer) for /api/cron/* — REQUIRED in production (fail-closed via lib/auth/requireCron.ts); optional locally
GOOGLE_SERVICE_ACCOUNT_EMAIL         # Shared with TLC calendar sync — also used for the Drive document backup
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   # Shared with TLC calendar sync — also used for the Drive document backup
GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID   # Drive folder shared (Editor) with the service account — /api/cron/drive-sync mirrors both apps' documents under it
```

### Insurance CRM — Knowledge Engine (Layer 4)

Admin-managed knowledge repository (`knowledge_articles` table) surfaced to agents only via search/contextual APIs (never an unfiltered list — RLS on, all access through service-role server routes).

- **Retrieval cascade**: `retrieveArticles()` (`lib/insurance/retrieveKnowledge.ts`) is the ONE implementation of semantic → full-text → substring retrieval, shared by the `/search` and `/ask` routes (each passes its own threshold/count). Semantic tier: `embedText()` (`lib/insurance/embed.ts`) calls the Supabase `embed` Edge Function (`supabase/functions/embed`, free `gte-small`, 384-dim) → `match_knowledge_articles` RPC (pgvector cosine, HNSW-indexed).
- **Grounded RAG answers**: `/api/insurance/knowledge/ask` retrieves articles then `composeAnswer()` (`lib/insurance/askGemini.ts`) has Gemini phrase an answer ONLY from them. Strictly grounded — refuses when nothing relevant matches; degrades to article cards if `GEMINI_API_KEY` absent. Agent UI: `components/insurance/knowledge/KnowledgeAsk.tsx`. Gemini model names live ONLY in `askGemini.ts`'s `modelChain()` (shared by `normalizeQuery.ts`) — a model name hardcoded elsewhere once kept calling a retired model for a month, silently degrading retrieval.
- Auto-embed on create/update; `/api/admin/knowledge/reindex` backfills.
- **Deploy note**: `supabase functions deploy embed` is a separate step from `db push`.

### Insurance CRM — Resources: Mortgage News (Layer 6)

Auto-curated news feed (`mortgage_news_articles` table) from Business Times, CNA, Financial Times, The Edge Singapore, MAS, URA, and HDB, filtered to mortgage/property-finance relevance, with one-click cached AI summaries. Part of the Resources area alongside Rate Comparison and Domestic Rates. CME FedWatch remains design-only, not built.

- **Sourcing**: each source's genuine, official feed (`lib/types/news.ts`'s `NEWS_SOURCES`) — confirmed working by fetching it directly. An earlier design used a site-scoped Google News RSS trick for a 7-source list (Business Times, EdgeProp, Bloomberg, MAS, URA, CNA, MND); that was replaced after finding it had no real content snippets, non-resolving redirect URLs, and a ToS restriction to "personal, non-commercial use." A later attempt to add more sources (SRX, 99.co, EdgeProp news, ABS, URA, HDB, Reuters, FT, WSJ, MND, CPF Board, Straits Times, IRAS, The Edge Singapore) found: EdgeProp's feed is property listings not news; Bloomberg/Reuters have no free feed; WSJ's and Straits Times' feeds are both broken/dead (WSJ frozen over a year stale; ST's channel date is stale and item content is garbage template text, not real articles, despite sharing BT's SPH infra); SRX/99.co return 403 even with a full realistic browser header set (TLS/bot-detection, not a header check, so not fixable the way MAS/HDB were); CPF Board has no dated news feed, only an evergreen "Infohub" content hub; MND has a real press-releases page but was only ~5 weeks fresh at last check and mostly duplicates URA/HDB (both are statutory boards under MND). ABS and IRAS both have real, working, parseable archives but were deliberately left out: ABS — PDF-only links, dates require tracking which year-accordion panel an entry sits in, content skews toward payments/fraud rather than mortgage/rates; IRAS — technically the cleanest of any source (plain server-rendered `<article>` markup, no WAF, built-in category field to skip "Tax Crime" for free) but real relevance density is low, ~1 mortgage-relevant item per 20 articles checked (rest is tax-crime prosecutions and general tax-admin notices). The Edge Singapore (`theedgesingapore.com/rss.xml`) is a standard RSS feed like FT — no WAF, description arrives as embedded HTML (an image div + body text) rather than plain text, but `rss-parser`'s `contentSnippet` cleanly strips it — confirmed via a live ingestion run, not assumed.
- **Legal posture, checked directly rather than assumed**: SPH Media's actual Terms & Conditions (`sph.com.sg/legal/website_tnc`) define "the Site" to explicitly include RSS feeds, and restrict reproduction/scraping "for any commercial... purposes" without prior written permission — so Business Times' feed is *not* pre-cleared for commercial reuse by the letter of its terms, despite being the intended public syndication mechanism. Same pattern for MAS/URA/HDB's general Terms of Use (reproduction requires permission; the "personal, non-commercial use" carve-out doesn't cover a commercial CRM feature) — being a public institution does **not** mean public-domain in Singapore (no blanket government-copyright-exemption law here, unlike e.g. US federal works). MAS separately has a genuine Open Data Licence for "datasets" (commercial use + sub-licensing explicitly allowed, just needs attribution) that likely covers the SORA feed elsewhere in this app, but whether MAS's news/press-release content counts as a "dataset" under that licence vs. their stricter general terms is unresolved. Deliberate mitigation already in place for all sources: title + short snippet only (never full article text), always linking back to the original (no paywall bypass, no substitution for the source), which is standard low-risk aggregator practice — but that's a practical-risk argument, not a claim that this is literally authorized by each publisher's written terms.
- **MAS, URA and HDB are not RSS at all** — each was found by digging into the real page behind the obvious `/rss` guess, not by assuming a government site would have nothing:
  - **MAS**: blocks every guessed `/rss` path (serves a decoy "Maintenance" page), and its real `/news` page renders the article listing client-side via JavaScript, so the raw HTML has nothing to scrape. Found by opening `mas.gov.sg/news` in a real browser, watching the Network tab, and spotting the XHR request behind the page's search box: `mas.gov.sg/api/v1/search?json.nl=map&indent=on&q=*:*&fq=mas_mastercontenttypes_sm:"News"&sort=mas_date_tdt desc` — a Sitecore/Solr-backed site-search JSON API, confirmed public with a bare `curl` (no cookies/session/auth).
  - **URA**: `news/media/` embeds its full recent press-release list (300+ items per fetch) directly in the page's server-rendered HTML as Next.js React Server Component state — not a separate call at all. No WAF/User-Agent issue. Parsed with a plain regex against the escaped JSON string in the page's `<script>` tag (`fetchUraFeed()` in `news.ts`) rather than a proper parser, since there's no clean boundary to hand to `JSON.parse` — fragile to a URA frontend redesign, same trade-off already accepted for MAS.
  - **HDB**: same embedded-framework-state trick as URA, but a different (Sitecore Layout Service) shape — `{"url":{"path":...},"fields":[{"name":"publishedDate","value":...},...]}` — and needs the same bare `User-Agent` workaround as MAS (a header-less fetch gets a 403). `fetchHdbFeed()` bounds each item's field-search window to the next item's start so a sparse entry can't accidentally pick up a neighbour's fields. Content here is unusually high-value — CPF interest rate announcements and quarterly HDB Resale Price Index releases turn up directly.
  - All three gotchas (MAS/HDB's User-Agent block, the embedded-JSON-not-a-real-API shape) were found by testing live — a first attempt at MAS with a bare Node `fetch()` failed silently in production before the WAF cause was isolated.
- Business Times' feed carries genuine `<category>` tags — `BT_RELEVANT_CATEGORIES` in `news.ts` pre-filters to plausibly-relevant categories (Property, Banking & Finance, etc.) before anything reaches the classifier, for free and with no API cost. CNA's feed carries a genuine `<media:thumbnail>` (real photo) on every item, captured via `rss-parser`'s `customFields`. None of CNA/MAS/URA/HDB has a comparably reliable category to pre-filter on (MAS's content types mix clearly-relevant with ambiguous — e.g. "Parliamentary Replies" spans everything from property cooling measures to unrelated topics), so all four rely on DeepSeek classification alone — confirmed via live ingestion runs that it correctly separates true hits (URA/HDB's quarterly property/resale price index releases) from same-source noise (road closures, tender-award personnel notices, unrelated agency announcements).
- **Admin relevance override** (`setRelevant()` in `news.ts`, wired through `PATCH /api/admin/insurance/news` and a ✓/✗ button in `NewsAdminView.tsx`): fixes a wrong or missed DeepSeek relevance call in one click, without deleting and manually retyping the article via "Add Article."
- **AI provider: DeepSeek, not Gemini** (`callDeepSeek()` in `news.ts`) — deliberately different from every other AI feature in this codebase (Knowledge Engine, rate ingestion both still use Gemini). Switched after finding Gemini's free tier caps at **20 requests/day per model** (confirmed against a real key's error response — far tighter than general documentation suggests), and DeepSeek is cheaper per token besides. OpenAI-compatible chat completions API (`deepseek-v4-flash` primary, `deepseek-v4-pro` fallback), `response_format: {type:'json_object'}` for the classification step. Also fixed in passing: Gemini's 2.5-flash/flash-lite are "thinking" models whose invisible reasoning tokens can silently truncate a response mid-sentence unless `thinkingConfig: {thinkingBudget:0}` is set — this was missing in `askGemini.ts` (Knowledge Engine still uses Gemini) and has been added there too.
- **Ingestion** (`ingestAll()`, daily cron `/api/cron/news`): fetch all sources → **date-filter to the last 7 days** → dedupe by URL → classifies new items for relevance (JSON mode, refuses-safe — never assumes relevant on failure) → stored. Respects a wall-clock time budget separate from the item cap, since a fully rate-limited key still burns through the full retry cascade per item.
- **Summaries**: on-demand only (`getOrCreateSummary()`, `POST /api/insurance/resources/news/[id]/summarize`), generated from the title+snippet already captured at ingestion only — never scrapes the article page itself (avoids paywall/ToS issues) — and cached in the `summary` column so repeat clicks don't re-generate. Snippet richness varies by source: HDB and MAS often carry a real descriptive sentence, URA carries none (title only).
- Admin console (`/admin/insurance/news`, `components/insurance/news/NewsAdminView.tsx`) is QA-only (hide/unhide, delete, manual one-off add, relevance override, "Refresh now") — the pipeline needs zero manual data entry to function day-to-day.

### Insurance CRM — Resources: Economic Calendar (Layer 7)

FOMC meetings, US CPI releases, and MAS Monetary Policy Statements (`economic_calendar_events` table), with impact-star ratings and countdown badges. Three event types, three different sourcing paths feed one shared table (`lib/insurance/economicCalendar.ts`) — each verified by direct testing during planning, not assumed:

- **`fomc_meeting`**: scraped from the Fed's own official calendar page (`federalreserve.gov/monetarypolicy/fomccalendars.htm`) — confirmed reachable, unlike most other `.gov` sources tried (BLS blocks automated requests entirely; MAS's own calendar/schedule pages have no accessible API, see below).
- **`us_cpi`**: release **dates** come from BLS's own iCalendar feed, but BLS blocks automated fetches of it too (confirmed: 403 even with a browser User-Agent, on both the HTML schedule and the raw `.ics` URL) — so an admin downloads `bls.gov/schedule/news_release/bls.ics` manually and pastes the contents into the admin console (`IcsImportModal.tsx` → `POST /api/admin/insurance/calendar/import-cpi-ics` → `parseIcsCpiDates()`). BLS publishes ~18 months ahead, so this is a rare (roughly annual), not routine, admin action. Actual/previous/forecast **values** come from FRED automatically — `CPIAUCSL` with `units=pc1` for the YoY % actual/previous, and `EXPINF1YR` (1-year inflation expectation) as a free, honestly-labeled forecast proxy, shown as that rather than a literal analyst "consensus" figure (which isn't available without a paid calendar API).
- **`mas_mps`**: no accessible schedule or API exists for the *release date* itself — checked MAS's own 108-product API catalog directly (keyword search: "monetary policy", "policy statement", "exchange rate" — no match) and their Advance Release Calendar page (no API, HTML only). MAS's `/news` search API (see Layer 6 above) only covers already-published news, not future scheduled events, so it doesn't help here either. Admin-entered manually, quarterly (MAS releases this Jan/Apr/Jul/Oct, not semi-annual as first assumed), whenever their Advance Release Calendar (`mas.gov.sg/monetary-policy/advance-release-calendar`) shows the next "NLT" (Not Later Than) date.
- **Cron** (`refreshAll()`, daily `/api/cron/economic-calendar`): refreshes FOMC dates + CPI actual/previous/forecast only — never touches CPI release dates, which only change via the explicit ICS import. Admin-owned columns (`impact_stars`, `hidden`, `admin_notes`) are excluded from the upsert payload so an admin edit is never overwritten by the next automated run, same pattern as `sora.ts`/`news.ts`.
- Admin console (`/admin/insurance/calendar`, `components/insurance/calendar/CalendarAdminView.tsx`): "Refresh now" (FOMC+FRED), "Import CPI Dates" (ICS paste), "Add Event" (mainly MAS MPS), hide/edit/delete.

### Insurance CRM — Banks' Insights (top-level tab, not under Resources)

Bank "house view" research (OCBC's Research Monitor, UOB's Monthly Investment Insights, HSBC's Monthly View, Maybank's CIO Monthly Outlook — all genuinely monthly — plus SC's Global Market Outlook, semi-annual, and DBS's CIO Insights, quarterly, see below), auto-discovered and comprehensively summarized by AI, grouped by month at `/insurance/dashboard/bank-intelligence`. A separate feature area from Resources, per an explicit product decision — banks' own research is a different kind of content from the news/calendar/rates data there.

- **Discovery** (`lib/insurance/bankIntelligence.ts`'s `fetchOcbcReports`/`fetchUobReports`/`fetchHsbcReports`/`fetchMaybankReports`/`fetchScReports`/`fetchDbsReports`): `BANK_SOURCES` in `lib/types/bankIntelligence.ts`. OCBC, UOB, Maybank, SC and DBS publish PDFs, found by fetching each bank's real research listing page (not a hidden API) directly and parsing with a plain regex. OCBC's `research-with-filter.page?category=macro` embeds every report type (Daily Treasury Outlook, Weekly Macro View, Regional Focus, and the monthly "Research Monitor") in one flat HTML structure with no WAF; filtered to the "Monthly Monitor" category. UOB's `wealth-insights/index.page` lists "Monthly Investment Insights" PDFs with the month/year available directly in a `button_name` attribute — its server intermittently 500s when a request sends only a `User-Agent` header (confirmed live: adding `Accept`/`Accept-Language` made it consistently 200), so every fetch in this file sends a full realistic header set defensively. Maybank's listing page carries its **entire archive back to mid-2024** in one load, each card's thumbnail image filename encoding the month/year (`images/fx/jul2026.jpg`) next to its real `<h3>` title — the listing's own "Discover" links point to a broken intermediate `.page` URL (confirmed live: HTTP 500), so those are ignored in favour of the matching, confirmed-working PDF path (`pdf/fx/jul2026.pdf`, same `<month><year>` token, no separate existence check needed). First run backfilled all 28 months at once since none existed yet — expected, one-time behaviour for a source with a long-lived listing, not a bug.
- **Maybank's own domain (`maybank2u.com.sg`) blocks curl entirely but not Node's `fetch()`** — worth remembering for testing future sources: a live `curl` against both the listing and the PDF hung indefinitely (TLS handshake completed, request sent, then zero bytes ever received — a deliberate tarpit, not a clean 403, consistent with Akamai Bot Manager fingerprinting curl's TLS signature specifically via Windows' schannel backend). The exact same URL via Node's `fetch()` (undici) returned a normal 200 immediately. Production code already uses Node's `fetch()`, so this never affected the actual feature — but it means a `curl` test failing on a new source is no longer sufficient evidence of "blocked for us"; worth a quick Node `fetch()` check before concluding a source is dead.
- **SC's "Global Market Outlook" turned out to be semi-annual, not monthly** — the listing page (`wealth-insights/`) only ever shows 3 "featured" cards mixing several cadences (Weekly Market View, Global Market Outlook, CIO Equity newsletter — Market Watch and Thematic Report PDFs also exist on the page but outside any scrapable card), no archive and no pagination found. `fetchScReports()` filters to the "Global Market Outlook" category card only. Its PDF filename embeds a unique per-publication subtitle slug (`navigating-shifting-sands`) that isn't derivable from the date, so — unlike Maybank/HSBC — there's no predictable-URL shortcut; discovery can only ever find whatever the listing currently shows, not backfill history. True cadence was unconfirmed at build time (only one card visible) — resolved after the first real extraction: the summary revealed the PDF's own internal title is **"Outlook H2 2026,"** confirming this is a half-yearly flagship report, not monthly like the other four banks. Grouping by `report_period` still works fine regardless of cadence; the mechanism doesn't assume monthly.
- **DBS's PDF is two fetches deep and served through a wrapper API, not a static file** (`fetchDbsReports()`) — the listing page (`cio-asset-allocation.page`) links to several sibling pieces per quarter under "Quarterly House Views" (the flagship `CIOInsightsNQYY.xml`, plus suffixed companions `_Thematics`/`_Alternatives`/`_AA`/`_Video` that are filtered out); that link is itself a further article page, not a PDF, whose own embedded JSON carries the real PDF path (`ArticlePdfPath`) and metadata (`Title`, `PublishedDate`). The actual file is then served via `wrapperapi/generic/download-pdf?pdf_path=<that path>`, a proxy endpoint, not a direct URL. **A real access-control false alarm, caught and corrected before shipping**: the article's own embedded data marks its PDF `shareOptions` entry `"access":false`, and every URL guessed from that path alone (without the real wrapper-API endpoint) redirected to a generic app-shell fallback page — read together, that looked exactly like a private-banking-login wall, matching the earlier (now-superseded) "DBS not found, likely behind their wealth/Treasures login" conclusion from initial reconnaissance. It wasn't one: the user found the real download request via their own browser's DevTools Network tab (same method that found MAS's search API and DBS's own wrapper endpoint) and a clean request with zero cookies/auth to that exact URL returned the full PDF — confirming `"access":false` governs some other UI feature, not this download path. Report period is derived from the quarter in the article slug (e.g. `3Q26` → July, the quarter's first month), not the earlier publish date.
- **HSBC publishes no PDF at all** — each "Monthly View" is a plain article page, and its "House Views" listing is entirely client-side rendered (confirmed live: zero PDF links, zero "pdf" mentions anywhere, no embedded article data in the raw HTML — same class of problem MAS's `/news` page had before its real API was found). But the article itself sits at a **predictable URL** (`.../House-views/monthly-view-<month>-<year>/`, confirmed working for 3 consecutive months live) and that page IS server-rendered, so `fetchHsbcReports()` skips the listing entirely and just constructs the expected URL for the current and previous month, keeping whichever resolve. Simpler and less fragile than scraping a listing. Since there's no PDF, `extractSummary()` skips `pdf-parse` for this source and extracts text by stripping the `article-content` container's HTML tags directly (`extractHsbcArticleText()`); the "Original PDF" link label becomes "Original Article" automatically via `isPdfUrl()` (checks whether the stored link ends in `.pdf`) rather than needing a new DB column — the `pdf_url` column name stayed as-is since it's still just "the link to the source," now sometimes a PDF and sometimes not.
- **AI provider: DeepSeek (paid plan) primary, Gemini fallback** — deliberately different from the PDF-native design this feature started with. DeepSeek's hosted API (`deepseek-v4-flash`/`-pro`, same models `news.ts` uses) was checked directly against its own API docs and confirmed **text-only** — no PDF/image/document input at all. So PDF sources go through `pdf-parse` first to get plain text (`callDeepSeekWithText()` in `bankIntelligence.ts`), and HSBC's already-clean article HTML needs no such step; either way, only if the whole DeepSeek path fails (no key, network/API error, empty response — never on suspected quality) does it fall back to Gemini — `callGeminiWithPdf()` (reads a PDF's actual visual layout) for OCBC/UOB, `callGeminiWithText()` for HSBC, both thin wrappers around a shared `callGemini(parts)`. This has a real, confirmed accuracy trade-off for the PDF sources: OCBC's report is a dense data table and its extracted text preserved row order perfectly (`SORA 1.25 1.40 1.40 1.45 1.50` — exact match to the PDF); UOB's report is chart/graphic-heavy and its extracted text interleaves chart axis-labels into meaningless number fragments near where a chart appeared, though the narrative prose around them stays clean. `SUMMARY_SYSTEM`'s prompt explicitly tells the model to recognize and silently discard that kind of garbled fragment rather than try to interpret it — verified live on a real UOB report with no leaked artifacts in the output. No automated check can catch "the model silently misread a garbled table" though — the admin-review-before-publish gate below is the real backstop for that residual risk.
- **`pdf-parse` needs `serverExternalPackages` in `next.config.ts`** — it wraps `pdfjs-dist`, which dynamically loads a separate worker script at runtime; bundling it (the default) breaks that resolution with "Setting up fake worker failed" (confirmed live — every extraction was silently falling back to Gemini until this was added). Node's `import('pdf-parse')` inside `extractSummary()` is a dynamic import specifically so this only loads in the code path that needs it.
- **Summary content**: comprehensive by design (macro/growth outlook, rates forecast, FX view, whatever else the report covers) — not narrowed to just SORA, per an explicit product decision, though rate figures are called out specifically when present, and the model is told to say so plainly when a report has no rate table rather than inventing one (verified live: UOB's reports correctly state "No SORA/SOFR forecast table was included").
- **Model note**: `extractPackages.ts`'s primary Gemini model (`gemini-3.0-flash`) was checked live against Gemini's own `ListModels` endpoint while building this feature and confirmed **not to exist** — that code has been silently 404ing on its first attempt and falling back to `gemini-2.5-flash` on every call. Not repeated here — this file's Gemini fallback chain starts directly at `gemini-2.5-flash` (confirmed available), matching `askGemini.ts`'s already-working chain.
- **Publishing is admin-gated, extraction is not**: `discoverReports()` (daily cron `/api/cron/bank-intelligence`) finds new reports AND runs extraction automatically — zero manual work to get a summary produced. But `is_published` defaults false and only an admin flips it, via `ReportReviewModal.tsx`'s edit-then-publish flow — same caution already applied to rate-sheet ingestion (`extractPackages.ts`): AI reads a messy source, a human confirms before agents see it. A wrong extraction can be fixed in place (edit the summary) or re-run (`PATCH { reExtract: true }`) without deleting the row.
- Admin console (`/admin/insurance/bank-intelligence`, `components/insurance/bank-intelligence/BankIntelligenceAdminView.tsx`): "Check for new reports" (manual discovery+extraction trigger), review/edit/publish via the modal, hide/delete.
- **Agent-facing rendering**: the stored `summary` is real markdown (the AI writes headers/bold/tables, and DeepSeek's rates tables come back as genuine GFM tables) — the agent card shows a plain-text excerpt (`stripMarkdownPreview()` in `lib/types/bankIntelligence.ts`, strips `#`/`**`/bullets/`|` so the teaser reads as prose, not literal syntax) with a bank filter matching the news tab's chip pattern, and "Read full summary" opens `SummaryViewModal.tsx`, which renders the full markdown properly via `react-markdown` + `remark-gfm` under Tailwind's `@tailwindcss/typography` `prose` classes (registered in `app/globals.css`) — confirmed live by rendering a real stored summary through the exact same pipeline and checking the output HTML has real `<table>`/`<strong>`/`<h3>` tags, not leaked `###`/`**`. The admin review textarea (`ReportReviewModal.tsx`) intentionally stays raw markdown, since that's what's being edited.
