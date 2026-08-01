-- Phase D: the last screen on the old whole-table store — the Mortgage Planner.
--
-- It needs two things nothing else did:
--
--   p_drafts_only — the planner's "in progress" list is the INVERSE of every
--                   other screen's filter. Everywhere else drafts are noise to
--                   be hidden; here they are the entire point. Expressing it in
--                   SQL rather than over-fetching Touched Base cases and sieving
--                   them in the browser keeps the count and paging honest.
--
--   p_own_only    — the planner shows the signed-in user's OWN drafts. For an
--                   agent that is already true (they see nothing else), but an
--                   admin sees everyone's, and a half-finished planner session
--                   belonging to another agent has no business on your landing
--                   screen. The route sets this from the session, so the caller
--                   never has to know its own user id.
--
-- With this the last consumer of the whole-table store moves across, and
-- lib/insurance/useCases.ts, its 2000-row cap and CaseDataNotice can all go.

DROP FUNCTION IF EXISTS public.search_cases(
    uuid, boolean, text, text, text, uuid, date, date, text, boolean, boolean,
    timestamptz, text[], boolean, date, date, date, date, text, text, text, int, int
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
    p_offset             int         DEFAULT 0
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
        c.referred_bankers, c.closed_won_data, c.commission_status,
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
        -- Mirrors commissionBucket(): NULL for drafts and Closed Lost.
        CASE
            WHEN c.stage = 'Touched Base' AND COALESCE(BTRIM(c.client_name), '') = '' THEN NULL
            WHEN c.stage = 'Closed Lost' THEN NULL
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
                WHEN p_stage = 'active' THEN c.stage NOT IN ('Closed Won', 'Closed Lost')
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
        AND (p_updated_since IS NULL OR c.updated_at > p_updated_since)
        AND (NOT p_has_follow_up OR c.follow_up_date IS NOT NULL)
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
    'loan_volume', (SELECT COALESCE(SUM(loan_value), 0) FROM filtered)
);
$$;

REVOKE ALL ON FUNCTION public.search_cases(
    uuid, boolean, text, text, text, uuid, date, date, text, boolean, boolean,
    timestamptz, text[], boolean, date, date, date, date, text, boolean, boolean,
    text, text, int, int
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.search_cases(
    uuid, boolean, text, text, text, uuid, date, date, text, boolean, boolean,
    timestamptz, text[], boolean, date, date, date, date, text, boolean, boolean,
    text, text, int, int
) TO service_role;
