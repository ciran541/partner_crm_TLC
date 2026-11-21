-- Commission payout LEDGER (boss's requirement, 2026-11-21): each actual
-- payout is its own dated, permanent record; nothing is ever overwritten.
--
-- Before: one paid/unpaid switch + one paid date per case. Partial payments
-- were impossible, and switching back to "unpaid" erased the paid date.
-- Now:
--   commission_payouts   one row per payment (negative amount = a reversal of
--                        an earlier row, `reverses`). Rows can't be edited or
--                        deleted — corrections are new rows.
--   cases.commission_paid_total   Σ payouts (kept by trigger)
--   cases.commission_status       'paid' only when nothing is left to pay,
--                                 otherwise 'unpaid' (incl. partially paid)
--   cases.commission_paid_at      when the final payment made it fully paid
-- Those three case columns are written ONLY by recompute_case_payout() — a
-- guard trigger rejects any other change, admins and API routes included, so
-- status can't drift from the ledger. Payouts are recorded by admins via
-- POST /api/admin/insurance/payouts (service role).
--
-- What's owed = agent share (0.15% × 90% − correction fee), same formula as
-- case_summary(). If the share changes after a payment (e.g. a correction
-- fee), the status simply recalculates against what's already been paid.
--
-- No case had been marked paid when this shipped, so nothing to migrate.

-- 1. Ledger table
CREATE TABLE IF NOT EXISTS public.commission_payouts (
    id          uuid NOT NULL DEFAULT gen_random_uuid(),
    -- RESTRICT: a case with payout history can't be deleted out from under it.
    case_id     uuid NOT NULL REFERENCES public.cases(id) ON DELETE RESTRICT,
    amount      numeric(12, 2) NOT NULL CHECK (amount <> 0),
    paid_on     date NOT NULL,
    reference   text,
    note        text,
    reverses    uuid REFERENCES public.commission_payouts(id),
    recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS commission_payouts_case_idx ON public.commission_payouts (case_id, paid_on);
-- A payout can be reversed once.
CREATE UNIQUE INDEX IF NOT EXISTS commission_payouts_reverses_key ON public.commission_payouts (reverses) WHERE reverses IS NOT NULL;

ALTER TABLE public.commission_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "commission_payouts_select" ON public.commission_payouts;
CREATE POLICY "commission_payouts_select" ON public.commission_payouts
    FOR SELECT TO authenticated
    USING (
        public.is_admin_user()
        OR EXISTS (SELECT 1 FROM public.cases c WHERE c.id = commission_payouts.case_id AND c.created_by = auth.uid())
    );
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.commission_payouts FROM anon, authenticated;

-- Permanent: no edits, no deletes (corrections are reversal rows).
CREATE OR REPLACE FUNCTION public.commission_payouts_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF current_user IN ('postgres', 'supabase_admin') THEN
        RETURN COALESCE(NEW, OLD);   -- migrations / emergency SQL only
    END IF;
    RAISE EXCEPTION 'Payout records are permanent — record a reversal instead'
        USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS commission_payouts_immutable ON public.commission_payouts;
CREATE TRIGGER commission_payouts_immutable
    BEFORE UPDATE OR DELETE ON public.commission_payouts
    FOR EACH ROW EXECUTE FUNCTION public.commission_payouts_immutable();

-- 2. Derived case columns
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS commission_paid_total numeric(12, 2) NOT NULL DEFAULT 0;

-- The old trigger stamped commission_paid_at = now() on any status change;
-- the ledger now sets it (to the final payment's date).
DROP TRIGGER IF EXISTS cases_stamp_commission_paid_at ON public.cases;

-- 3. Recompute a case from its ledger
CREATE OR REPLACE FUNCTION public.recompute_case_payout(p_case uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_due   numeric;
    v_paid  numeric;
    v_last  date;
BEGIN
    SELECT
        round(round(
            CASE
                WHEN COALESCE((c.closed_won_data ->> 'original_loan_total')::numeric, 0) > 0
                    THEN (c.closed_won_data ->> 'original_loan_total')::numeric
                WHEN c.case_type IN ('Refinancing', 'Equity Loan')
                    THEN GREATEST(COALESCE(c.existing_loan_amount, 0), 0)
                ELSE GREATEST(COALESCE(c.loan_size, 0), 0)
            END * 0.0015, 2) * 0.90, 2) - COALESCE(c.correction_fee, 0)
    INTO v_due
    FROM public.cases c WHERE c.id = p_case;

    SELECT COALESCE(SUM(amount), 0), MAX(paid_on) INTO v_paid, v_last
    FROM public.commission_payouts WHERE case_id = p_case;

    PERFORM set_config('hub.payout_ledger', '1', true);   -- lets the guard below allow it
    UPDATE public.cases SET
        commission_paid_total = v_paid,
        commission_status = CASE WHEN v_paid > 0 AND v_paid >= v_due - 0.005 THEN 'paid' ELSE 'unpaid' END,
        commission_paid_at = CASE WHEN v_paid > 0 AND v_paid >= v_due - 0.005
                                  THEN (v_last::timestamp AT TIME ZONE 'Asia/Singapore') END
    WHERE id = p_case;
    PERFORM set_config('hub.payout_ledger', '', true);
END;
$$;
REVOKE ALL ON FUNCTION public.recompute_case_payout(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.commission_payouts_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.recompute_case_payout(NEW.case_id);
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS commission_payouts_after_insert ON public.commission_payouts;
CREATE TRIGGER commission_payouts_after_insert
    AFTER INSERT ON public.commission_payouts
    FOR EACH ROW EXECUTE FUNCTION public.commission_payouts_after_insert();

-- If what's owed changes (correction fee, closure figures), re-check status.
CREATE OR REPLACE FUNCTION public.cases_recompute_payout_on_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.commission_paid_total <> 0 THEN
        PERFORM public.recompute_case_payout(NEW.id);
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cases_recompute_payout_on_change ON public.cases;
CREATE TRIGGER cases_recompute_payout_on_change
    AFTER UPDATE OF correction_fee, closed_won_data, existing_loan_amount, loan_size, case_type ON public.cases
    FOR EACH ROW EXECUTE FUNCTION public.cases_recompute_payout_on_change();

-- 4. Guard: payment status only ever comes from the ledger
CREATE OR REPLACE FUNCTION public.cases_guard_payout_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF current_user IN ('postgres', 'supabase_admin') OR current_setting('hub.payout_ledger', true) = '1' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.commission_paid_total := 0;
        NEW.commission_status := 'unpaid';
        NEW.commission_paid_at := NULL;
        RETURN NEW;
    END IF;
    IF NEW.commission_paid_total IS DISTINCT FROM OLD.commission_paid_total
       OR NEW.commission_status IS DISTINCT FROM OLD.commission_status
       OR NEW.commission_paid_at IS DISTINCT FROM OLD.commission_paid_at THEN
        RAISE EXCEPTION 'Commission is marked paid by recording a payout, not by editing the case'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cases_guard_payout_fields ON public.cases;
CREATE TRIGGER cases_guard_payout_fields
    BEFORE INSERT OR UPDATE ON public.cases
    FOR EACH ROW EXECUTE FUNCTION public.cases_guard_payout_fields();

-- 5. Totals that read payment status (from 20261120000000)
CREATE OR REPLACE FUNCTION public.case_summary(
    p_viewer_id uuid,
    p_is_admin  boolean DEFAULT false,
    p_agent     uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH base AS (
    SELECT
        c.id, c.created_by, c.stage, c.case_type, c.created_at,
        c.follow_up_date, c.lock_in_end_date, c.commission_status,
        COALESCE(c.commission_paid_total, 0) AS paid_total,
        COALESCE(c.correction_fee, 0) AS correction_fee,
        p.name AS agent_name,
        -- Mirrors caseLoanBase(): the Letter of Offer total for a closed deal,
        -- otherwise the agent's estimate for the case type.
        CASE
            WHEN c.stage = 'Closed Won'
                 AND COALESCE((c.closed_won_data ->> 'original_loan_total')::numeric, 0) > 0
                THEN (c.closed_won_data ->> 'original_loan_total')::numeric
            WHEN c.case_type IN ('Refinancing', 'Equity Loan')
                THEN GREATEST(COALESCE(c.existing_loan_amount, 0), 0)
            ELSE GREATEST(COALESCE(c.loan_size, 0), 0)
        END AS loan_value
    FROM public.cases c
    LEFT JOIN public.profiles p ON p.id = c.created_by
    WHERE
        -- Explicit scoping: called with the service-role key, which bypasses RLS.
        (p_is_admin OR c.created_by = p_viewer_id)
        AND (p_agent IS NULL OR c.created_by = p_agent)
        -- Every consumer of these numbers filters drafts out, so they never
        -- enter the aggregate in the first place.
        AND NOT (c.stage = 'Touched Base' AND COALESCE(BTRIM(c.client_name), '') = '')
),
scored AS (
    SELECT
        b.*,
        CASE
            WHEN b.stage IN ('Closed Lost', 'Inactive') THEN NULL
            WHEN b.stage = 'Closed Won' AND b.commission_status = 'paid' THEN 'closed_paid'
            WHEN b.stage = 'Closed Won' THEN 'closed_unpaid'
            ELSE 'open'
        END AS bucket,
        round(b.loan_value * 0.0015, 2) AS gross
    FROM base b
),
comm AS (
    SELECT
        s.*,
        -- A correction fee comes out of the agent's share and goes to TLC, so
        -- agent + tlc still equals gross.
        round(s.gross * 0.90, 2) - s.correction_fee AS agent_share,
        round(s.gross * 0.10, 2) + s.correction_fee AS tlc_share
    FROM scored s
),
months AS (
    -- Last six calendar months including the current one, so a month with no
    -- cases still appears as a zero rather than vanishing from the chart.
    SELECT to_char(d, 'YYYY-MM') AS month
    FROM generate_series(
        date_trunc('month', CURRENT_DATE) - interval '5 months',
        date_trunc('month', CURRENT_DATE),
        interval '1 month'
    ) AS d
),
top_agents AS (
    SELECT
        COALESCE(MAX(c.agent_name), 'Unknown agent') AS name,
        count(*)                                     AS count,
        COALESCE(SUM(c.agent_share) FILTER (WHERE c.bucket IS NOT NULL), 0) AS commission
    FROM comm c
    WHERE c.stage <> 'Inactive'
    GROUP BY c.created_by
    ORDER BY count(*) DESC
    LIMIT 10
)
SELECT jsonb_build_object(
    'total_cases',  (SELECT count(*) FROM comm WHERE stage <> 'Inactive'),
    'active_cases', (SELECT count(*) FROM comm WHERE stage NOT IN ('Closed Won', 'Closed Lost', 'Inactive')),
    'inactive_cases', (SELECT count(*) FROM comm WHERE stage = 'Inactive'),
    'closed_won',   (SELECT count(*) FROM comm WHERE stage = 'Closed Won'),
    'closed_lost',  (SELECT count(*) FROM comm WHERE stage = 'Closed Lost'),

    -- Same window and rules as the Upcoming Lock-ins screen, so the count on the
    -- dashboard always matches the list it links to.
    'upcoming_lock_ins', (
        SELECT count(*) FROM comm
        WHERE stage <> 'Closed Lost'
          AND lock_in_end_date IS NOT NULL
          AND lock_in_end_date >= CURRENT_DATE
          AND lock_in_end_date <= CURRENT_DATE + 90
    ),

    -- Loan volume spans every non-draft case INCLUDING Closed Lost, which is
    -- what the Analytics screen has always shown. The commission figures below
    -- deliberately do not — they are bucket-gated.
    'volume', (SELECT COALESCE(SUM(loan_value), 0) FROM comm WHERE stage <> 'Inactive'),

    'commission', jsonb_build_object(
        'gross',              (SELECT COALESCE(SUM(gross),       0) FROM comm WHERE bucket IS NOT NULL),
        'agent',              (SELECT COALESCE(SUM(agent_share), 0) FROM comm WHERE bucket IS NOT NULL),
        'tlc',                (SELECT COALESCE(SUM(tlc_share),   0) FROM comm WHERE bucket IS NOT NULL),
        'open',               (SELECT COALESCE(SUM(agent_share), 0) FROM comm WHERE bucket = 'open'),
        -- Ledger (20261202000000): what's still OWED (share − paid so far, so a
        -- partial payment reduces it) and what has actually been PAID.
        'closed_unpaid',      (SELECT COALESCE(SUM(agent_share - paid_total), 0) FROM comm WHERE bucket = 'closed_unpaid'),
        'closed_paid',        (SELECT COALESCE(SUM(paid_total), 0) FROM comm WHERE stage = 'Closed Won'),
        'total',              (SELECT COALESCE(SUM(agent_share), 0) FROM comm WHERE bucket IS NOT NULL),
        'active_cases',       (SELECT count(*) FROM comm WHERE bucket = 'open'),
        'count_open',         (SELECT count(*) FROM comm WHERE bucket = 'open'),
        'count_closed_unpaid',(SELECT count(*) FROM comm WHERE bucket = 'closed_unpaid'),
        'count_closed_paid',  (SELECT count(*) FROM comm WHERE bucket = 'closed_paid')
    ),

    -- COALESCE because jsonb_object_agg over an empty set returns NULL, which
    -- would arrive at the client as `null` rather than an empty map.
    'stage_counts', COALESCE((
        SELECT jsonb_object_agg(stage, n) FROM (
            SELECT stage, count(*) AS n FROM comm GROUP BY stage
        ) s
    ), '{}'::jsonb),

    'type_counts', COALESCE((
        SELECT jsonb_object_agg(case_type, n) FROM (
            SELECT case_type, count(*) AS n FROM comm GROUP BY case_type
        ) t
    ), '{}'::jsonb),

    'monthly', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('month', m.month, 'count', (
            SELECT count(*) FROM comm WHERE comm.stage <> 'Inactive' AND to_char(comm.created_at, 'YYYY-MM') = m.month
        )) ORDER BY m.month)
        FROM months m
    ), '[]'::jsonb),

    'follow_ups', jsonb_build_object(
        'total',    (SELECT count(*) FROM comm WHERE follow_up_date IS NOT NULL),
        'overdue',  (SELECT count(*) FROM comm WHERE follow_up_date IS NOT NULL AND follow_up_date <= CURRENT_DATE),
        'upcoming', (SELECT count(*) FROM comm WHERE follow_up_date IS NOT NULL AND follow_up_date >  CURRENT_DATE)
    ),

    'top_agents', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', name, 'count', count, 'commission', commission))
        FROM top_agents
    ), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.case_summary(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.case_summary(uuid, boolean, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.case_commission_by_agent()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH roster AS (
    SELECT
        p.id,
        COALESCE(NULLIF(BTRIM(p.name), ''), 'Unnamed agent') AS name
    FROM public.profiles p
    WHERE p.role = 'agent'
      AND p.app_type = 'insurance'
      AND COALESCE(p.status, '') <> 'disabled'
),
scored AS (
    SELECT
        c.created_by,
        COALESCE(c.correction_fee, 0) AS correction_fee,
        COALESCE(c.commission_paid_total, 0) AS paid_total,
        CASE
            WHEN c.stage = 'Closed Won' AND c.commission_status = 'paid' THEN 'closed_paid'
            WHEN c.stage = 'Closed Won' THEN 'closed_unpaid'
            ELSE 'open'
        END AS bucket,
        round(
            CASE
                WHEN c.stage = 'Closed Won'
                     AND COALESCE((c.closed_won_data ->> 'original_loan_total')::numeric, 0) > 0
                    THEN (c.closed_won_data ->> 'original_loan_total')::numeric
                WHEN c.case_type IN ('Refinancing', 'Equity Loan')
                    THEN GREATEST(COALESCE(c.existing_loan_amount, 0), 0)
                ELSE GREATEST(COALESCE(c.loan_size, 0), 0)
            END * 0.0015, 2
        ) AS gross
    FROM public.cases c
    WHERE
        -- No bucket => excluded from earnings entirely.
        c.stage NOT IN ('Closed Lost', 'Inactive')
        AND NOT (c.stage = 'Touched Base' AND COALESCE(BTRIM(c.client_name), '') = '')
),
per_case AS (
    SELECT s.created_by, s.bucket, s.paid_total, round(s.gross * 0.90, 2) - s.correction_fee AS agent_share
    FROM scored s
),
per_agent AS (
    SELECT
        r.id   AS "agentId",
        r.name AS "agentName",
        COALESCE(SUM(pc.agent_share) FILTER (WHERE pc.bucket = 'open'),          0) AS open,
        COALESCE(SUM(pc.agent_share - pc.paid_total) FILTER (WHERE pc.bucket = 'closed_unpaid'), 0) AS "closedUnpaid",
        COALESCE(SUM(pc.paid_total) FILTER (WHERE pc.bucket IN ('closed_paid', 'closed_unpaid')), 0) AS "closedPaid",
        COALESCE(count(*)            FILTER (WHERE pc.bucket = 'open'),          0) AS "activeCases",
        COALESCE(SUM(pc.agent_share),                                            0) AS total
    FROM roster r
    LEFT JOIN per_case pc ON pc.created_by = r.id
    GROUP BY r.id, r.name
)
SELECT COALESCE(
    (SELECT jsonb_agg(to_jsonb(pa) ORDER BY pa.total DESC, pa."agentName") FROM per_agent pa),
    '[]'::jsonb
);
$$;

REVOKE ALL ON FUNCTION public.case_commission_by_agent() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.case_commission_by_agent() TO service_role;

-- 6. search_cases: + commission_paid_total and payouts (same signature as
-- 20261129000000 — copied from it, the newest definition).
CREATE OR REPLACE FUNCTION public.search_cases(
    p_viewer_id          uuid,
    p_is_admin           boolean     DEFAULT false,
    p_search             text        DEFAULT NULL,
    p_stage              text        DEFAULT 'active',
    p_case_type          text        DEFAULT NULL,
    p_agent              uuid        DEFAULT NULL,
    p_from               date        DEFAULT NULL,
    p_to                 date        DEFAULT NULL,
    p_month              text        DEFAULT NULL,
    p_include_drafts     boolean     DEFAULT false,
    p_include_agent_name boolean     DEFAULT false,
    p_updated_since      timestamptz DEFAULT NULL,
    p_exclude_stages     text[]      DEFAULT NULL,
    p_has_follow_up      boolean     DEFAULT false,
    p_follow_up_to       date        DEFAULT NULL,
    p_follow_up_after    date        DEFAULT NULL,
    p_lock_in_from       date        DEFAULT NULL,
    p_lock_in_to         date        DEFAULT NULL,
    p_bucket             text        DEFAULT NULL,
    p_drafts_only        boolean     DEFAULT false,
    p_own_only           boolean     DEFAULT false,
    p_sort               text        DEFAULT 'updated_at',
    p_dir                text        DEFAULT 'desc',
    p_limit              int         DEFAULT 50,
    p_offset             int         DEFAULT 0,
    p_missing_follow_up  boolean     DEFAULT false,
    p_closed_month       text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH opts AS (
    SELECT
        CASE
            WHEN p_sort IN ('follow_up_date', 'lock_in_end_date', 'created_at') THEN p_sort
            ELSE 'updated_at'
        END AS sort_col,
        (lower(COALESCE(p_dir, 'desc')) = 'asc') AS asc_dir
),
raw AS (
    SELECT
        c.id, c.created_by, c.stage, c.case_type, c.client_name, c.client_mobile,
        c.client_email, c.loan_size, c.property_type, c.property_price,
        c.current_bank, c.existing_loan_amount, c.lock_in_end_date,
        c.closed_package_details, c.closed_interest_rate, c.closed_tenure,
        c.subsidy_provided, c.clawback_end_date, c.remarks, c.created_at,
        c.updated_at, c.closed_lost_reason, c.closed_lost_notes, c.follow_up_date,
        c.referred_bankers, c.closed_won_data, c.commission_status, c.parent_case_id, c.correction_fee,
        c.follow_up_remark, c.no_follow_up, c.client_reminder_opt_in,
        public.case_closed_on(c.closed_won_data, c.updated_at) AS closed_on,
        c.commission_paid_at, COALESCE(c.commission_paid_total, 0) AS commission_paid_total,
        CASE WHEN c.stage = 'Closed Won' THEN (
            SELECT jsonb_agg(jsonb_build_object('amount', cp.amount, 'paid_on', cp.paid_on) ORDER BY cp.paid_on, cp.created_at)
            FROM public.commission_payouts cp WHERE cp.case_id = c.id
        ) END AS payouts,
        jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role) AS profiles,
        -- Mirrors caseLoanBase() in lib/insurance/commission.ts.
        CASE
            WHEN c.stage = 'Closed Won'
                 AND COALESCE((c.closed_won_data ->> 'original_loan_total')::numeric, 0) > 0
                THEN (c.closed_won_data ->> 'original_loan_total')::numeric
            WHEN c.case_type IN ('Refinancing', 'Equity Loan')
                THEN GREATEST(COALESCE(c.existing_loan_amount, 0), 0)
            ELSE GREATEST(COALESCE(c.loan_size, 0), 0)
        END AS loan_value,
        -- Mirrors commissionBucket(): NULL for drafts, Closed Lost and Inactive.
        CASE
            WHEN c.stage = 'Touched Base' AND COALESCE(BTRIM(c.client_name), '') = '' THEN NULL
            WHEN c.stage IN ('Closed Lost', 'Inactive') THEN NULL
            WHEN c.stage = 'Closed Won' AND c.commission_status = 'paid' THEN 'closed_paid'
            WHEN c.stage = 'Closed Won' THEN 'closed_unpaid'
            ELSE 'open'
        END AS bucket
    FROM public.cases c
    LEFT JOIN public.profiles p ON p.id = c.created_by
    WHERE
        -- Explicit scoping: called with the service-role key, which bypasses RLS.
        (p_is_admin OR c.created_by = p_viewer_id)
        -- Narrows an admin to their own rows. Redundant but harmless for agents,
        -- who are already restricted to themselves by the clause above.
        AND (NOT p_own_only OR c.created_by = p_viewer_id)
        AND (p_agent IS NULL OR c.created_by = p_agent)
        AND (
            CASE
                WHEN p_stage IS NULL OR p_stage IN ('', 'all') THEN TRUE
                WHEN p_stage = 'active' THEN c.stage NOT IN ('Closed Won', 'Closed Lost', 'Inactive')
                ELSE c.stage = p_stage
            END
        )
        AND (p_exclude_stages IS NULL OR NOT (c.stage = ANY (p_exclude_stages)))
        AND (p_case_type IS NULL OR p_case_type = '' OR c.case_type = p_case_type)
        -- Draft handling, mirroring isDraftCase():
        --   p_drafts_only  -> ONLY drafts (the planner's in-progress list)
        --   p_include_drafts -> drafts alongside everything else
        --   neither        -> drafts hidden (the default everywhere else)
        AND (
            CASE
                WHEN p_drafts_only
                    THEN c.stage = 'Touched Base' AND COALESCE(BTRIM(c.client_name), '') = ''
                WHEN p_include_drafts
                    THEN TRUE
                ELSE NOT (c.stage = 'Touched Base' AND COALESCE(BTRIM(c.client_name), '') = '')
            END
        )
        AND (
            p_search IS NULL OR BTRIM(p_search) = ''
            OR c.client_name   ILIKE '%' || BTRIM(p_search) || '%'
            OR c.client_mobile ILIKE '%' || BTRIM(p_search) || '%'
            OR c.client_email  ILIKE '%' || BTRIM(p_search) || '%'
            OR (p_include_agent_name AND p.name ILIKE '%' || BTRIM(p_search) || '%')
        )
        AND (p_from IS NULL OR c.created_at >= p_from::timestamptz)
        AND (p_to IS NULL OR c.created_at < ((p_to + 1)::timestamptz))
        AND (p_month IS NULL OR p_month = '' OR to_char(c.created_at, 'YYYY-MM') = p_month)
        -- Closed Won tab: the month the case was CLOSED (SGT), not created.
        AND (p_closed_month IS NULL OR p_closed_month = '' OR (
            c.stage = 'Closed Won'
            AND starts_with(to_char(public.case_closed_on(c.closed_won_data, c.updated_at), 'YYYY-MM'), p_closed_month)
        ))
        AND (p_updated_since IS NULL OR c.updated_at > p_updated_since)
        AND (NOT p_has_follow_up OR c.follow_up_date IS NOT NULL)
        -- Action Centre "Needs a follow-up date": mirrors needsFollowUp() in
        -- lib/insurance/followUps.ts, minus cases already revisited (the follow-on
        -- case carries the follow-up).
        AND (NOT p_missing_follow_up OR (
            c.follow_up_date IS NULL
            AND NOT (c.no_follow_up AND c.stage = 'Closed Lost')
            AND NOT (c.stage = 'Touched Base' AND COALESCE(BTRIM(c.client_name), '') = '')
            AND NOT EXISTS (SELECT 1 FROM public.cases ch WHERE ch.parent_case_id = c.id)
        ))
        AND (p_follow_up_to    IS NULL OR c.follow_up_date <= p_follow_up_to)
        AND (p_follow_up_after IS NULL OR c.follow_up_date >  p_follow_up_after)
        AND (p_lock_in_from IS NULL OR c.lock_in_end_date >= p_lock_in_from)
        AND (p_lock_in_to   IS NULL OR c.lock_in_end_date <= p_lock_in_to)
),
filtered AS (
    SELECT * FROM raw
    WHERE
        p_bucket IS NULL OR p_bucket = ''
        OR (p_bucket = 'all' AND bucket IS NOT NULL)
        OR bucket = p_bucket
),
ordered AS (
    SELECT
        f.*,
        row_number() OVER (
            ORDER BY
                CASE WHEN o.sort_col = 'follow_up_date'   AND     o.asc_dir THEN f.follow_up_date   END ASC  NULLS LAST,
                CASE WHEN o.sort_col = 'follow_up_date'   AND NOT o.asc_dir THEN f.follow_up_date   END DESC NULLS LAST,
                CASE WHEN o.sort_col = 'lock_in_end_date' AND     o.asc_dir THEN f.lock_in_end_date END ASC  NULLS LAST,
                CASE WHEN o.sort_col = 'lock_in_end_date' AND NOT o.asc_dir THEN f.lock_in_end_date END DESC NULLS LAST,
                CASE WHEN o.sort_col = 'created_at'       AND     o.asc_dir THEN f.created_at       END ASC  NULLS LAST,
                CASE WHEN o.sort_col = 'created_at'       AND NOT o.asc_dir THEN f.created_at       END DESC NULLS LAST,
                CASE WHEN o.sort_col = 'updated_at'       AND     o.asc_dir THEN f.updated_at       END ASC  NULLS LAST,
                CASE WHEN o.sort_col = 'updated_at'       AND NOT o.asc_dir THEN f.updated_at       END DESC NULLS LAST,
                f.id
        ) AS rn
    FROM filtered f
    CROSS JOIN opts o
),
paged AS (
    SELECT *
    FROM ordered
    WHERE rn >  GREATEST(COALESCE(p_offset, 0), 0)
      AND rn <= GREATEST(COALESCE(p_offset, 0), 0) + GREATEST(COALESCE(p_limit, 50), 0)
)
SELECT jsonb_build_object(
    'rows', COALESCE((
        SELECT jsonb_agg(to_jsonb(pg) - 'rn' ORDER BY pg.rn) FROM paged pg
    ), '[]'::jsonb),
    'total',       (SELECT count(*) FROM filtered),
    'loan_volume', (SELECT COALESCE(SUM(loan_value), 0) FROM filtered),
    -- Agent take-home across the filter, per case exactly like case_summary():
    -- round(round(loan × 0.15%) × 90%) − correction fee. Earnings' year footer.
    'agent_share', (SELECT COALESCE(SUM(round(round(loan_value * 0.0015, 2) * 0.90, 2) - COALESCE(correction_fee, 0)), 0) FROM filtered)
);
$$;

REVOKE ALL ON FUNCTION public.search_cases(
    uuid, boolean, text, text, text, uuid, date, date, text, boolean, boolean,
    timestamptz, text[], boolean, date, date, date, date, text, boolean, boolean,
    text, text, int, int, boolean, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.search_cases(
    uuid, boolean, text, text, text, uuid, date, date, text, boolean, boolean,
    timestamptz, text[], boolean, date, date, date, date, text, boolean, boolean,
    text, text, int, int, boolean, text
) TO service_role;
