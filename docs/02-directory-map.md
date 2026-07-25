# 02 – Directory Map

What every folder is for, and the one Next.js idea you need first.

## The one idea: folders are URLs

In Next.js's App Router, the folder structure under `app/` **is** the routing table — there is no separate router config:

- A folder containing `page.tsx` renders a page at that URL. `app/insurance/dashboard/pipeline/page.tsx` → `yoursite.com/insurance/dashboard/pipeline`.
- A folder containing `route.ts` is an API endpoint (no UI). `app/api/insurance/rates/route.ts` → `GET/POST yoursite.com/api/insurance/rates`. The exported function names (`GET`, `POST`, `PATCH`, `DELETE`) are the HTTP verbs it accepts.
- A folder named in square brackets is a placeholder. `app/insurance/dashboard/cases/[id]/page.tsx` matches `/insurance/dashboard/cases/<any-case-id>`; the code receives `id` as a parameter.
- A `layout.tsx` wraps every page beneath it — this is where each app's sidebar and client-side authorization check live.

## Top level

| Path | What it is |
|------|------------|
| `app/` | Every page and API endpoint (see breakdown below) |
| `components/` | Reusable React UI pieces, imported by pages |
| `lib/` | The engine room: business logic, calculations, external-service clients (see breakdown below) |
| `hooks/` | (Currently empty — data hooks live in `lib/insurance/useCases.ts` / `lib/property/useCases.ts`) |
| `supabase/` | Database as code: `migrations/` (ordered schema changes), `schema/full_current_schema.sql` (reference snapshot incl. RLS policies), `functions/embed` (Edge Function for text embeddings) |
| `middleware.ts` | Runs before every protected request — authentication gate only |
| `public/` | Static assets served as-is (logos, images) |
| `scripts/` | Maintenance utilities (`sync-schema.mjs`, Google Apps Script sources) |
| `docs/` | This documentation |
| `.env.local` | Secrets keyring (git-ignored — never commit; see [11 – Operations](11-operations.md)) |
| `package.json` | Dependency list + npm scripts |
| `vercel.json` | Cron schedule |
| `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.mts` | Tool configuration. Note `next.config.ts` carries `serverExternalPackages` for `pdf-parse` — removing it silently breaks bank-report extraction |

> **`@/` in imports** is a path alias to the repo root (configured in `tsconfig.json`): `@/lib/insurance/refiCalc` = `lib/insurance/refiCalc.ts` from anywhere, avoiding `../../..` chains.

## `app/` — four zones

| Zone | Contents |
|------|----------|
| `app/insurance/` | Insurance agent UI: login/signup/onboarding, then `dashboard/` — pipeline, cases (+ per-case workflow), rates, calculators (affordability, amortization, BUC, partial repayment, stamp duty, TDSR), knowledge, resources (news, calendar, domestic rates), bank-intelligence, earnings, profile |
| `app/property/` | Property agent UI: login/signup, dashboard, cases (new/edit), earnings, follow-up, notifications, profile |
| `app/admin/` | Admin UI for both apps: `users`, `audit-log`, `analytics`, `insurance/` (cases, rates, knowledge, news, calendar, bank-intelligence, earnings, follow-ups, invites), `property/` (cases, analytics, reminders) |
| `app/api/` | All server endpoints, mirroring the same split: `api/insurance/*`, `api/property/*`, `api/admin/*`, plus `api/cron/*` (scheduled jobs) and `api/auth/*` |

Legacy note: `app/dashboard/` and `app/login/` are remnants of the pre-split property app; the live property routes are under `app/property/`. `app/dashboard/rates` redirects into the insurance rates page (shared feature).

## `lib/` — the engine room

| Folder | Contents |
|--------|----------|
| `lib/supabase/` | The three database clients (browser / server / admin) — see [01 – Architecture](01-architecture.md) |
| `lib/auth/` | `getUser.ts` (who is calling?), `requireAdmin.ts` / `requirePropertyUser.ts` / `requireInsuranceUser.ts` / `requireCron.ts` (route guards), `auditLog.ts`, `accountSwitcher.ts` |
| `lib/permissions/` | Role/app-type helpers: `canAccessInsurance()`, `canAccessProperty()`, `isAdmin()`, `getSafeRoute()`. **Never inline role string comparisons** |
| `lib/insurance/` | The crown jewels. Pure financial engines (`stampDuty.ts`, `loanCalc.ts`, `refiCalc.ts`, `purchaseCalc.ts`, `decoupleCalc.ts`, `amortCalc.ts`, `partialRepaymentCalc.ts`), report builders (`*Presentation.ts`, `*Remarks.ts`), rate engine (`rateSchedule.ts`, `rateRecommend.ts`, `extractPackages.ts`, `sora.ts`), knowledge engine (`retrieveKnowledge.ts`, `embed.ts`, `askGemini.ts`), pipelines (`news.ts`, `economicCalendar.ts`, `bankIntelligence.ts`), and `__tests__/` |
| `lib/property/` | Property-side logic: `commission.ts`, `amortization.ts`, `processReminders.ts`, `useCases.ts` |
| `lib/email/` | Resend senders + `generatePdf.ts` (HTML → PDF via headless Chromium) |
| `lib/google/` | OAuth + Google Calendar sync for follow-up dates |
| `lib/legal/` | Consent versions and T&C/privacy-policy content |
| `lib/types/` | All domain TypeScript types, one file per area, re-exported through the barrel `index.ts` — import as `@/lib/types` |
| `lib/utils/` | `formatCurrency.ts`, `formatDate.ts` |
| `lib/services/` | `sheets-sync.ts` (legacy Google Sheets restore path) |

> **Why `lib/` is separate from `app/`:** files in `app/` are wired to URLs and HTTP; files in `lib/` are plain functions. Keeping the math and pipelines out of route files makes them reusable across routes and unit-testable without a browser or server.

## `components/` — reusable UI

| Folder | Contents |
|--------|----------|
| `components/shared/` | Cross-app primitives: `Modal`, `Spinner`, `Skeleton`, `EmptyState`, `InlineAlert`, `StatsCard`, `PageHeader`, `FilterPills`, `AccountSwitcher`, `LegalConsentModal`, `UrgencyBanner` |
| `components/insurance/` | Insurance features: `workflow/` (the step engine UI), `rates/` (editor + ingestion modals), `knowledge/`, `news/`, `calendar/`, `bank-intelligence/`, `earnings/`, `onboarding/` |
| `components/property/` | `BankDropdown`, `CaseTypeSelector`, `CommissionHero`, `DocumentUploader` |

> **Rule of thumb:** if a piece of UI appears on more than one page, it lives here; pages in `app/` compose these pieces and hold page-specific state. Styling is Tailwind CSS v4 with shared classes (`.card`, `.btn-primary`, `.sidebar-link`) defined in `app/globals.css`.
