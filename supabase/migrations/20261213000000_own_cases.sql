-- Cases, Track, Lock-ins, Earnings and Dashboard reads for ONE owner's cases.
-- Same idea as the Action Centre (20261212000000): a page at a time, continuing
-- from the last row, totals only with the first page. Read-only: no table,
-- column or rule changes. Admin lists stay on search_cases().

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_cases_owner_stage_updated
    ON public.cases (created_by, stage, (COALESCE(updated_at, 'epoch'::timestamptz)) DESC, id);

-- Client search ("contains"): one index over the three searched fields.
CREATE INDEX IF NOT EXISTS idx_cases_client_search ON public.cases USING gin (
    ((COALESCE(client_name, '') || E'\n' || COALESCE(client_mobile, '') || E'\n' || COALESCE(client_email, ''))) extensions.gin_trgm_ops
);

-- What a list row, a Track card and an Earnings row show. loan_value and bucket
-- are the same rules as search_cases() (caseLoanBase(), commissionBucket()).
CREATE OR REPLACE VIEW public.own_case_cards WITH (security_invoker = true) AS
    SELECT c.id, jsonb_build_object(
        'id', c.id, 'stage', c.stage, 'case_type', c.case_type,
        'client_name', c.client_name, 'client_mobile', c.client_mobile, 'client_email', c.client_email,
        'created_at', c.created_at, 'updated_at', c.updated_at, 'stage_changed_at', c.stage_changed_at,
        'follow_up_date', c.follow_up_date, 'follow_up_remark', c.follow_up_remark,
        'no_follow_up', c.no_follow_up, 'client_reminder_opt_in', c.client_reminder_opt_in,
        'lock_in_end_date', c.lock_in_end_date, 'referred_bankers', c.referred_bankers,
        'current_bank', c.current_bank, 'parent_case_id', c.parent_case_id,
        'correction_fee', c.correction_fee, 'commission_status', c.commission_status,
        'commission_paid_total', COALESCE(c.commission_paid_total, 0),
        'loan_value', CASE
            WHEN c.stage = 'Closed Won' AND COALESCE((c.closed_won_data ->> 'original_loan_total')::numeric, 0) > 0
                THEN (c.closed_won_data ->> 'original_loan_total')::numeric
            WHEN c.case_type IN ('Refinancing', 'Equity Loan') THEN GREATEST(COALESCE(c.existing_loan_amount, 0), 0)
            ELSE GREATEST(COALESCE(c.loan_size, 0), 0) END,
        'bucket', CASE
            WHEN c.stage = 'Touched Base' AND COALESCE(BTRIM(c.client_name), '') = '' THEN NULL
            WHEN c.stage IN ('Closed Lost', 'Inactive') THEN NULL
            WHEN c.stage = 'Closed Won' AND c.commission_status = 'paid' THEN 'closed_paid'
            WHEN c.stage = 'Closed Won' THEN 'closed_unpaid'
            ELSE 'open' END,
        'closed_on', CASE WHEN c.stage = 'Closed Won' THEN public.case_closed_on(c.closed_won_data, c.updated_at) END,
        'payouts', CASE WHEN c.stage = 'Closed Won' THEN (
            SELECT jsonb_agg(jsonb_build_object('amount', cp.amount, 'paid_on', cp.paid_on) ORDER BY cp.paid_on, cp.created_at)
            FROM public.commission_payouts cp WHERE cp.case_id = c.id) END,
        'closed_won_data', jsonb_strip_nulls(jsonb_build_object(
            'closed_at', c.closed_won_data -> 'closed_at',
            'lock_in_end_date', c.closed_won_data -> 'lock_in_end_date',
            'combined_outstanding', c.closed_won_data -> 'combined_outstanding',
            'package', CASE WHEN c.closed_won_data -> 'package' -> 'lockin_years' IS NOT NULL
                THEN jsonb_build_object('lockin_years', c.closed_won_data -> 'package' -> 'lockin_years') END,
            'lo_documents', CASE WHEN jsonb_typeof(c.closed_won_data -> 'lo_documents') = 'array' THEN (
                SELECT jsonb_agg(jsonb_build_object('path', d ->> 'path', 'uploaded_at', d ->> 'uploaded_at'))
                FROM jsonb_array_elements(c.closed_won_data -> 'lo_documents') d) END
        ))
    ) AS card
    FROM public.cases c;
