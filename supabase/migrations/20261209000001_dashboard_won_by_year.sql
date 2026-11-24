-- Dashboard lead sources: + won_by_year, so a year's leads can be split into closed
-- that year (blue) and closed in a later year (red). Same signature as 20261209000000.

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
    -- Won leads: the year they were activated x the year they closed.
    'won_by_year', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('year', lead_year, 'closed_year', closed_year, 'source', src, 'cases', n, 'loan_volume', vol))
        FROM (
            SELECT extract(year FROM first_activated_at AT TIME ZONE 'Asia/Singapore')::int AS lead_year,
                   extract(year FROM public.case_closed_on(closed_won_data, updated_at))::int AS closed_year,
                   src, count(*) AS n, SUM(loan_value) AS vol
            FROM scoped WHERE stage = 'Closed Won' AND first_activated_at IS NOT NULL
            GROUP BY 1, 2, 3
        ) v
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
