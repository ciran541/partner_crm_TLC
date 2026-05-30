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
```
