-- closed_won_by_month: also return 'agent_share' — the agent's commission
-- EARNED per closing month, paid or not. Earnings' "Commission earned"
-- (month / year / all time) reads it. Same signature, CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.closed_won_by_month(
    p_viewer_id uuid,
    p_is_admin  boolean DEFAULT false,
    p_agent     uuid    DEFAULT NULL,
    p_from      text    DEFAULT NULL,   -- 'YYYY-MM' inclusive
    p_to        text    DEFAULT NULL    -- 'YYYY-MM' inclusive
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH closed AS (
    SELECT
        to_char(public.case_closed_on(c.closed_won_data, c.updated_at), 'YYYY-MM') AS month,
        CASE
            WHEN COALESCE((c.closed_won_data ->> 'original_loan_total')::numeric, 0) > 0
                THEN (c.closed_won_data ->> 'original_loan_total')::numeric
            WHEN c.case_type IN ('Refinancing', 'Equity Loan')
                THEN GREATEST(COALESCE(c.existing_loan_amount, 0), 0)
            ELSE GREATEST(COALESCE(c.loan_size, 0), 0)
        END AS loan_value,
        COALESCE(c.correction_fee, 0) AS correction_fee
    FROM public.cases c
    WHERE c.stage = 'Closed Won'
      AND (p_is_admin OR c.created_by = p_viewer_id)
      AND (p_agent IS NULL OR c.created_by = p_agent)
)
SELECT COALESCE(jsonb_agg(jsonb_build_object('month', month, 'cases', n, 'loan_volume', vol, 'agent_share', share) ORDER BY month), '[]'::jsonb)
FROM (
    SELECT month, count(*) AS n, SUM(loan_value) AS vol,
           -- Agent take-home EARNED that month (paid or not), per case like
           -- case_summary(): round(round(loan × 0.15%) × 90%) − correction fee.
           SUM(round(round(loan_value * 0.0015, 2) * 0.90, 2) - correction_fee) AS share
    FROM closed
    WHERE (p_from IS NULL OR month >= p_from) AND (p_to IS NULL OR month <= p_to)
    GROUP BY month
) m;
$$;

REVOKE ALL ON FUNCTION public.closed_won_by_month(uuid, boolean, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.closed_won_by_month(uuid, boolean, uuid, text, text) TO service_role;