REVOKE ALL ON public.own_case_cards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.own_case_cards TO service_role;

-- One owner's cases. The WHERE is built from the filters actually set, so each
-- combination gets its own plan (values are always bound, never concatenated).
--   p_sort: updated (newest first) | follow_up | lock_in (soonest first) | closed (latest first)
--   p_count_only: skip the loan volume (a screen that doesn't show it)
CREATE OR REPLACE FUNCTION public.own_cases(
    p_owner         uuid,
    p_limit         int     DEFAULT 25,
    p_stage         text    DEFAULT NULL,
    p_sort          text    DEFAULT 'updated',
    p_cursor_key    text    DEFAULT NULL,
    p_cursor_id     uuid    DEFAULT NULL,
    p_search        text    DEFAULT NULL,
    p_from          date    DEFAULT NULL,
    p_to            date    DEFAULT NULL,
    p_month         text    DEFAULT NULL,
    p_closed        text    DEFAULT NULL,
    p_bucket        text    DEFAULT NULL,
    p_follow_up_to  date    DEFAULT NULL,
    p_banker_name   text    DEFAULT NULL,
    p_banker_bank   text    DEFAULT NULL,
    p_lock_in_from  date    DEFAULT NULL,
    p_lock_in_to    date    DEFAULT NULL,
    p_drafts        boolean DEFAULT false,
    p_count_only    boolean DEFAULT false,
    p_follow_up_after date  DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
    w    text := 'c.created_by = $1';
    k    text;       -- sort key
    ktyp text;
    dir  text;
    cmp  text;
    res  jsonb;
    tot  jsonb := '{}'::jsonb;
BEGIN
    CASE p_sort
        WHEN 'follow_up' THEN k := 'COALESCE(c.follow_up_date, ''infinity''::date)'; ktyp := 'date'; dir := 'ASC'; cmp := '>';
        WHEN 'lock_in'   THEN k := 'c.lock_in_end_date'; ktyp := 'date'; dir := 'ASC'; cmp := '>';
        WHEN 'closed'    THEN k := 'COALESCE(case_closed_on(c.closed_won_data, c.updated_at), ''-infinity''::date)'; ktyp := 'date'; dir := 'DESC'; cmp := '<';
        ELSE                  k := 'COALESCE(c.updated_at, ''epoch''::timestamptz)'; ktyp := 'timestamptz'; dir := 'DESC'; cmp := '<';
    END CASE;

    IF p_stage IS NOT NULL THEN w := w || ' AND c.stage = $2'; END IF;
    IF NOT p_drafts THEN
        w := w || ' AND NOT (c.stage = ''Touched Base'' AND COALESCE(BTRIM(c.client_name), '''') = '''')';
    END IF;
    IF p_search IS NOT NULL THEN
        w := w || ' AND (COALESCE(c.client_name, '''') || E''\n'' || COALESCE(c.client_mobile, '''') || E''\n'' || COALESCE(c.client_email, '''')) ILIKE ''%'' || $3 || ''%''';
    END IF;
    IF p_from IS NOT NULL THEN w := w || ' AND c.created_at >= $4::timestamptz'; END IF;
    IF p_to IS NOT NULL THEN w := w || ' AND c.created_at < (($5 + 1)::timestamptz)'; END IF;
    IF p_month IS NOT NULL THEN w := w || ' AND to_char(c.created_at, ''YYYY-MM'') = $6'; END IF;
    IF p_closed IS NOT NULL THEN
        w := w || ' AND c.stage = ''Closed Won'' AND starts_with(to_char(case_closed_on(c.closed_won_data, c.updated_at), ''YYYY-MM''), $7)';
    END IF;
    IF p_bucket = 'closed_paid' THEN w := w || ' AND c.stage = ''Closed Won'' AND c.commission_status = ''paid''';
    ELSIF p_bucket = 'closed_unpaid' THEN w := w || ' AND c.stage = ''Closed Won'' AND c.commission_status IS DISTINCT FROM ''paid''';
    END IF;
    IF p_follow_up_to IS NOT NULL THEN w := w || ' AND c.follow_up_date <= $8'; END IF;
    -- Action Centre's Later search (same order and cursor as action_centre_dated()).
    IF p_follow_up_after IS NOT NULL THEN w := w || ' AND c.follow_up_date > $16'; END IF;
    IF p_banker_name IS NOT NULL THEN
        w := w || ' AND c.referred_bankers @> jsonb_build_array(jsonb_build_object(''name'', $9, ''bank'', COALESCE($10, '''')))';
    END IF;
    -- The lock-in window is the "Upcoming Lock-ins" screen: lost deals are not on it.
    IF p_lock_in_from IS NOT NULL THEN w := w || ' AND c.lock_in_end_date >= $11 AND c.lock_in_end_date <= $12 AND c.stage <> ''Closed Lost'''; END IF;

    IF p_cursor_id IS NULL THEN
        EXECUTE 'SELECT jsonb_build_object(''total'', count(*)'
            || CASE WHEN p_count_only THEN '' ELSE ', ''loan_volume'', COALESCE(SUM(CASE
                WHEN c.stage = ''Closed Won'' AND COALESCE((c.closed_won_data ->> ''original_loan_total'')::numeric, 0) > 0
                    THEN (c.closed_won_data ->> ''original_loan_total'')::numeric
                WHEN c.case_type IN (''Refinancing'', ''Equity Loan'') THEN GREATEST(COALESCE(c.existing_loan_amount, 0), 0)
                ELSE GREATEST(COALESCE(c.loan_size, 0), 0) END), 0)' END
            || ') FROM cases c WHERE ' || w
        INTO tot
        USING p_owner, p_stage, p_search, p_from, p_to, p_month, p_closed, p_follow_up_to, p_banker_name, p_banker_bank, p_lock_in_from, p_lock_in_to,
              p_cursor_key, p_cursor_id, p_limit, p_follow_up_after;
    ELSE
        w := w || format(' AND %1$s %2$s= $13::%3$s AND (%1$s %2$s $13::%3$s OR c.id > $14)', k, cmp, ktyp);
    END IF;

    EXECUTE format('
        SELECT jsonb_build_object(
            ''rows'', COALESCE(jsonb_agg(v.card ORDER BY x.k %2$s, x.id), ''[]''::jsonb),
            ''next_cursor'', CASE WHEN count(*) = $15 THEN (array_agg(x.k::text || ''_'' || x.id ORDER BY x.k %2$s, x.id))[count(*)] END)
        FROM (SELECT c.id, %1$s AS k FROM cases c WHERE %3$s ORDER BY %1$s %2$s, c.id LIMIT $15) x
        JOIN own_case_cards v ON v.id = x.id', k, dir, w)
    INTO res
    USING p_owner, p_stage, p_search, p_from, p_to, p_month, p_closed, p_follow_up_to, p_banker_name, p_banker_bank, p_lock_in_from, p_lock_in_to,
          p_cursor_key, p_cursor_id, p_limit, p_follow_up_after;

    RETURN res || tot;
END;
$$;

-- Track: the four columns (count, volume, first cards) and the banker filter.
CREATE OR REPLACE FUNCTION public.own_track(
    p_owner uuid, p_limit int, p_search text DEFAULT NULL, p_follow_up_to date DEFAULT NULL,
    p_banker_name text DEFAULT NULL, p_banker_bank text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT jsonb_build_object(
        'columns', (
            SELECT jsonb_object_agg(s, own_cases(p_owner, p_limit, s, 'follow_up', p_search => p_search,
                p_follow_up_to => p_follow_up_to, p_banker_name => p_banker_name, p_banker_bank => p_banker_bank))
            FROM unnest(ARRAY['Touched Base', 'Pending Docs', 'Pending Approval', 'Pending Signature']) s),
        'bankers', open_case_bankers(p_owner))
$$;

-- Earnings: everything the page shows, in one call. Money rules are the same as
-- case_summary() / closed_won_by_month(): share = round(round(loan x 0.15%) x 90%) - fee.
--   p_scope: 'YYYY' | 'YYYY-MM' | NULL (every year); p_bucket: NULL | closed_unpaid | closed_paid
CREATE OR REPLACE FUNCTION public.own_earnings(p_owner uuid, p_scope text, p_bucket text, p_limit int)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
WITH raw AS MATERIALIZED (
    SELECT to_char(case_closed_on(c.closed_won_data, c.updated_at), 'YYYY-MM') AS month,
           CASE
               WHEN COALESCE((c.closed_won_data ->> 'original_loan_total')::numeric, 0) > 0
                   THEN (c.closed_won_data ->> 'original_loan_total')::numeric
               WHEN c.case_type IN ('Refinancing', 'Equity Loan') THEN GREATEST(COALESCE(c.existing_loan_amount, 0), 0)
               ELSE GREATEST(COALESCE(c.loan_size, 0), 0)
           END AS loan,
           COALESCE(c.correction_fee, 0) AS fee, COALESCE(c.commission_paid_total, 0) AS paid,
           CASE WHEN c.commission_status = 'paid' THEN 'closed_paid' ELSE 'closed_unpaid' END AS bucket
    FROM cases c WHERE c.created_by = p_owner AND c.stage = 'Closed Won'
), won AS MATERIALIZED (
    SELECT r.*, round(round(r.loan * 0.0015, 2) * 0.90, 2) - r.fee AS share,
           (p_scope IS NULL OR starts_with(r.month, p_scope)) AS in_scope
    FROM raw r
)
SELECT own_cases(p_owner, p_limit, 'Closed Won', 'closed', p_closed => p_scope, p_bucket => p_bucket, p_count_only => true)
|| jsonb_build_object('meta', jsonb_build_object(
    'awaiting',       (SELECT COALESCE(SUM(share - paid), 0) FROM won WHERE bucket = 'closed_unpaid'),
    'awaiting_cases', (SELECT count(*) FROM won WHERE bucket = 'closed_unpaid'),
    'closed_cases',   (SELECT count(*) FROM won),
    'counts', (SELECT jsonb_build_object('all', count(*),
        'closed_unpaid', count(*) FILTER (WHERE bucket = 'closed_unpaid'),
        'closed_paid',   count(*) FILTER (WHERE bucket = 'closed_paid')) FROM won WHERE in_scope),
    'months', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.month) FROM (
        SELECT month, count(*) AS cases, SUM(loan) AS loan_volume, SUM(share) AS agent_share FROM won WHERE month IS NOT NULL GROUP BY month) m), '[]'::jsonb),
    -- Per month of the list on screen (period + tab), however many rows are loaded.
    'groups', COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.month DESC) FROM (
        SELECT month, count(*) AS cases, SUM(share) AS agent_share FROM won
        WHERE in_scope AND (p_bucket IS NULL OR bucket = p_bucket) GROUP BY month) g), '[]'::jsonb)
))
$$;

-- ── Dashboard: same figures, reading only the columns it uses ───────────────
-- (from 20261209000001; the only change is SELECT c.* -> named columns)
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
    SELECT c.id, c.stage, c.updated_at, c.first_activated_at, c.closed_lost_reason, c.lock_in_end_date, c.closed_won_data,
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

DO $$
DECLARE f text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'own_cases(uuid, int, text, text, text, uuid, text, date, date, text, text, text, date, text, text, date, date, boolean, boolean, date)',
        'own_track(uuid, int, text, date, text, text)',
        'own_earnings(uuid, text, text, int)',
        'dashboard_analytics(uuid, boolean, uuid)'
    ] LOOP
        EXECUTE 'REVOKE ALL ON FUNCTION public.' || f || ' FROM PUBLIC, anon, authenticated';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.' || f || ' TO service_role';
    END LOOP;
END $$;
