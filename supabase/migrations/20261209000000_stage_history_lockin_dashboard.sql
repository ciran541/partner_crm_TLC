-- Stage history, lock-in end of the closed loan, Track filters and two new
-- Dashboard sections. Nothing here rejects a write, so it is safe to apply
-- before the matching code is deployed. (The follow-up limit is 20261210000000.)

-- ── 1. When a case entered its stage, and every stage change ────────────────
-- Existing cases start counting from this migration: HUB never recorded it before.
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.case_stage_history (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id    uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
    from_stage text,
    to_stage   text NOT NULL,
    changed_by uuid,
    changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_stage_history_case_idx ON public.case_stage_history (case_id, changed_at DESC);
-- Written only by the trigger; read only through server functions.
ALTER TABLE public.case_stage_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_stage_history FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.cases_stamp_stage_changed()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW.stage IS DISTINCT FROM OLD.stage THEN
        NEW.stage_changed_at := now();
    ELSE
        NEW.stage_changed_at := OLD.stage_changed_at;   -- can't be set by hand
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cases_stamp_stage_changed ON public.cases;
CREATE TRIGGER cases_stamp_stage_changed BEFORE INSERT OR UPDATE ON public.cases
    FOR EACH ROW EXECUTE FUNCTION public.cases_stamp_stage_changed();

CREATE OR REPLACE FUNCTION public.cases_record_stage_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.stage IS NOT DISTINCT FROM OLD.stage THEN RETURN NEW; END IF;
    END IF;
    INSERT INTO public.case_stage_history (case_id, from_stage, to_stage, changed_by)
    VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage END, NEW.stage, COALESCE(auth.uid(), NEW.created_by));
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.cases_record_stage_history() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cases_record_stage_history ON public.cases;
CREATE TRIGGER cases_record_stage_history AFTER INSERT OR UPDATE ON public.cases
    FOR EACH ROW EXECUTE FUNCTION public.cases_record_stage_history();

