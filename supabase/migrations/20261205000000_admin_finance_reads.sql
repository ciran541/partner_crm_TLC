-- Admin finance desk, part 2: reads behind TLC Dashboard, Payouts, Home, the
-- Action Centre overview and the combined Audit Log. Service role only.

-- One row per Closed Won case. Everything financial derives from it.
CREATE OR REPLACE FUNCTION public.finance_cases()
RETURNS TABLE (
    id uuid, agent_id uuid, agent_name text, client_name text, case_type text, source text, bank text,
    closed_on date, loan numeric, gross numeric, agent_share numeric, tlc_share numeric, fee numeric,
    paid numeric, received numeric, tracked boolean, has_lo boolean, lockin_years numeric,
    next_outstanding numeric, revisited boolean
)
LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT c.id, c.created_by, COALESCE(NULLIF(BTRIM(p.name), ''), 'Unnamed agent'), c.client_name, c.case_type,
        COALESCE(c.lead_source, 'not_set'), COALESCE(NULLIF(BTRIM(c.closed_won_data ->> 'bank'), ''), 'Not set'),
        case_closed_on(c.closed_won_data, c.updated_at),
        case_loan_value(c), case_gross(c), case_agent_owed(c),
        -- Agent + TLC always equals gross; a correction fee moves to TLC.
        case_gross(c) - case_agent_owed(c), COALESCE(c.correction_fee, 0), c.commission_paid_total,
        COALESCE(r.total, 0), (u.case_id IS NULL OR r.total IS NOT NULL),
        COALESCE(jsonb_typeof(c.closed_won_data -> 'lo_documents') = 'array' AND c.closed_won_data -> 'lo_documents' <> '[]'::jsonb, false),
        CASE WHEN COALESCE(c.closed_won_data -> 'package' ->> 'lockin_years', '') ~ '^\d+(\.\d+)?$' THEN (c.closed_won_data -> 'package' ->> 'lockin_years')::numeric END,
        CASE WHEN COALESCE(c.closed_won_data ->> 'combined_outstanding', '') ~ '^\d+(\.\d+)?$' THEN (c.closed_won_data ->> 'combined_outstanding')::numeric END,
        EXISTS (SELECT 1 FROM cases ch WHERE ch.parent_case_id = c.id)
    FROM cases c
    LEFT JOIN profiles p ON p.id = c.created_by
    LEFT JOIN (SELECT case_id, SUM(amount) AS total FROM bank_receipts GROUP BY case_id) r ON r.case_id = c.id
    LEFT JOIN bank_receipt_untracked u ON u.case_id = c.id
    WHERE c.stage = 'Closed Won'
$$;

-- Cases with money still to move: agent unpaid (or overpaid), or the bank's
-- total not matching 0.15%. Oldest closing first.
CREATE OR REPLACE FUNCTION public.finance_queue()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.closed_on, f.id), '[]'::jsonb)
    FROM finance_cases() f
    WHERE abs(f.agent_share - f.paid) > 0.005 OR (f.tracked AND abs(f.gross - f.received) > 0.005)
$$;

