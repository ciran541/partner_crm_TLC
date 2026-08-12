-- Property earnings master table, mirroring case_commission_by_agent() for the
-- insurance side (20260801040000_earnings_functions.sql).
--
-- Same reason it lives in SQL rather than the API route: grouping a downloaded
-- array in JS only ever totals the rows that survived the row cap, which is a
-- silently-wrong money figure. /api/property/cases caps at 100 rows per page,
-- so a JS aggregation there would already be under-reporting.
--
-- Two deliberate differences from the insurance version:
--
--  1. Property commission is STORED (property_cases.agent_commission_amount),
--     not derived from loan size at read time. The commission engine already
--     wrote it at case-save time, so re-deriving it here could disagree with
--     what the agent has already been shown on their own earnings page.
--     lib/property/commission.ts stays the one implementation of the formula.
--
--  2. Buckets are the three real commission_status values (pending/confirmed/
--     paid) rather than insurance's open/closed_unpaid/closed_paid, because
--     property tracks payout state on the case itself.
--
-- Drives off `profiles` and LEFT JOINs, so a property agent with no cases still
-- appears as a row of zeros instead of dropping out of the roster.

CREATE OR REPLACE FUNCTION public.property_commission_by_agent()
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
      AND p.app_type = 'property'
      AND COALESCE(p.status, '') <> 'disabled'
),
scored AS (
    SELECT
        c.agent_id,
        c.commission_status,
        COALESCE(c.agent_commission_amount, 0) AS agent_share
    FROM public.property_cases c
    WHERE c.agent_commission_amount IS NOT NULL
      -- A draft has not been submitted, so its commission is not yet real; the
      -- agent-facing earnings page counts any case carrying an amount, but a
      -- payout table must not imply money is owed on an unsubmitted case.
      AND c.status <> 'draft'
      AND COALESCE(c.is_duplicate, false) = false
),
per_agent AS (
    SELECT
        r.id   AS "agentId",
        r.name AS "agentName",
        COALESCE(SUM(s.agent_share) FILTER (WHERE s.commission_status = 'pending'),   0) AS pending,
        COALESCE(SUM(s.agent_share) FILTER (WHERE s.commission_status = 'confirmed'), 0) AS confirmed,
        COALESCE(SUM(s.agent_share) FILTER (WHERE s.commission_status = 'paid'),      0) AS paid,
        COALESCE(count(s.agent_id),                                                   0) AS "caseCount",
        COALESCE(SUM(s.agent_share),                                                  0) AS total
    FROM roster r
    LEFT JOIN scored s ON s.agent_id = r.id
    GROUP BY r.id, r.name
)
SELECT COALESCE(
    (SELECT jsonb_agg(to_jsonb(pa) ORDER BY pa.total DESC, pa."agentName") FROM per_agent pa),
    '[]'::jsonb
);
$$;

-- Server-only: this reads every agent's earnings, so it must never be callable
-- from a browser. The route in front of it is admin-guarded.
REVOKE ALL ON FUNCTION public.property_commission_by_agent() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.property_commission_by_agent() TO service_role;
