-- IPA (In-Principle Approval): a new pipeline stage + an optional "IPA done" tick.
--
-- 1. Stage "IPA" sits between Pending Docs and Pending Approval. It is a live
--    (open) stage like the other three Pending ones: on Track as its own column,
--    in the Active filter, in potential revenue. Every function below that lists
--    the open stages by name is re-created verbatim from its latest migration
--    with only 'IPA' added (admin_edit_case: 20261204000000; finance_overview,
--    agent_follow_up_health: 20261205000000; open_case_bankers: 20261209000000;
--    own_case_cards, own_track: 20261213000000; own_cases: 20261215000000;
--    follow_up_auto_remark: 20261124000000). Functions that EXCLUDE stages
--    (Closed Won / Closed Lost / Inactive) already treat IPA as open.
-- 2. cases.ipa_done: optional tick on any case, any stage. Shown under the
--    remark on the Cases list; tapping the Remark heading sorts IPA-done first
--    (own_cases p_sort 'remark_asc' / 'remark_desc'). Agents write it from the
--    browser like lead_source; admins via admin_edit_case (minor field).

ALTER TABLE public.cases DROP CONSTRAINT IF EXISTS cases_stage_check;
ALTER TABLE public.cases
    ADD CONSTRAINT cases_stage_check CHECK (stage IN (
        'Inactive',
        'Touched Base',
        'Pending Docs',
        'IPA',
        'Pending Approval',
        'Pending Signature',
        'Closed Won',
        'Closed Lost'
    ));

ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS ipa_done boolean NOT NULL DEFAULT false;

