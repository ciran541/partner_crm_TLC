-- Phase C2: server-side earnings.
--
-- Two changes:
--
--  1. search_cases() gains a `bucket` on every row and a p_bucket filter, so the
--     earnings tabs (All / Open / Unpaid / Paid) are a server-side filter rather
--     than a browser-side pass over a downloaded array. Returning the bucket on
--     the row also removes the need for the client to re-derive it — one
--     definition, in one place.
--
--  2. case_commission_by_agent() replaces commissionByAgent() for the admin
--     master table. It must span the whole agent ROSTER, including agents with
--     zero cases (they belong in the table showing a row of zeros), which is why
--     it drives off `profiles` and LEFT JOINs the cases rather than grouping
--     cases and hoping every agent appears.
--
-- The commission arithmetic matches lib/property/commission.ts exactly, with the
-- same two cautions as case_summary(): rounding is PER CASE then summed, and
-- everything stays `numeric` (Postgres rounds numeric half-away-from-zero like
-- JavaScript, but rounds double precision half-to-even).

DROP FUNCTION IF EXISTS public.search_cases(
    uuid, boolean, text, text, text, uuid, date, date, text, boolean, boolean,
    timestamptz, text[], boolean, date, date, date, date, text, text, int, int
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
        -- Mirrors commissionBucket(): NULL for drafts and Closed Lost, which are
        -- excluded from earnings entirely.
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
        AND (
            p_include_drafts
            OR NOT (c.stage = 'Touched Base' AND COALESCE(BTRIM(c.client_name), '') = '')
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
    -- Applied here rather than in `raw` because the bucket is a computed column
    -- and cannot be referenced from that query's own WHERE clause.
    --   'all'  -> every case that HAS a bucket (excludes drafts and Closed Lost)
    --   absent -> no bucket filtering at all
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
    timestamptz, text[], boolean, date, date, date, date, text, text, text, int, int
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.search_cases(
    uuid, boolean, text, text, text, uuid, date, date, text, boolean, boolean,
    timestamptz, text[], boolean, date, date, date, date, text, text, text, int, int
) TO service_role;


-- ─── Per-agent commission, across the full roster ────────────────────────────
--
-- Mirrors commissionByAgent(). The roster filter matches what the admin earnings
-- page already applied to /api/admin/get-profiles: insurance agents who are not
-- disabled. Driving off `profiles` (not `cases`) is what makes an agent with no
-- cases appear as a row of zeros instead of vanishing from the table.
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
        c.stage <> 'Closed Lost'
        AND NOT (c.stage = 'Touched Base' AND COALESCE(BTRIM(c.client_name), '') = '')
),
per_case AS (
    SELECT s.created_by, s.bucket, round(s.gross * 0.90, 2) AS agent_share
    FROM scored s
),
per_agent AS (
    SELECT
        r.id   AS "agentId",
        r.name AS "agentName",
        COALESCE(SUM(pc.agent_share) FILTER (WHERE pc.bucket = 'open'),          0) AS open,
        COALESCE(SUM(pc.agent_share) FILTER (WHERE pc.bucket = 'closed_unpaid'), 0) AS "closedUnpaid",
        COALESCE(SUM(pc.agent_share) FILTER (WHERE pc.bucket = 'closed_paid'),   0) AS "closedPaid",
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

-- Server-only: this reads every agent's earnings, so it must never be callable
-- from a browser. The route in front of it is admin-guarded.
REVOKE ALL ON FUNCTION public.case_commission_by_agent() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.case_commission_by_agent() TO service_role;
