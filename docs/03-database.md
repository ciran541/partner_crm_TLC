# 03 – Database

The data model is the business model. This doc covers the tables (grouped by purpose), the three design decisions worth understanding, and the migration workflow.

Reference files: `supabase/schema/full_current_schema.sql` (full snapshot of tables, foreign keys **and RLS policies** — regenerate with `npm run sync-schema`) and `supabase/migrations/` (the ordered history of every change).

## Tables, grouped

### Identity & access
| Table | Purpose |
|-------|---------|
| `profiles` | One row per user, keyed to Supabase Auth's user id. The multi-tenancy hinge (see below) |
| `agent_invites` | Invite tokens for insurance signup (invite-gated, email-locked) |
| `user_consents` | T&C / privacy-policy acceptance records, versioned |
| `admin_audit_log` | Who did what in the admin area (`actor_id`, `action`, `target`, `details` JSONB) |

### Core business objects
| Table | Purpose |
|-------|---------|
| `cases` | Insurance cases: pipeline `stage`, `case_type`, client contact fields, and the big one — `workflow_data` JSONB (see below). Closure data in `closed_won_data` JSONB / `closed_lost_reason` |
| `insurance_case_activity_logs` | Per-case audit trail (insurance) |
| `property_cases` | Property cases: client + loan details, extensive commission columns (gross/agent/TLC splits, projected vs. actual recurring), follow-up fields, duplicate flagging |
| `property_case_documents` | Uploaded files per property case (Supabase Storage URLs) |
| `property_reminders` | Follow-up reminder queue for the daily email cron |
| `property_case_activity_logs` | Per-case audit trail (property) |
| `property_calendar_events` / `insurance_calendar_events` | Google Calendar event mappings so synced events can be updated/deleted later |
| `banks` | Shared bank reference list |

### Curated content (insurance agents consume, admins manage)
| Table | Purpose |
|-------|---------|
| `knowledge_articles` | Knowledge base, with a 384-dim embedding vector per article for semantic search |
| `knowledge_gaps` | Questions agents asked that retrieval couldn't answer — an admin to-do list |
| `mortgage_packages` | Structured bank rate packages (`rate_schedule` JSONB: ordered per-year entries) |
| `bank_intelligence_reports` | Discovered bank research reports + AI summaries (`is_published` gate) |
| `mortgage_news_articles` | Auto-ingested news (relevance-classified, admin-overridable, cached `summary`) |
| `economic_calendar_events` | FOMC / US CPI / MAS MPS dates with impact ratings |

### Market data (flows in automatically)
| Table | Purpose |
|-------|---------|
| `sora_rates` | Daily SORA from MAS (drives floating-rate computation) |
| `domestic_rates` | MAS domestic interest-rate snapshots for charts |
| `bank_benchmarks` | Bank benchmark rates |

## Design decision 1 — `profiles` is the hinge of multi-tenancy

```sql
profiles (
  id uuid,              -- same id as Supabase Auth user
  role text,            -- 'agent' | 'admin' | 'super_admin'
  app_type text,        -- 'insurance' | 'property'
  status text,          -- 'active' | ...
  name, full_name, mobile, cea_registration_no, agency_name,
  google_refresh_token, google_calendar_connected,
  current_session_id,   -- single-session enforcement
  onboarding jsonb
)
```

Two small columns — `role` and `app_type` — decide everything a user can see. Every route guard and RLS policy ultimately reads them.

> **Why it matters:** because these columns are the security perimeter, the client-side UPDATE grant on `profiles` is **column-restricted to identity fields only** (`name`, `full_name`, `mobile`, `cea_registration_no`, `agency_name`). `role`, `app_type`, `status`, Google tokens and session columns can only change via service-role API routes. Do not widen that grant — a user who can edit their own `role` owns the system.

## Design decision 2 — two case tables, not one

Insurance `cases` and `property_cases` are separate tables even though both are "cases."

> **Why:** they share almost no fields — insurance cases revolve around pipeline stage + workflow answers; property cases revolve around commission accounting (a dozen numeric columns for splits and projections). One merged table would be mostly-empty columns plus permission complexity. The cost: any "all cases" admin view must query both. That trade was taken knowingly.

## Design decision 3 — `workflow_data` is a JSONB document

Insurance workflow answers live in a single `workflow_data` JSONB column rather than one column per question. The *shape* per case type is defined in TypeScript (`lib/types/workflow.ts` — `RefinancingWorkflow`, `PurchaseWorkflow`, etc.), with `getRefinancingWorkflow()`-style accessors doing safe extraction.

> **Why:** workflows differ per case type and change shape as the product evolves. With JSONB, adding a question is a code change, not a schema migration. The price: the database can't validate or efficiently query inside the blob — TypeScript types are the only schema, and they're enforced at the edges, not in the DB. Same pattern for `closed_won_data`, `selected_package_snapshot` (a frozen copy of the chosen rate package, so later admin edits can't silently change a client's proposal), and `profiles.onboarding`.
>
> Legacy note: `cases.sales_assistant_data` was the old workflow column; it's read-only legacy now — `workflow_data` is the one that's written.

## Row Level Security (summary — full detail in [04 – Auth & Security](04-auth-security.md))

- Agent-owned tables (cases etc.): policies restrict rows to the owning agent; admin checks use the `is_admin_user()` SECURITY DEFINER function. (Never subquery `profiles` inside a `profiles` policy — infinite recursion.)
- Content/market tables (`knowledge_articles`, `mortgage_packages`, news, calendar, SORA): RLS is **on with no client policies at all** — the browser can't read them even with the public anon key. All access flows through guarded server routes using the service-role client.

## The migration workflow (non-negotiable)

1. Write a file in `supabase/migrations/` named `<timestamp>_short_name.sql` (e.g. `20260530000000_add_column.sql`).
2. Apply it: `npx supabase db push`.
3. Never use the Supabase SQL Editor for schema changes — they'd be invisible to the repo. If an emergency forces it, run `npm run sync-schema` immediately after so the drift shows up in `schema/full_current_schema.sql`.

> **Why:** the migrations folder is the audit trail and the rebuild recipe. It's what lets you spin up an identical empty database (for staging or a future developer) without ever copying production data. Separate deploy step to remember: the embedding Edge Function ships via `supabase functions deploy embed`, not `db push`.