-- ── Default follow-up remark (AUTO_REMARKS in lib/insurance/followUps.ts) ────
CREATE OR REPLACE FUNCTION public.follow_up_auto_remark(p_stage text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_stage
        WHEN 'Touched Base'      THEN 'Engage Prospect'
        WHEN 'Pending Docs'      THEN 'Obtain Documents'
        WHEN 'IPA'               THEN 'Obtain IPA'
        WHEN 'Pending Approval'  THEN 'Check Approval'
        WHEN 'Pending Signature' THEN 'Facilitate Signing'
        WHEN 'Closed Won'        THEN 'Closed Won Previously. To Revisit'
        WHEN 'Closed Lost'       THEN 'Closed Lost Previously. To Revisit'
        ELSE NULL
    END
$$;

-- ── Admin edits a case: IPA is an open stage; ipa_done is a minor field ────
CREATE OR REPLACE FUNCTION public.admin_edit_case(
    p_case uuid, p_actor uuid, p_expected timestamptz, p_changes jsonb, p_reason text, p_fee numeric, p_reopen boolean
)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_minor   text[] := ARRAY['client_name','client_mobile','client_email','lead_source','lead_source_other',
                              'referred_bankers','follow_up_date','follow_up_remark','remarks','ipa_done'];
    v_allowed text[] := v_minor || ARRAY['case_type','stage','loan_size','property_type','property_price','property_address',
                              'current_bank','existing_loan_amount','lock_in_end_date','closed_package_details',
                              'closed_interest_rate','closed_tenure','subsidy_provided','clawback_end_date',
                              'closed_won_data','workflow_data'];
    v_old     public.cases;
    v_new     public.cases;
    v_saved   public.cases;
    v_diff    jsonb := '{}'::jsonb;
    v_o       jsonb;
    v_n       jsonb;
    v_od      jsonb;
    v_nd      jsonb;
    v_key     text;
    v_major   boolean := false;
    v_fee     numeric := round(COALESCE(p_fee, 0), 2);
    v_reason  text := NULLIF(BTRIM(p_reason), '');
    v_entry   jsonb;
BEGIN
    SELECT * INTO v_old FROM cases WHERE id = p_case FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Case not found.' USING ERRCODE = 'P0001'; END IF;
    IF p_expected IS NULL OR v_old.updated_at IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'This case was changed while you were editing. Refresh and try again.' USING ERRCODE = 'P0001';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_changes) LOOP
        IF NOT v_key = ANY (v_allowed) THEN
            RAISE EXCEPTION 'Field % can''t be edited.', v_key USING ERRCODE = 'P0001';
        END IF;
    END LOOP;

    v_new := jsonb_populate_record(v_old, p_changes);
    IF p_reopen THEN v_new.stage := 'Pending Signature'; END IF;

    IF v_new.stage IS DISTINCT FROM v_old.stage THEN
        IF p_reopen THEN
            IF v_old.stage <> 'Closed Won' THEN
                RAISE EXCEPTION 'Only a Closed Won case can be sent back.' USING ERRCODE = 'P0001';
            END IF;
        ELSIF v_old.stage = 'Closed Won' THEN
            RAISE EXCEPTION 'Send a Closed Won case back to the agent instead of changing its stage.' USING ERRCODE = 'P0001';
        ELSIF v_new.stage NOT IN ('Inactive','Touched Base','Pending Docs','IPA','Pending Approval','Pending Signature') THEN
            RAISE EXCEPTION 'The agent closes a case with the closing form.' USING ERRCODE = 'P0001';
        END IF;
    ELSIF p_reopen THEN
        RAISE EXCEPTION 'Only a Closed Won case can be sent back.' USING ERRCODE = 'P0001';
    END IF;
    IF v_fee < 0 OR (v_fee > 0 AND v_old.stage <> 'Closed Won') THEN
        RAISE EXCEPTION 'A correction fee only applies to a Closed Won case.' USING ERRCODE = 'P0001';
    END IF;
    -- A later write must never move the closing month.
    IF v_old.stage = 'Closed Won' THEN
        v_new.closed_won_data := COALESCE(v_new.closed_won_data, '{}'::jsonb)
            || jsonb_build_object('closed_at', public.case_closed_on(v_old.closed_won_data, v_old.updated_at)::text);
    END IF;

    v_o := to_jsonb(v_old);
    v_n := to_jsonb(v_new);
    FOREACH v_key IN ARRAY v_allowed LOOP
        CONTINUE WHEN v_o -> v_key IS NOT DISTINCT FROM v_n -> v_key;
        -- Pinning closed_at on its own isn't an edit.
        CONTINUE WHEN v_key = 'closed_won_data' AND NOT p_changes ? 'closed_won_data';
        IF v_key IN ('workflow_data', 'closed_won_data') THEN
            -- Log only the answers that changed, not the whole document.
            v_od := CASE WHEN jsonb_typeof(v_o -> v_key) = 'object' THEN v_o -> v_key ELSE '{}'::jsonb END - 'closed_at';
            v_nd := CASE WHEN jsonb_typeof(v_n -> v_key) = 'object' THEN v_n -> v_key ELSE '{}'::jsonb END - 'closed_at';
            CONTINUE WHEN v_od = v_nd;
            v_diff := v_diff || (
                SELECT jsonb_object_agg(v_key || '.' || k, jsonb_build_object('from', v_od -> k, 'to', v_nd -> k))
                FROM (SELECT jsonb_object_keys(v_od) AS k UNION SELECT jsonb_object_keys(v_nd)) ks
                WHERE v_od -> k IS DISTINCT FROM v_nd -> k
            );
        ELSE
            v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('from', v_o -> v_key, 'to', v_n -> v_key));
        END IF;
        IF NOT v_key = ANY (v_minor) THEN v_major := true; END IF;
    END LOOP;

    IF v_diff = '{}'::jsonb AND v_fee = 0 AND NOT p_reopen THEN
        RAISE EXCEPTION 'Nothing has changed.' USING ERRCODE = 'P0001';
    END IF;
    IF (v_major OR v_fee > 0 OR p_reopen) AND v_reason IS NULL THEN
        RAISE EXCEPTION 'Give a reason for this change.' USING ERRCODE = 'P0001';
    END IF;
    -- Agent already paid (fully or partly): nothing that moves the payout.
    v_new.correction_fee := COALESCE(v_old.correction_fee, 0) + v_fee;
    IF v_old.commission_paid_total <> 0 AND (
        p_reopen OR case_agent_owed(v_new) IS DISTINCT FROM case_agent_owed(v_old)
    ) THEN
        RAISE EXCEPTION 'This case has been paid, fully or partly. Reverse the payout before changing anything that affects it.' USING ERRCODE = 'P0001';
    END IF;

    v_entry := jsonb_build_object('at', now(), 'by', p_actor, 'reason', COALESCE(v_reason, ''), 'fee', v_fee,
        'mode', CASE WHEN p_reopen THEN 'reopen' ELSE 'record' END, 'from_stage', v_old.stage);
    IF v_old.stage = 'Closed Won' AND (v_major OR v_fee > 0 OR p_reopen) THEN
        v_new.corrections := COALESCE(v_old.corrections, '[]'::jsonb) || jsonb_build_array(v_entry);
    END IF;

    -- Follow-up history records who made the change (it reads auth.uid()).
    PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
    UPDATE cases SET
        client_name = v_new.client_name, client_mobile = v_new.client_mobile, client_email = v_new.client_email,
        lead_source = v_new.lead_source, lead_source_other = v_new.lead_source_other,
        referred_bankers = v_new.referred_bankers, follow_up_date = v_new.follow_up_date,
        follow_up_remark = v_new.follow_up_remark, remarks = v_new.remarks,
        case_type = v_new.case_type, stage = v_new.stage, loan_size = v_new.loan_size,
        property_type = v_new.property_type, property_price = v_new.property_price, property_address = v_new.property_address,
        current_bank = v_new.current_bank, existing_loan_amount = v_new.existing_loan_amount,
        lock_in_end_date = v_new.lock_in_end_date, closed_package_details = v_new.closed_package_details,
        closed_interest_rate = v_new.closed_interest_rate, closed_tenure = v_new.closed_tenure,
        subsidy_provided = v_new.subsidy_provided, clawback_end_date = v_new.clawback_end_date,
        closed_won_data = v_new.closed_won_data, workflow_data = v_new.workflow_data,
        correction_fee = v_new.correction_fee, corrections = v_new.corrections
    WHERE id = p_case RETURNING * INTO v_saved;

    INSERT INTO insurance_case_activity_logs (case_id, actor_id, action, old_value, new_value)
    VALUES (p_case, p_actor, 'admin_edit', NULL, v_entry || jsonb_build_object('changes', v_diff));
    RETURN to_jsonb(v_saved);
