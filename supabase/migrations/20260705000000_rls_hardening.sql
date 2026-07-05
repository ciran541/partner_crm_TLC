-- RLS hardening for the insurance `cases` and shared `profiles` tables.
--
-- Until now the SELECT / INSERT / UPDATE policies on these two tables existed
-- only in the live database (created via SQL Editor before the migration
-- workflow was adopted) — this migration codifies them in the repo and fixes
-- three problems found when dumping pg_policies:
--
--  1. PRIVILEGE ESCALATION: "Users can update own profile" had no column
--     restriction, and `authenticated` held a full-table UPDATE grant — so any
--     agent could PATCH their own `role` to 'super_admin' (or flip `app_type` /
--     `status`) straight through PostgREST. Fixed with column-level grants:
--     self-service profile edits are limited to the identity fields the profile
--     pages actually edit. All privileged writes (role, status, app_type,
--     Google tokens, session id) go through service-role API routes, which
--     bypass these grants.
--
--  2. cases_select_policy / cases_update_policy only recognised role 'admin',
--     not 'super_admin' — a super_admin saw and could edit only their OWN cases
--     in the dashboard, even though every app-level check (isAdmin(),
--     requireAdminUser(), the cases_delete policy) treats both roles as admin.
--
--  3. `cases` carried two redundant UPDATE policies ("Agents update own cases,
--     admins update all" AND "cases_update_policy") — SQL Editor archaeology.
--
-- Admin checks use is_admin_user(), a SECURITY DEFINER helper: a policy on
-- `profiles` cannot subquery `profiles` directly (infinite RLS recursion), and
-- the other policies get the same helper for consistency.
--
-- All other insurance tables (knowledge_articles, mortgage_packages, sora_rates,
-- mortgage_news_articles, economic_calendar_events, ...) intentionally have RLS
-- enabled with NO client policies: they deny anon/authenticated entirely and are
-- reachable only through service-role server routes. That design is unchanged.

-- ── Shared admin check (SECURITY DEFINER avoids profiles→profiles recursion) ──

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    );
$$;

REVOKE ALL ON FUNCTION public.is_admin_user() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated;

-- ── cases: one canonical policy per command, super_admin included ─────────────

DROP POLICY IF EXISTS "cases_select_policy" ON public.cases;
DROP POLICY IF EXISTS "Agents can create cases" ON public.cases;
DROP POLICY IF EXISTS "Agents update own cases, admins update all" ON public.cases;
DROP POLICY IF EXISTS "cases_update_policy" ON public.cases;
DROP POLICY IF EXISTS "cases_select" ON public.cases;
DROP POLICY IF EXISTS "cases_insert" ON public.cases;
DROP POLICY IF EXISTS "cases_update" ON public.cases;

CREATE POLICY "cases_select" ON public.cases
    FOR SELECT TO authenticated
    USING (created_by = auth.uid() OR public.is_admin_user());

CREATE POLICY "cases_insert" ON public.cases
    FOR INSERT TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "cases_update" ON public.cases
    FOR UPDATE TO authenticated
    USING (created_by = auth.uid() OR public.is_admin_user())
    WITH CHECK (created_by = auth.uid() OR public.is_admin_user());

-- cases_delete (20260612000000) is already tracked and correct — left untouched.

-- ── profiles: admins may read all rows (needed for the client-side
--    cases→profiles join on admin case lists); self-read stays as-is ──────────

DROP POLICY IF EXISTS "profiles_admin_select" ON public.profiles;

CREATE POLICY "profiles_admin_select" ON public.profiles
    FOR SELECT TO authenticated
    USING (public.is_admin_user());

-- ── profiles: block self-service privilege escalation ─────────────────────────
-- RLS is row-level only; column control needs grants. Restrict client UPDATE to
-- the self-editable identity fields. role / app_type / status / joined_at /
-- google_* / current_session_id are service-role-only from here on.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (name, full_name, mobile, cea_registration_no, agency_name)
    ON public.profiles TO authenticated;
