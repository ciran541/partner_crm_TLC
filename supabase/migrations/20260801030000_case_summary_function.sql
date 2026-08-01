-- Phase C1: server-side aggregates for the Analytics and Pipeline dashboards.
--
-- These screens never needed the rows — they needed the NUMBERS. They were
-- downloading up to a thousand cases and adding them up in the browser, which
-- was both slow and wrong: the arithmetic only ever covered whatever rows
-- survived the row cap, so revenue and case counts were quietly understated
-- rather than visibly broken.
--
-- Now the database does the arithmetic over every matching row and returns a
-- few hundred bytes.
--
-- COMMISSION MODEL — mirrors lib/property/commission.ts exactly:
--   gross = round(loan_base * 0.0015, 2)
--   agent = round(gross * 0.90, 2)
--   tlc   = round(gross * 0.10, 2)
--
-- Two details that matter for matching the TypeScript to the cent:
--
--  1. Rounding is PER CASE and then summed — SUM(round(x)), never
--     round(SUM(x)). Rounding the total instead would drift by cents against
--     every figure the app has shown until now.
--
--  2. Every money column on `cases` is `numeric`, and these expressions stay in
--     numeric throughout. That is deliberate: Postgres rounds `numeric` half
--     away from zero (matching JavaScript's Math.round for non-negative values)
--     but rounds `double precision` half to EVEN. A stray ::float cast anywhere
--     in here would silently produce different money.
--
-- BUCKETS — mirrors commissionBucket() in lib/insurance/commission.ts:
--   drafts and 'Closed Lost' have no bucket and are excluded from commission;
--   'Closed Won' splits on commission_status; everything else is 'open'.

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
            WHEN b.stage = 'Closed Lost' THEN NULL
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
        round(s.gross * 0.90, 2) AS agent_share,
        round(s.gross * 0.10, 2) AS tlc_share
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
    GROUP BY c.created_by
    ORDER BY count(*) DESC
    LIMIT 10
)
SELECT jsonb_build_object(
    'total_cases',  (SELECT count(*) FROM comm),
    'active_cases', (SELECT count(*) FROM comm WHERE stage NOT IN ('Closed Won', 'Closed Lost')),
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
    'volume', (SELECT COALESCE(SUM(loan_value), 0) FROM comm),

    'commission', jsonb_build_object(
        'gross',              (SELECT COALESCE(SUM(gross),       0) FROM comm WHERE bucket IS NOT NULL),
        'agent',              (SELECT COALESCE(SUM(agent_share), 0) FROM comm WHERE bucket IS NOT NULL),
        'tlc',                (SELECT COALESCE(SUM(tlc_share),   0) FROM comm WHERE bucket IS NOT NULL),
        'open',               (SELECT COALESCE(SUM(agent_share), 0) FROM comm WHERE bucket = 'open'),
        'closed_unpaid',      (SELECT COALESCE(SUM(agent_share), 0) FROM comm WHERE bucket = 'closed_unpaid'),
        'closed_paid',        (SELECT COALESCE(SUM(agent_share), 0) FROM comm WHERE bucket = 'closed_paid'),
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
            SELECT count(*) FROM comm WHERE to_char(comm.created_at, 'YYYY-MM') = m.month
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

-- Server-only, same reasoning as search_cases(): the route authenticates the
-- caller and passes p_is_admin itself. A browser able to call this directly
-- could pass p_is_admin => true and read company-wide totals.
REVOKE ALL ON FUNCTION public.case_summary(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.case_summary(uuid, boolean, uuid) TO service_role;