END;
$$;

-- ── Finance: pipeline by open stage; follow-up health open count ──────────
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
        WHERE c.stage IN ('Touched Base','Pending Docs','IPA','Pending Approval','Pending Signature')
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
        count(c.id) FILTER (WHERE c.stage IN ('Touched Base','Pending Docs','IPA','Pending Approval','Pending Signature')) AS open_cases,
        min(c.follow_up_date) FILTER (WHERE c.follow_up_date < sgt.today) AS oldest
    FROM profiles p CROSS JOIN sgt
    LEFT JOIN cases c ON c.created_by = p.id AND NOT (c.stage = 'Touched Base' AND COALESCE(BTRIM(c.client_name), '') = '')
    WHERE p.role = 'agent' AND p.app_type = 'insurance'
    GROUP BY p.id, p.name, p.status
)
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.overdue + x.missing DESC, x.name), '[]'::jsonb) FROM x
$$;

-- ── Track's banker filter ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.open_case_bankers(p_viewer_id uuid, p_is_admin boolean DEFAULT false, p_agent uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'bank', bank, 'cases', n) ORDER BY bank, name), '[]'::jsonb)
    FROM (
        SELECT b ->> 'name' AS name, b ->> 'bank' AS bank, count(DISTINCT c.id) AS n
        FROM public.cases c
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(c.referred_bankers) = 'array' THEN c.referred_bankers ELSE '[]'::jsonb END) b
        WHERE c.stage IN ('Touched Base', 'Pending Docs', 'IPA', 'Pending Approval', 'Pending Signature')
          AND (p_is_admin OR c.created_by = p_viewer_id)
          AND (p_agent IS NULL OR c.created_by = p_agent)
          AND COALESCE(b ->> 'name', '') <> ''
        GROUP BY 1, 2
    ) x
$$;

