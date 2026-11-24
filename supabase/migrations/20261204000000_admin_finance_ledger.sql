-- Admin finance desk, part 1 (agreed 2026-11-23): bank receipts, batch payouts
-- and audited admin edits. Reads for the screens are in 20261205000000.
--
--   payout_batches / commission_payouts.batch_id   one payment covering many cases
--   bank_transfers / bank_receipts                 money TLC received from banks
--   bank_receipt_untracked                         cases already paid to agents before
--                                                  bank receipts existed ("Before tracking")
--   record_commission_payouts()  all-or-nothing, locks each case so two admins
--   record_bank_receipts()       can't pay / receipt the same money twice
--   admin_edit_case()            the only way an admin changes a case: whitelisted
--                                fields, reason, fee and log in one transaction
--
-- All functions are service-role only; the routes in front are admin-guarded.

-- ── 1. Tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payout_batches (
    id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    paid_on     date NOT NULL,
    reference   text,
    note        text,
    recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.commission_payouts
    ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.payout_batches(id);
CREATE INDEX IF NOT EXISTS commission_payouts_batch_idx ON public.commission_payouts (batch_id);

CREATE TABLE IF NOT EXISTS public.bank_transfers (
    id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    received_on date NOT NULL,
    reference   text,
    note        text,
    recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.bank_receipts (
    id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    case_id     uuid NOT NULL REFERENCES public.cases(id) ON DELETE RESTRICT,
    transfer_id uuid NOT NULL REFERENCES public.bank_transfers(id),
    kind        text NOT NULL CHECK (kind IN ('receipt', 'clawback', 'reversal')),
    amount      numeric(12, 2) NOT NULL CHECK (amount <> 0),
    bank        text,
    received_on date NOT NULL,
    reverses    uuid REFERENCES public.bank_receipts(id),
    recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_receipts_case_idx ON public.bank_receipts (case_id, received_on);
CREATE UNIQUE INDEX IF NOT EXISTS bank_receipts_reverses_key ON public.bank_receipts (reverses) WHERE reverses IS NOT NULL;

-- Filled once, here: we can't know what banks paid for cases settled earlier.
CREATE TABLE IF NOT EXISTS public.bank_receipt_untracked (
    case_id uuid NOT NULL PRIMARY KEY REFERENCES public.cases(id) ON DELETE CASCADE
);
INSERT INTO public.bank_receipt_untracked (case_id)
SELECT id FROM public.cases WHERE commission_paid_total > 0
ON CONFLICT DO NOTHING;

-- RLS on with no client policies: server routes only.
ALTER TABLE public.payout_batches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transfers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_receipts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_receipt_untracked ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payout_batches, public.bank_transfers, public.bank_receipts, public.bank_receipt_untracked FROM anon, authenticated;
GRANT SELECT, INSERT ON public.payout_batches, public.bank_transfers, public.bank_receipts TO service_role;
GRANT SELECT ON public.bank_receipt_untracked TO service_role;

-- Permanent records, same rule as commission_payouts.
CREATE OR REPLACE FUNCTION public.ledger_rows_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF current_user IN ('postgres', 'supabase_admin') THEN
        RETURN COALESCE(NEW, OLD);   -- migrations / emergency SQL only
    END IF;
    RAISE EXCEPTION 'Payment records are permanent. Record a reversal instead.' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS bank_receipts_immutable ON public.bank_receipts;
CREATE TRIGGER bank_receipts_immutable BEFORE UPDATE OR DELETE ON public.bank_receipts
    FOR EACH ROW EXECUTE FUNCTION public.ledger_rows_immutable();
DROP TRIGGER IF EXISTS bank_transfers_immutable ON public.bank_transfers;
CREATE TRIGGER bank_transfers_immutable BEFORE UPDATE OR DELETE ON public.bank_transfers
    FOR EACH ROW EXECUTE FUNCTION public.ledger_rows_immutable();
DROP TRIGGER IF EXISTS payout_batches_immutable ON public.payout_batches;
CREATE TRIGGER payout_batches_immutable BEFORE UPDATE OR DELETE ON public.payout_batches
    FOR EACH ROW EXECUTE FUNCTION public.ledger_rows_immutable();

-- ── 2. Shared money helpers (mirror lib/insurance/commission.ts) ────────────

CREATE OR REPLACE FUNCTION public.case_loan_value(c public.cases)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT CASE
        WHEN c.stage = 'Closed Won' AND COALESCE((c.closed_won_data ->> 'original_loan_total')::numeric, 0) > 0
            THEN (c.closed_won_data ->> 'original_loan_total')::numeric
        WHEN c.case_type IN ('Refinancing', 'Equity Loan') THEN GREATEST(COALESCE(c.existing_loan_amount, 0), 0)
        ELSE GREATEST(COALESCE(c.loan_size, 0), 0)
    END
$$;
CREATE OR REPLACE FUNCTION public.case_gross(c public.cases)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT round(public.case_loan_value(c) * 0.0015, 2)
$$;
CREATE OR REPLACE FUNCTION public.case_agent_owed(c public.cases)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT round(public.case_gross(c) * 0.90, 2) - COALESCE(c.correction_fee, 0)
$$;

-- Older closings have no closed_at, so their closing month falls back to
-- updated_at, which any later write moves. Pin it before touching the case.
CREATE OR REPLACE FUNCTION public.pin_case_closed_on(p_case uuid)
RETURNS void LANGUAGE sql SET search_path = public AS $$
    UPDATE public.cases
    SET closed_won_data = closed_won_data || jsonb_build_object('closed_at', public.case_closed_on(closed_won_data, updated_at)::text)
    WHERE id = p_case AND stage = 'Closed Won'
      AND COALESCE(closed_won_data ->> 'closed_at', '') !~ '^\d{4}-\d{2}-\d{2}'
$$;

-- ── 3. Payouts to agents ────────────────────────────────────────────────────
-- p_items: [{case_id, amount}]. Batch mode pays each case's full outstanding and
-- refuses if it moved since the admin confirmed it.
CREATE OR REPLACE FUNCTION public.record_commission_payouts(
    p_items jsonb, p_paid_on date, p_reference text, p_note text, p_actor uuid, p_batch boolean
)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_item  record;
    v_case  public.cases;
    v_out   numeric;
    v_batch uuid;
    v_total numeric := 0;
    v_n     int := 0;
BEGIN
    IF p_batch THEN
        INSERT INTO payout_batches (paid_on, reference, note, recorded_by)
        VALUES (p_paid_on, p_reference, p_note, p_actor) RETURNING id INTO v_batch;
    END IF;
    -- Fixed order so two overlapping batches can't deadlock.
    FOR v_item IN
        SELECT (e ->> 'case_id')::uuid AS case_id, round((e ->> 'amount')::numeric, 2) AS amount
        FROM jsonb_array_elements(p_items) e ORDER BY 1
    LOOP
        PERFORM 1 FROM cases WHERE id = v_item.case_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Case not found.' USING ERRCODE = 'P0001'; END IF;
        PERFORM pin_case_closed_on(v_item.case_id);
        SELECT * INTO v_case FROM cases WHERE id = v_item.case_id;
        IF v_case.stage <> 'Closed Won' THEN
            RAISE EXCEPTION '% is no longer Closed Won.', COALESCE(v_case.client_name, 'A case') USING ERRCODE = 'P0001';
        END IF;
        v_out := case_agent_owed(v_case) - v_case.commission_paid_total;
        IF v_out <= 0.005 THEN
            RAISE EXCEPTION 'Nothing is outstanding on %.', COALESCE(v_case.client_name, 'this case') USING ERRCODE = 'P0001';
        END IF;
        IF v_item.amount IS NULL OR v_item.amount <= 0 OR v_item.amount > v_out + 0.005 THEN
            RAISE EXCEPTION 'The amount for % must be above zero and no more than the $% outstanding.', COALESCE(v_case.client_name, 'this case'), round(v_out, 2) USING ERRCODE = 'P0001';
        END IF;
        IF p_batch AND abs(v_item.amount - v_out) > 0.005 THEN
            RAISE EXCEPTION 'The amount for % has changed. Refresh and check it again.', COALESCE(v_case.client_name, 'a case') USING ERRCODE = 'P0001';
        END IF;
        INSERT INTO commission_payouts (case_id, amount, paid_on, reference, note, recorded_by, batch_id)
        VALUES (v_case.id, v_item.amount, p_paid_on, p_reference, p_note, p_actor, v_batch);
        v_total := v_total + v_item.amount;
        v_n := v_n + 1;
    END LOOP;
    IF v_n = 0 THEN RAISE EXCEPTION 'Choose at least one case.' USING ERRCODE = 'P0001'; END IF;
    RETURN jsonb_build_object('batch_id', v_batch, 'cases', v_n, 'total', v_total);
END;
$$;

-- Undo every payment in a batch that hasn't been reversed already.
CREATE OR REPLACE FUNCTION public.reverse_payout_batch(p_batch uuid, p_paid_on date, p_note text, p_actor uuid)
RETURNS int LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_n int;
BEGIN
    INSERT INTO commission_payouts (case_id, amount, paid_on, reverses, note, recorded_by)
    SELECT p.case_id, -p.amount, p_paid_on, p.id, p_note, p_actor
    FROM commission_payouts p
    WHERE p.batch_id = p_batch AND p.amount > 0
      AND NOT EXISTS (SELECT 1 FROM commission_payouts r WHERE r.reverses = p.id)
    ORDER BY p.case_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN RAISE EXCEPTION 'This batch has already been reversed.' USING ERRCODE = 'P0001'; END IF;
    RETURN v_n;
END;
$$;

-- ── 4. Money received from banks ────────────────────────────────────────────
-- p_items: [{case_id, amount, bank, seen}] — `seen` is the received total the
-- admin was looking at; a mismatch means someone else recorded it first.
CREATE OR REPLACE FUNCTION public.record_bank_receipts(
    p_items jsonb, p_received_on date, p_reference text, p_note text, p_actor uuid, p_kind text
)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_item     record;
    v_case     public.cases;
    v_received numeric;
    v_transfer uuid;
    v_total    numeric := 0;
    v_n        int := 0;
BEGIN
    IF p_kind NOT IN ('receipt', 'clawback') THEN RAISE EXCEPTION 'Invalid type.' USING ERRCODE = 'P0001'; END IF;
    INSERT INTO bank_transfers (received_on, reference, note, recorded_by)
    VALUES (p_received_on, p_reference, p_note, p_actor) RETURNING id INTO v_transfer;
    FOR v_item IN
        SELECT (e ->> 'case_id')::uuid AS case_id, round((e ->> 'amount')::numeric, 2) AS amount,
               NULLIF(BTRIM(e ->> 'bank'), '') AS bank, (e ->> 'seen')::numeric AS seen
        FROM jsonb_array_elements(p_items) e ORDER BY 1
    LOOP
        PERFORM 1 FROM cases WHERE id = v_item.case_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Case not found.' USING ERRCODE = 'P0001'; END IF;
        SELECT * INTO v_case FROM cases WHERE id = v_item.case_id;
        IF p_kind = 'receipt' AND v_case.stage <> 'Closed Won' THEN
            RAISE EXCEPTION '% is no longer Closed Won.', COALESCE(v_case.client_name, 'A case') USING ERRCODE = 'P0001';
        END IF;
        SELECT COALESCE(SUM(amount), 0) INTO v_received FROM bank_receipts WHERE case_id = v_case.id;
        IF v_item.seen IS NULL OR abs(v_received - v_item.seen) > 0.005 THEN
            RAISE EXCEPTION 'A bank payment for % was recorded just now. Refresh and check it again.', COALESCE(v_case.client_name, 'this case') USING ERRCODE = 'P0001';
        END IF;
        IF v_item.amount IS NULL OR v_item.amount <= 0 THEN
            RAISE EXCEPTION 'Enter an amount for every case.' USING ERRCODE = 'P0001';
        END IF;
        IF p_kind = 'clawback' AND v_item.amount > v_received + 0.005 THEN
            RAISE EXCEPTION 'The clawback is more than the bank has paid for % ($%).', COALESCE(v_case.client_name, 'this case'), round(v_received, 2) USING ERRCODE = 'P0001';
        END IF;
        INSERT INTO bank_receipts (case_id, transfer_id, kind, amount, bank, received_on, recorded_by)
        VALUES (v_case.id, v_transfer, p_kind,
                CASE WHEN p_kind = 'clawback' THEN -v_item.amount ELSE v_item.amount END,
                COALESCE(v_item.bank, NULLIF(BTRIM(v_case.closed_won_data ->> 'bank'), '')), p_received_on, p_actor);
        v_total := v_total + v_item.amount;
        v_n := v_n + 1;
    END LOOP;
    IF v_n = 0 THEN RAISE EXCEPTION 'Choose at least one case.' USING ERRCODE = 'P0001'; END IF;
    RETURN jsonb_build_object('transfer_id', v_transfer, 'cases', v_n, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_bank_receipt(p_receipt uuid, p_on date, p_note text, p_actor uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_row      public.bank_receipts;
    v_transfer uuid;
    v_received numeric;
BEGIN
    SELECT * INTO v_row FROM bank_receipts WHERE id = p_receipt;
    IF NOT FOUND OR v_row.kind = 'reversal' THEN
        RAISE EXCEPTION 'That record can''t be reversed.' USING ERRCODE = 'P0001';
    END IF;
    PERFORM 1 FROM cases WHERE id = v_row.case_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM bank_receipts WHERE reverses = p_receipt) THEN
        RAISE EXCEPTION 'That record has already been reversed.' USING ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE(SUM(amount), 0) INTO v_received FROM bank_receipts WHERE case_id = v_row.case_id;
    IF v_received - v_row.amount < -0.005 THEN
        RAISE EXCEPTION 'Reverse the clawback on this case first.' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO bank_transfers (received_on, note, recorded_by) VALUES (p_on, p_note, p_actor) RETURNING id INTO v_transfer;
    INSERT INTO bank_receipts (case_id, transfer_id, kind, amount, bank, received_on, reverses, recorded_by)
    VALUES (v_row.case_id, v_transfer, 'reversal', -v_row.amount, v_row.bank, p_on, v_row.id, p_actor);
END;
$$;

-- ── 5. Admin edits a case ───────────────────────────────────────────────────
-- Minor fields need no reason; anything else does. A Closed Won change or fee is
-- also added to cases.corrections, which the agent sees. p_reopen sends a Closed
-- Won case back to the agent (Pending Signature).
CREATE OR REPLACE FUNCTION public.admin_edit_case(
    p_case uuid, p_actor uuid, p_expected timestamptz, p_changes jsonb, p_reason text, p_fee numeric, p_reopen boolean
)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_minor   text[] := ARRAY['client_name','client_mobile','client_email','lead_source','lead_source_other',
                              'referred_bankers','follow_up_date','follow_up_remark','remarks'];
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
        ELSIF v_new.stage NOT IN ('Inactive','Touched Base','Pending Docs','Pending Approval','Pending Signature') THEN
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

-- ── 6. Server only ──────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'record_commission_payouts(jsonb, date, text, text, uuid, boolean)',
        'reverse_payout_batch(uuid, date, text, uuid)',
        'record_bank_receipts(jsonb, date, text, text, uuid, text)',
        'reverse_bank_receipt(uuid, date, text, uuid)',
        'admin_edit_case(uuid, uuid, timestamptz, jsonb, text, numeric, boolean)',
        'pin_case_closed_on(uuid)',
        'case_loan_value(public.cases)', 'case_gross(public.cases)', 'case_agent_owed(public.cases)'
    ] LOOP
        EXECUTE 'REVOKE ALL ON FUNCTION public.' || f || ' FROM PUBLIC, anon, authenticated';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.' || f || ' TO service_role';
    END LOOP;
END $$;
