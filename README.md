# TLC Partner CRM

A multi-tenant CRM platform serving two separate businesses from one codebase:

| App | URL prefix | Users |
|-----|-----------|-------|
| **Property Agent CRM** | `/property/*` | Property agents referring mortgage clients (commission tracking, follow-ups, documents) |
| **Insurance CRM** | `/insurance/*` | Insurance agents advising on Singapore mortgages (workflow engine, rate comparison, knowledge base, market intelligence) |

Plus a shared `/admin/*` area for administrators of both apps.

**Stack:** Next.js (App Router) · React · TypeScript · Tailwind CSS v4 · Supabase (Postgres + Auth + RLS) · Vercel (hosting + cron) · Resend (email) · Gemini & DeepSeek (AI features)

## Quick start

```bash
npm install
# create .env.local — see docs/11-operations.md for every variable
npm run dev          # http://localhost:3000
```

Other commands:

```bash
npm run build        # production build
npm run lint         # ESLint
npm test             # Vitest — financial calculation core (lib/insurance/__tests__)
npx tsc --noEmit     # TypeScript check
npm run sync-schema  # regenerate supabase/schema/full_current_schema.sql from live DB
npx supabase db push # apply pending migration files to Supabase
```

## Documentation

Read in order if you're new; each doc stands alone otherwise.

| Doc | Covers |
|-----|--------|
| [01 – Architecture](docs/01-architecture.md) | The big picture: two apps in one codebase, multi-tenancy, what's rented vs. built, request lifecycle |
| [02 – Directory Map](docs/02-directory-map.md) | What every top-level folder is for and how Next.js turns folders into URLs |
| [03 – Database](docs/03-database.md) | Every table, key design decisions (JSONB workflows, split case tables), the migration workflow |
| [04 – Auth & Security](docs/04-auth-security.md) | The three security layers: middleware, route guards, Row Level Security |
| [05 – Insurance Workflows](docs/05-insurance-workflows.md) | The core insurance feature: per-case-type workflow engine, financial calculators, PDF reports |
| [06 – Rates & SORA](docs/06-rates-and-sora.md) | Mortgage packages, AI rate-sheet ingestion, daily SORA feed, Step 4 auto-recommendation |
| [07 – Knowledge Engine](docs/07-knowledge-engine.md) | Semantic search + grounded AI answers over the admin-curated knowledge base |
| [08 – News & Economic Calendar](docs/08-news-and-calendar.md) | Auto-curated mortgage news pipeline and the FOMC/CPI/MAS calendar |
| [09 – Banks' Insights](docs/09-bank-insights.md) | Auto-discovered bank research reports with AI summaries |
| [10 – Property App](docs/10-property-app.md) | The property agent CRM: cases, commissions, documents, Google Calendar sync |
| [11 – Operations](docs/11-operations.md) | Deployment, environment variables, cron jobs, backups, the staging model for future developers |

Also in the repo:

- [CLAUDE.md](CLAUDE.md) — dense working notes for AI-assisted development (includes hard-won gotchas about external data sources; worth skimming even as a human)
- [DEPLOYMENT.md](DEPLOYMENT.md) — step-by-step production deployment checklist
- [docs/BACKUP_SETUP.md](docs/BACKUP_SETUP.md) / [docs/DISASTER_RECOVERY.md](docs/DISASTER_RECOVERY.md) — backup and recovery runbooks
- [docs/recommendation-engine.md](docs/recommendation-engine.md) — design notes for the rate recommendation engine

## House rules (the short version)

1. **Database changes go through migration files** in `supabase/migrations/` (`<timestamp>_name.sql`), applied with `npx supabase db push`. Never the Supabase SQL Editor.
2. **Financial math lives in exactly one module** (`lib/insurance/stampDuty.ts`, `loanCalc.ts`, per-engine calcs). Never re-implement BSD/ABSD/TDSR/IWAA locally. Run `npm test` after touching them.
3. **Every admin API route guards with `requireAdminUser()`**; property routes with `requirePropertyUser()`. No unguarded server routes.
4. **Role checks use `lib/permissions/` helpers** — never inline role string comparisons.
5. **Improvements to one workflow must be propagated to all applicable workflows.**
