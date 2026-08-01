-- search_cases(): server-side filtering, paging and totals for the case list.
--
-- Replaces the "download the whole table and filter in the browser" model. That
-- model had two failures at scale: the list silently truncated (the project's
-- PostgREST max_rows is 1000, below the app's own cap), and every total on every
-- screen was computed from whatever rows happened to arrive — so revenue and
-- case counts were quietly wrong rather than visibly broken.
--
-- Rows AND totals come back from ONE call on purpose. If the page query and a
-- separate totals query expressed the filters independently they could drift,
-- and you would get a total that disagrees with the list printed underneath it —
-- plausible-looking and very hard to trace. One function, one definition.
--
-- Returns:
--   { "rows": [...], "total": <int>, "loan_volume": <numeric> }
-- where `total` and `loan_volume` cover EVERY matching row, not just the page.

-- loan_value mirrors caseLoanBase() in lib/insurance/commission.ts, which is the
-- agreed definition of a case's loan figure:
--   * Closed Won with a Letter of Offer recorded -> the LO total, because that is
--     the real approved amount (and may sum several loans).
--   * Anything else -> the agent's estimate for the case type.
-- The Cases page previously used its own local variant that ignored the LO
-- figure, so its revenue tile disagreed with Earnings on closed deals. This is
-- now the single definition; `loan_value` is returned on each row so the list
-- column and the total can never diverge again.

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
    p_limit              int         DEFAULT 50,
    p_offset             int         DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH filtered AS (
    SELECT
        c.id, c.created_by, c.stage, c.case_type, c.client_name, c.client_mobile,
        c.client_email, c.loan_size, c.property_type, c.property_price,
        c.current_bank, c.existing_loan_amount, c.lock_in_end_date,
        c.closed_package_details, c.closed_interest_rate, c.closed_tenure,
        c.subsidy_provided, c.clawback_end_date, c.remarks, c.created_at,
        c.updated_at, c.closed_lost_reason, c.closed_lost_notes, c.follow_up_date,
        c.referred_bankers, c.closed_won_data, c.commission_status,
        -- Shaped like the PostgREST embedded join the client already expects.
        jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role) AS profiles,
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
        -- Agents see only their own. Mirrors the cases_select RLS policy, which
        -- this function cannot rely on: it is called with the service-role key,
        -- which bypasses RLS. Scoping therefore has to be explicit here.
        (p_is_admin OR c.created_by = p_viewer_id)
        AND (p_agent IS NULL OR c.created_by = p_agent)
        AND (
            CASE
                WHEN p_stage IS NULL OR p_stage IN ('', 'all') THEN TRUE
                WHEN p_stage = 'active' THEN c.stage NOT IN ('Closed Won', 'Closed Lost')
                ELSE c.stage = p_stage
            END
        )
        AND (p_case_type IS NULL OR p_case_type = '' OR c.case_type = p_case_type)
        -- Planner drafts: no client name yet and still at the first stage.
        -- Mirrors isDraftCase() in lib/insurance/caseFilters.ts. BTRIM handles the
        -- typed-then-cleared case that a plain NULL check would miss.
        AND (
            p_include_drafts
            OR NOT (c.stage = 'Touched Base' AND COALESCE(BTRIM(c.client_name), '') = '')
        )
        AND (
            p_search IS NULL OR BTRIM(p_search) = ''
            OR c.client_name   ILIKE '%' || BTRIM(p_search) || '%'
            OR c.client_mobile ILIKE '%' || BTRIM(p_search) || '%'
            OR c.client_email  ILIKE '%' || BTRIM(p_search) || '%'
            -- Admin case list also searches the agent's name; the agent-facing
            -- list does not, so it stays opt-in rather than a behaviour change.
            OR (p_include_agent_name AND p.name ILIKE '%' || BTRIM(p_search) || '%')
        )
        AND (p_from IS NULL OR c.created_at >= p_from::timestamptz)
        -- Half-open upper bound so the whole of p_to is included without caring
        -- how many hours the day has.
        AND (p_to IS NULL OR c.created_at < ((p_to + 1)::timestamptz))
        AND (p_month IS NULL OR p_month = '' OR to_char(c.created_at, 'YYYY-MM') = p_month)
        AND (p_updated_since IS NULL OR c.updated_at > p_updated_since)
)
SELECT jsonb_build_object(
    'rows', COALESCE((
        SELECT jsonb_agg(to_jsonb(pg) ORDER BY pg.updated_at DESC NULLS LAST, pg.id)
        FROM (
            SELECT *
            FROM filtered
            -- id is a tie-breaker: without a unique second key, rows sharing an
            -- updated_at can come back in a different order per page, which makes
            -- offset paging drop or repeat them.
            ORDER BY updated_at DESC NULLS LAST, id
            LIMIT  GREATEST(COALESCE(p_limit, 50), 0)
            OFFSET GREATEST(COALESCE(p_offset, 0), 0)
        ) pg
    ), '[]'::jsonb),
    'total',       (SELECT count(*) FROM filtered),
    'loan_volume', (SELECT COALESCE(SUM(loan_value), 0) FROM filtered)
);
$$;

-- Server-only. The route authenticates the caller and then passes p_viewer_id /
-- p_is_admin itself; if a browser could call this directly it could simply pass
-- p_is_admin => true and read every case in the company.
REVOKE ALL ON FUNCTION public.search_cases(
    uuid, boolean, text, text, text, uuid, date, date, text, boolean, boolean, timestamptz, int, int
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.search_cases(
    uuid, boolean, text, text, text, uuid, date, date, text, boolean, boolean, timestamptz, int, int
) TO service_role;

-- Note on search performance: the ILIKE '%…%' predicates cannot use a btree
-- index, so search is a sequential scan. At a few thousand rows that is around a
-- millisecond and not worth optimising. If the table reaches six figures, add
-- pg_trgm and a GIN index on client_name/client_mobile/client_email — deferred
-- deliberately rather than taking an extension dependency for no present gain.
