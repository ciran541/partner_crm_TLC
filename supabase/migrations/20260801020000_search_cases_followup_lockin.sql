-- Phase B: extend search_cases() to serve the follow-up and lock-in screens.
--
-- Those screens are not "the whole list" — each is a small, well-defined subset
-- (cases with a follow-up date; lock-ins expiring within 90 days). Serving them
-- from the same function keeps ONE definition of the shared rules: agent
-- scoping, the draft rule, and loan_value. A second function would be a second
-- place for those to drift.
--
-- New parameters
--   p_exclude_stages  — stages to omit (lock-in screen omits 'Closed Lost')
--   p_has_follow_up   — only cases with a follow-up date set
--   p_follow_up_to    — follow_up_date <= X   (the "overdue" half)
--   p_follow_up_after — follow_up_date >  X   (the "upcoming" half)
--   p_lock_in_from / p_lock_in_to — lock_in_end_date window
--   p_sort / p_dir    — whitelisted ordering, so each screen can order by the
--                       date it actually cares about
--
-- DROP before CREATE is deliberate: adding parameters produces a NEW overload
-- rather than replacing the old one, which would leave two functions resolvable
-- by the same call and a stale GRANT on the previous signature.
DROP FUNCTION IF EXISTS public.search_cases(
    uuid, boolean, text, text, text, uuid, date, date, text, boolean, boolean, timestamptz, int, int
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
    -- Whitelist the sort column. p_sort reaches this from a query string, so it
    -- is never interpolated into SQL — anything unrecognised falls back to the
    -- default rather than erroring.
    SELECT
        CASE
            WHEN p_sort IN ('follow_up_date', 'lock_in_end_date', 'created_at') THEN p_sort
            ELSE 'updated_at'
        END AS sort_col,
        (lower(COALESCE(p_dir, 'desc')) = 'asc') AS asc_dir
),
filtered AS (
    SELECT
        c.id, c.created_by, c.stage, c.case_type, c.client_name, c.client_mobile,
        c.client_email, c.loan_size, c.property_type, c.property_price,
        c.current_bank, c.existing_loan_amount, c.lock_in_end_date,
        c.closed_package_details, c.closed_interest_rate, c.closed_tenure,
        c.subsidy_provided, c.clawback_end_date, c.remarks, c.created_at,
        c.updated_at, c.closed_lost_reason, c.closed_lost_notes, c.follow_up_date,
        c.referred_bankers, c.closed_won_data, c.commission_status,
        jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role) AS profiles,
        -- Mirrors caseLoanBase() in lib/insurance/commission.ts: the Letter of
        -- Offer total for a closed deal (the real approved amount, possibly
        -- several loans), otherwise the agent's estimate for the case type.
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
        AND (p_exclude_stages IS NULL OR NOT (c.stage = ANY (p_exclude_stages)))
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
        -- Follow-up window. The <= / > pair splits overdue from upcoming exactly
        -- as the screens did in the browser, with no row falling in both or
        -- neither. A NULL follow_up_date fails either comparison, so the range
        -- filters already imply "has a follow-up".
        AND (NOT p_has_follow_up OR c.follow_up_date IS NOT NULL)
        AND (p_follow_up_to    IS NULL OR c.follow_up_date <= p_follow_up_to)
        AND (p_follow_up_after IS NULL OR c.follow_up_date >  p_follow_up_after)
        AND (p_lock_in_from IS NULL OR c.lock_in_end_date >= p_lock_in_from)
        AND (p_lock_in_to   IS NULL OR c.lock_in_end_date <= p_lock_in_to)
),
ordered AS (
    -- row_number fixes the order once, so the outer jsonb_agg can reproduce it
    -- exactly. Relying on a subquery's ORDER BY surviving into an aggregate is
    -- not guaranteed.
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
                -- Tie-breaker: without a unique final key, rows sharing a sort
                -- value can come back in a different order per page, which makes
                -- offset paging drop or repeat them.
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

-- Server-only. The route authenticates the caller and then passes p_viewer_id /
-- p_is_admin itself; if a browser could call this directly it could simply pass
-- p_is_admin => true and read every case in the company.
REVOKE ALL ON FUNCTION public.search_cases(
    uuid, boolean, text, text, text, uuid, date, date, text, boolean, boolean,
    timestamptz, text[], boolean, date, date, date, date, text, text, int, int
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.search_cases(
    uuid, boolean, text, text, text, uuid, date, date, text, boolean, boolean,
    timestamptz, text[], boolean, date, date, date, date, text, text, int, int
) TO service_role;

-- Both screens filter on these dates, and neither column was indexed. Partial
-- indexes because the overwhelming majority of rows have neither set — no point
-- indexing the NULLs the queries never look for.
CREATE INDEX IF NOT EXISTS idx_cases_follow_up_date
    ON public.cases (follow_up_date) WHERE follow_up_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cases_lock_in_end_date
    ON public.cases (lock_in_end_date) WHERE lock_in_end_date IS NOT NULL;
