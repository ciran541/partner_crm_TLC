-- Protect admin-owned (money) fields on case tables from direct browser writes.
--
-- RLS decides WHICH rows a user may write, never WHICH columns. Agents write
-- their own `cases` rows straight from the browser (insurance case page), so
-- before this an agent could open DevTools and run
--     supabase.from('cases').update({ commission_status: 'paid' })
-- on their own case. Same class of hole on `property_cases` via its pc_insert /
-- pc_update policies, even though the property app itself never uses them.

-- ── 1. cases: trigger guards the admin-owned columns ─────────────────────────
--
-- Rules for non-admin end users (PostgREST role `authenticated`):
--   * commission_status can't be set on INSERT (other than the 'unpaid' default)
--     and can't be changed on UPDATE. Admins toggle it via /api/admin/update-case.
--   * once a case's commission is PAID, the fields its payout is derived from
--     (stage, case_type, closed_won_data — see lib/insurance/commission.ts) are
--     frozen, so the paid record can't be rewritten after the fact.
--     Loan fields (loan_size / existing_loan_amount) are left editable on
--     purpose: the workflow autosave writes them, and for a Closed Won case the
--     commission base is closed_won_data.original_loan_total anyway.
--
-- Our API routes (service_role) and migrations / SQL editor (postgres) are not
-- end users and pass straight through, as do admins.

CREATE OR REPLACE FUNCTION public.protect_case_admin_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    -- Only police browser requests. (anon has no RLS policy on cases, so it
    -- can never reach a write anyway — but don't wave it through either.)
    IF current_user NOT IN ('authenticated', 'anon') THEN
        RETURN NEW;
    END IF;

    -- Nested (not AND-ed) so anon never calls is_admin_user(), which it has
    -- no EXECUTE grant on.
    IF current_user = 'authenticated' THEN
        IF public.is_admin_user() THEN
            RETURN NEW;
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.commission_status IS DISTINCT FROM 'unpaid' THEN
            RAISE EXCEPTION 'Only an admin can set commission status'
                USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE
    IF NEW.commission_status IS DISTINCT FROM OLD.commission_status THEN
        RAISE EXCEPTION 'Only an admin can change commission status'
            USING ERRCODE = '42501';
    END IF;

    IF OLD.commission_status = 'paid' AND (
           NEW.stage           IS DISTINCT FROM OLD.stage
        OR NEW.case_type       IS DISTINCT FROM OLD.case_type
        OR NEW.closed_won_data IS DISTINCT FROM OLD.closed_won_data
    ) THEN
        RAISE EXCEPTION 'This case''s commission has already been paid — contact an admin to change it'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cases_protect_admin_fields ON public.cases;
CREATE TRIGGER cases_protect_admin_fields
    BEFORE INSERT OR UPDATE ON public.cases
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_case_admin_fields();

-- ── 2. property_cases: no browser writes at all ──────────────────────────────
--
-- Every legitimate write already goes through server routes using the service
-- role: /api/property/cases (POST, recomputes commission server-side from the
-- whitelisted inputs), /api/property/cases/[id] (PATCH, same), the admin
-- update-case route, and the reminders cron. Nothing in the browser writes this
-- table, so the client INSERT/UPDATE policies were pure attack surface — they
-- let an agent insert a case with commission_status = 'paid', or edit
-- commission/projection amounts on their own draft/submitted case.
-- SELECT (pc_select) and admin-only DELETE (pc_delete) are unchanged.

DROP POLICY IF EXISTS "pc_insert" ON public.property_cases;
DROP POLICY IF EXISTS "pc_update" ON public.property_cases;
REVOKE INSERT, UPDATE, TRUNCATE ON public.property_cases FROM anon, authenticated;