-- ── 2. Lock-in end of the client's CURRENT loan ─────────────────────────────
-- SQL twin of caseLockInEnd() in lib/insurance/followUps.ts. Closed Won = the loan
-- just closed: the date confirmed at closing, else closing date + lock-in years.
CREATE OR REPLACE FUNCTION public.case_lock_in_end(p_stage text, p_lock_in_end date, p_closed_won jsonb)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_stage IS DISTINCT FROM 'Closed Won' THEN p_lock_in_end
        WHEN COALESCE(p_closed_won ->> 'lock_in_end_date', '') ~ '^\d{4}-\d{2}-\d{2}'
            THEN left(p_closed_won ->> 'lock_in_end_date', 10)::date
        WHEN COALESCE(p_closed_won ->> 'closed_at', '') ~ '^\d{4}-\d{2}-\d{2}'
             AND COALESCE(p_closed_won #>> '{package,lockin_years}', '') ~ '^\d+(\.\d+)?$'
             AND (p_closed_won #>> '{package,lockin_years}')::numeric > 0
            THEN (left(p_closed_won ->> 'closed_at', 10)::date
                  + make_interval(months => round((p_closed_won #>> '{package,lockin_years}')::numeric * 12)::int))::date
    END
$$;

-- ── 3. Bankers on the viewer's open cases (Track's banker filter) ───────────
CREATE OR REPLACE FUNCTION public.open_case_bankers(p_viewer_id uuid, p_is_admin boolean DEFAULT false, p_agent uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'bank', bank, 'cases', n) ORDER BY bank, name), '[]'::jsonb)
    FROM (
        SELECT b ->> 'name' AS name, b ->> 'bank' AS bank, count(DISTINCT c.id) AS n
        FROM public.cases c
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(c.referred_bankers) = 'array' THEN c.referred_bankers ELSE '[]'::jsonb END) b
        WHERE c.stage IN ('Touched Base', 'Pending Docs', 'Pending Approval', 'Pending Signature')
          AND (p_is_admin OR c.created_by = p_viewer_id)
          AND (p_agent IS NULL OR c.created_by = p_agent)
          AND COALESCE(b ->> 'name', '') <> ''
        GROUP BY 1, 2
    ) x
$$;
REVOKE ALL ON FUNCTION public.open_case_bankers(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_case_bankers(uuid, boolean, uuid) TO service_role;

-- ── 4. Dashboard: + lost, + coming_due (from 20261201000000) ────────────────
CREATE OR REPLACE FUNCTION public.dashboard_analytics(
    p_viewer_id uuid,
    p_is_admin  boolean DEFAULT false,
    p_agent     uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH scoped AS (
    SELECT c.*,
        COALESCE(c.lead_source, 'not_set') AS src,
        CASE
            WHEN COALESCE((c.closed_won_data ->> 'original_loan_total')::numeric, 0) > 0
                THEN (c.closed_won_data ->> 'original_loan_total')::numeric
            WHEN c.case_type IN ('Refinancing', 'Equity Loan')
                THEN GREATEST(COALESCE(c.existing_loan_amount, 0), 0)
            ELSE GREATEST(COALESCE(c.loan_size, 0), 0)
        END AS loan_value
    FROM public.cases c
    WHERE (p_is_admin OR c.created_by = p_viewer_id)
      AND (p_agent IS NULL OR c.created_by = p_agent)
)
SELECT jsonb_build_object(
    'closed', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('month', month, 'source', src, 'cases', n, 'loan_volume', vol))
        FROM (
            SELECT to_char(public.case_closed_on(closed_won_data, updated_at), 'YYYY-MM') AS month,
                   src, count(*) AS n, SUM(loan_value) AS vol
            FROM scoped WHERE stage = 'Closed Won'
            GROUP BY 1, 2
        ) x
    ), '[]'::jsonb),
    'leads', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('month', month, 'source', src, 'activated', n, 'won', won, 'lost', lost, 'open', n - won - lost))
        FROM (
            SELECT to_char(first_activated_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM') AS month,
                   src, count(*) AS n,
                   count(*) FILTER (WHERE stage = 'Closed Won')  AS won,
                   count(*) FILTER (WHERE stage = 'Closed Lost') AS lost
            FROM scoped WHERE first_activated_at IS NOT NULL
            GROUP BY 1, 2
        ) y
    ), '[]'::jsonb),
    -- Why deals are lost. month = when it was lost; NULL before stage changes were recorded.
    'lost', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('month', month, 'reason', reason, 'cases', n, 'loan_volume', vol))
        FROM (
            SELECT (
                       SELECT to_char(max(h.changed_at) AT TIME ZONE 'Asia/Singapore', 'YYYY-MM')
                       FROM public.case_stage_history h WHERE h.case_id = s.id AND h.to_stage = 'Closed Lost'
                   ) AS month,
                   COALESCE(NULLIF(BTRIM(s.closed_lost_reason), ''), 'No reason given') AS reason,
                   count(*) AS n, SUM(s.loan_value) AS vol
            FROM scoped s WHERE s.stage = 'Closed Lost'
            GROUP BY 1, 2
        ) z
    ), '[]'::jsonb),
    -- Business coming due: past clients whose lock-in ends in the next 12 months
    -- (this month first). Live cases are already being worked; a revisited case is
    -- carried by its follow-on case.
    'coming_due', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('month', month, 'cases', n, 'loan_volume', vol) ORDER BY month)
        FROM (
            SELECT to_char(d.lock_end, 'YYYY-MM') AS month, count(*) AS n, SUM(d.loan) AS vol
            FROM (
                SELECT public.case_lock_in_end(s.stage, s.lock_in_end_date, s.closed_won_data) AS lock_end,
                       CASE WHEN s.stage = 'Closed Won' THEN
                           COALESCE(NULLIF((s.closed_won_data ->> 'combined_outstanding')::numeric, 0), s.loan_value)
                       ELSE s.loan_value END AS loan
                FROM scoped s
                WHERE s.stage IN ('Closed Won', 'Inactive')
                  AND NOT EXISTS (SELECT 1 FROM public.cases ch WHERE ch.parent_case_id = s.id)
            ) d
            WHERE d.lock_end >= date_trunc('month', now() AT TIME ZONE 'Asia/Singapore')::date
              AND d.lock_end <  (date_trunc('month', now() AT TIME ZONE 'Asia/Singapore') + interval '12 months')::date
            GROUP BY 1
        ) w
    ), '[]'::jsonb)
);
$$;

-- ── 5. search_cases (from 20261202000000): + stage_changed_at, + banker filter ──
DROP FUNCTION IF EXISTS public.search_cases(
    uuid, boolean, text, text, text, uuid, date, date, text, boolean, boolean,
    timestamptz, text[], boolean, date, date, date, date, text, boolean, boolean,
    text, text, int, int, boolean, text
);

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
    p_closed_month       text        DEFAULT NULL,
    p_banker_name        text        DEFAULT NULL,
    p_banker_bank        text        DEFAULT NULL
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
        c.follow_up_remark, c.no_follow_up, c.client_reminder_opt_in, c.stage_changed_at,
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
        -- Track: cases referred to one banker (name + bank).
        AND (p_banker_name IS NULL OR c.referred_bankers @> jsonb_build_array(
            jsonb_build_object('name', p_banker_name, 'bank', COALESCE(p_banker_bank, ''))))
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
    text, text, int, int, boolean, text, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.search_cases(
    uuid, boolean, text, text, text, uuid, date, date, text, boolean, boolean,
    timestamptz, text[], boolean, date, date, date, date, text, boolean, boolean,
    text, text, int, int, boolean, text, text, text
) TO service_role;