-- Aggregates only (no client names). The page filters by year and agent; all
-- the maths is in lib/insurance/financeStats.ts.
CREATE OR REPLACE FUNCTION public.finance_overview()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
WITH f AS (SELECT * FROM finance_cases()),
sgt AS (SELECT (now() AT TIME ZONE 'Asia/Singapore')::date AS today)
SELECT jsonb_build_object(
    'agents', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', COALESCE(NULLIF(BTRIM(p.name), ''), 'Unnamed agent')) ORDER BY p.name)
        FROM profiles p WHERE (p.role = 'agent' AND p.app_type = 'insurance') OR EXISTS (SELECT 1 FROM f WHERE f.agent_id = p.id)), '[]'::jsonb),
    'closed', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT to_char(closed_on, 'YYYY-MM') AS month, agent_id AS agent, bank, source, case_type AS type,
               count(*) AS cases, SUM(loan) AS volume, SUM(gross) AS gross, SUM(agent_share) AS agent_share, SUM(tlc_share) AS tlc, SUM(fee) AS fees
        FROM f GROUP BY 1, 2, 3, 4, 5) x), '[]'::jsonb),
    'payouts', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT to_char(cp.paid_on, 'YYYY-MM') AS month, c.created_by AS agent,
               (u.case_id IS NULL OR EXISTS (SELECT 1 FROM bank_receipts br WHERE br.case_id = c.id)) AS tracked, SUM(cp.amount) AS amount
        FROM commission_payouts cp JOIN cases c ON c.id = cp.case_id
        LEFT JOIN bank_receipt_untracked u ON u.case_id = c.id GROUP BY 1, 2, 3) x), '[]'::jsonb),
    'receipts', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT to_char(br.received_on, 'YYYY-MM') AS month, c.created_by AS agent, COALESCE(br.bank, 'Not set') AS bank, SUM(br.amount) AS amount
        FROM bank_receipts br JOIN cases c ON c.id = br.case_id GROUP BY 1, 2, 3) x), '[]'::jsonb),
    'agent_owed', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT agent_id AS agent, count(*) AS cases, SUM(agent_share - paid) AS amount,
            COALESCE(SUM(agent_share - paid) FILTER (WHERE sgt.today - closed_on <= 30), 0) AS d30,
            COALESCE(SUM(agent_share - paid) FILTER (WHERE sgt.today - closed_on BETWEEN 31 AND 60), 0) AS d60,
            COALESCE(SUM(agent_share - paid) FILTER (WHERE sgt.today - closed_on > 60), 0) AS older
        FROM f CROSS JOIN sgt WHERE agent_share - paid > 0.005 GROUP BY 1) x), '[]'::jsonb),
    'bank_owed', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT agent_id AS agent, bank, count(*) AS cases, SUM(gross - received) AS amount,
            COALESCE(SUM(gross - received) FILTER (WHERE sgt.today - closed_on <= 30), 0) AS d30,
            COALESCE(SUM(gross - received) FILTER (WHERE sgt.today - closed_on BETWEEN 31 AND 60), 0) AS d60,
            COALESCE(SUM(gross - received) FILTER (WHERE sgt.today - closed_on > 60), 0) AS older
        FROM f CROSS JOIN sgt WHERE tracked AND gross - received > 0.005 GROUP BY 1, 2) x), '[]'::jsonb),
    'pipeline', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT c.stage, c.created_by AS agent, count(*) AS cases, SUM(case_loan_value(c)) AS volume,
               SUM(case_gross(c) - round(case_gross(c) * 0.90, 2)) AS tlc
        FROM cases c
        WHERE c.stage IN ('Touched Base','Pending Docs','Pending Approval','Pending Signature')
          AND NOT (c.stage = 'Touched Base' AND COALESCE(BTRIM(c.client_name), '') = '')
        GROUP BY 1, 2) x), '[]'::jsonb),
    'leads', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT to_char(c.first_activated_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM') AS month, c.created_by AS agent, count(*) AS activated,
               count(*) FILTER (WHERE c.stage = 'Closed Won') AS won, count(*) FILTER (WHERE c.stage = 'Closed Lost') AS lost
        FROM cases c WHERE c.first_activated_at IS NOT NULL GROUP BY 1, 2) x), '[]'::jsonb),
    'refi', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT to_char(closed_on + make_interval(months => round(lockin_years * 12)::int), 'YYYY-MM') AS month, agent_id AS agent,
               count(*) AS cases, SUM(next_outstanding) AS volume,
               SUM(round(next_outstanding * 0.0015, 2) - round(round(next_outstanding * 0.0015, 2) * 0.90, 2)) AS tlc
        FROM f WHERE lockin_years > 0 AND next_outstanding > 0 AND NOT revisited GROUP BY 1, 2) x), '[]'::jsonb)
)
$$;