-- ── List row / Track card: + ipa_done ───────────────────────────────────
CREATE OR REPLACE VIEW public.own_case_cards WITH (security_invoker = true) AS
    SELECT c.id, jsonb_build_object(
        'id', c.id, 'stage', c.stage, 'case_type', c.case_type,
        'client_name', c.client_name, 'client_mobile', c.client_mobile, 'client_email', c.client_email,
        'created_at', c.created_at, 'updated_at', c.updated_at, 'stage_changed_at', c.stage_changed_at,
        'follow_up_date', c.follow_up_date, 'follow_up_remark', c.follow_up_remark, 'ipa_done', c.ipa_done,
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

-- ── Track: five columns ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.own_track(
    p_owner uuid, p_limit int, p_search text DEFAULT NULL, p_follow_up_to date DEFAULT NULL,
    p_banker_name text DEFAULT NULL, p_banker_bank text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT jsonb_build_object(
        'columns', (
            SELECT jsonb_object_agg(s, own_cases(p_owner, p_limit, s, 'follow_up', p_search => p_search,
                p_follow_up_to => p_follow_up_to, p_banker_name => p_banker_name, p_banker_bank => p_banker_bank))
            FROM unnest(ARRAY['Touched Base', 'Pending Docs', 'IPA', 'Pending Approval', 'Pending Signature']) s),
        'bankers', open_case_bankers(p_owner))
$$;

-- ── Cases list: + sort by Remark (IPA done first / last) ─────────────────
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
    fu   text;       -- tie-break inside a Type / Banker group
    loan text := $k$CASE
        WHEN c.stage = 'Closed Won' AND COALESCE((c.closed_won_data ->> 'original_loan_total')::numeric, 0) > 0
            THEN (c.closed_won_data ->> 'original_loan_total')::numeric
        WHEN c.case_type IN ('Refinancing', 'Equity Loan') THEN GREATEST(COALESCE(c.existing_loan_amount, 0), 0)
        ELSE GREATEST(COALESCE(c.loan_size, 0), 0) END$k$;
    cmp  text;
    res  jsonb;
    tot  jsonb := '{}'::jsonb;
BEGIN
    -- Days since 2000 (undated = year 9999), so the soonest follow-up comes first either way.
    fu := $k$GREATEST(COALESCE(c.follow_up_date, '9999-12-31'::date) - '2000-01-01'::date, 0)$k$;
    IF right(p_sort, 5) = '_desc' THEN fu := '3000000 - ' || fu; END IF;
    fu := $k$ || '.' || lpad(($k$ || fu || $k$)::text, 8, '0')) COLLATE "C"$k$;

    CASE p_sort
        WHEN 'follow_up' THEN k := 'COALESCE(c.follow_up_date, ''infinity''::date)'; ktyp := 'date'; dir := 'ASC'; cmp := '>';
        WHEN 'lock_in'   THEN k := 'c.lock_in_end_date'; ktyp := 'date'; dir := 'ASC'; cmp := '>';
        WHEN 'closed'    THEN k := 'COALESCE(case_closed_on(c.closed_won_data, c.updated_at), ''-infinity''::date)'; ktyp := 'date'; dir := 'DESC'; cmp := '<';
        -- Column headings. Blank values come last in both directions. Text is hex
        -- encoded: same order, and nothing readable or unsafe in the cursor.
        WHEN 'type_asc', 'type_desc' THEN
            k := $k$('1' || encode(convert_to(lower(c.case_type), 'UTF8'), 'hex')$k$ || fu;
            ktyp := 'text';
        WHEN 'banker_asc', 'banker_desc' THEN
            -- The first banker on the case, by name then bank.
            k := $k$(CASE WHEN COALESCE(BTRIM(c.referred_bankers -> 0 ->> 'name'), '') = '' THEN $k$
                || CASE WHEN p_sort = 'banker_asc' THEN $k$'2'$k$ ELSE $k$'0'$k$ END
                || $k$ ELSE '1' || encode(convert_to(lower(BTRIM(c.referred_bankers -> 0 ->> 'name')) || chr(9)
                    || lower(COALESCE(c.referred_bankers -> 0 ->> 'bank', '')), 'UTF8'), 'hex') END$k$ || fu;
            ktyp := 'text';
        WHEN 'loan_asc'    THEN k := 'COALESCE(NULLIF(' || loan || ', 0), 999999999999999)'; ktyp := 'numeric';
        WHEN 'loan_desc'   THEN k := '(' || loan || ')'; ktyp := 'numeric';
        WHEN 'input_asc', 'input_desc' THEN k := 'COALESCE(c.created_at, ''epoch''::timestamptz)'; ktyp := 'timestamptz';
        WHEN 'due_asc'     THEN k := 'COALESCE(c.follow_up_date, ''infinity''::date)'; ktyp := 'date';
        WHEN 'due_desc'    THEN k := 'COALESCE(c.follow_up_date, ''-infinity''::date)'; ktyp := 'date';
        WHEN 'closed_asc'  THEN k := 'COALESCE(case_closed_on(c.closed_won_data, c.updated_at), ''infinity''::date)'; ktyp := 'date';
        WHEN 'closed_desc' THEN k := 'COALESCE(case_closed_on(c.closed_won_data, c.updated_at), ''-infinity''::date)'; ktyp := 'date';
        -- Remark heading: IPA done first (asc) or last (desc); soonest follow-up
        -- first inside each group either way. Key '0.<days>' / '1.<days>'.
        WHEN 'remark_asc', 'remark_desc' THEN
            k := '(CASE WHEN c.ipa_done THEN ' || CASE WHEN p_sort = 'remark_asc' THEN '''0''' ELSE '''1''' END
                || ' ELSE ' || CASE WHEN p_sort = 'remark_asc' THEN '''1''' ELSE '''0''' END
                || $k$ END || '.' || lpad(GREATEST(COALESCE(c.follow_up_date, '9999-12-31'::date) - '2000-01-01'::date, 0)::text, 8, '0')) COLLATE "C"$k$;
            ktyp := 'text'; dir := 'ASC'; cmp := '>';
        ELSE                  k := 'COALESCE(c.updated_at, ''epoch''::timestamptz)'; ktyp := 'timestamptz'; dir := 'DESC'; cmp := '<';
    END CASE;
    IF dir IS NULL THEN
        dir := CASE WHEN right(p_sort, 5) = '_desc' THEN 'DESC' ELSE 'ASC' END;
        cmp := CASE WHEN dir = 'DESC' THEN '<' ELSE '>' END;
    END IF;

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
            || CASE WHEN p_count_only THEN '' ELSE ', ''loan_volume'', COALESCE(SUM(' || loan || '), 0)' END
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