-- Follow-up health per Premium agent (Home, Action Centre, agent page). SGT days.
CREATE OR REPLACE FUNCTION public.agent_follow_up_health()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
WITH sgt AS (SELECT (now() AT TIME ZONE 'Asia/Singapore')::date AS today),
x AS (
    SELECT p.id AS agent, COALESCE(NULLIF(BTRIM(p.name), ''), 'Unnamed agent') AS name, p.status,
        count(c.id) FILTER (WHERE c.follow_up_date < sgt.today) AS overdue,
        count(c.id) FILTER (WHERE c.follow_up_date = sgt.today) AS today,
        count(c.id) FILTER (WHERE c.follow_up_date > sgt.today AND c.follow_up_date <= sgt.today + 14) AS soon,
        count(c.id) FILTER (WHERE c.follow_up_date IS NULL AND NOT (c.no_follow_up AND c.stage = 'Closed Lost')
            AND NOT EXISTS (SELECT 1 FROM cases ch WHERE ch.parent_case_id = c.id)) AS missing,
        count(c.id) FILTER (WHERE c.stage IN ('Touched Base','Pending Docs','Pending Approval','Pending Signature')) AS open_cases,
        min(c.follow_up_date) FILTER (WHERE c.follow_up_date < sgt.today) AS oldest
    FROM profiles p CROSS JOIN sgt
    LEFT JOIN cases c ON c.created_by = p.id AND NOT (c.stage = 'Touched Base' AND COALESCE(BTRIM(c.client_name), '') = '')
    WHERE p.role = 'agent' AND p.app_type = 'insurance'
    GROUP BY p.id, p.name, p.status
)
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.overdue + x.missing DESC, x.name), '[]'::jsonb) FROM x
$$;

-- Everything admins did, newest first (Audit Log).
CREATE OR REPLACE FUNCTION public.admin_activity(
    p_kind text DEFAULT NULL, p_actor uuid DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL,
    p_limit int DEFAULT 50, p_offset int DEFAULT 0
)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
WITH feed AS (
    SELECT a.id, a.created_at, a.actor_id, 'user'::text AS kind, a.action, NULL::uuid AS case_id,
           t.name AS subject, NULL::numeric AS amount, a.details
    FROM admin_audit_log a LEFT JOIN profiles t ON t.id = a.target_id
    UNION ALL
    SELECT l.id, l.created_at, l.actor_id, 'case', l.action, l.case_id, c.client_name, NULL,
           jsonb_build_object('from', l.old_value, 'to', l.new_value)
    FROM insurance_case_activity_logs l LEFT JOIN cases c ON c.id = l.case_id
    UNION ALL
    SELECT p.id, p.created_at, p.recorded_by, 'payout', CASE WHEN p.amount < 0 THEN 'payout_reversed' ELSE 'payout_recorded' END,
           p.case_id, c.client_name, p.amount,
           jsonb_build_object('paid_on', p.paid_on, 'reference', p.reference, 'batch', p.batch_id)
    FROM commission_payouts p LEFT JOIN cases c ON c.id = p.case_id
    UNION ALL
    SELECT b.id, b.created_at, b.recorded_by, 'bank', 'bank_' || b.kind, b.case_id, c.client_name, b.amount,
           jsonb_build_object('received_on', b.received_on, 'bank', b.bank)
    FROM bank_receipts b LEFT JOIN cases c ON c.id = b.case_id
),
hit AS (
    SELECT feed.*, COALESCE(p.name, 'System') AS actor_name FROM feed LEFT JOIN profiles p ON p.id = feed.actor_id
    WHERE (p_kind IS NULL OR feed.kind = p_kind)
      AND (p_actor IS NULL OR feed.actor_id = p_actor)
      AND (p_from IS NULL OR (feed.created_at AT TIME ZONE 'Asia/Singapore')::date >= p_from)
      AND (p_to IS NULL OR (feed.created_at AT TIME ZONE 'Asia/Singapore')::date <= p_to)
)
SELECT jsonb_build_object('total', (SELECT count(*) FROM hit), 'rows', COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC, x.id)
    FROM (SELECT * FROM hit ORDER BY created_at DESC, id LIMIT LEAST(p_limit, 100) OFFSET GREATEST(p_offset, 0)) x
), '[]'::jsonb))
$$;

DO $$
DECLARE f text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'finance_cases()', 'finance_queue()', 'finance_overview()', 'agent_follow_up_health()',
        'admin_activity(text, uuid, date, date, int, int)'
    ] LOOP
        EXECUTE 'REVOKE ALL ON FUNCTION public.' || f || ' FROM PUBLIC, anon, authenticated';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.' || f || ' TO service_role';
    END LOOP;
END $$;
