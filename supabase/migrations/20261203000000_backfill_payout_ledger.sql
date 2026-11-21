-- Backfill the payout ledger (20261202000000) for cases that were marked paid
-- with the OLD paid/unpaid switch before the ledger existed (8 cases when this
-- shipped). Without a ledger row they'd read "paid" with $0 paid, and vanish
-- from Earnings' paid totals and Payout history.
--
-- One payout per such case: the full agent share owed (same formula as
-- recompute_case_payout), dated on its original paid date (SGT), clearly noted.
-- The insert trigger then recomputes the case from the ledger as usual.

INSERT INTO public.commission_payouts (case_id, amount, paid_on, note)
SELECT
    c.id,
    round(round(
        CASE
            WHEN COALESCE((c.closed_won_data ->> 'original_loan_total')::numeric, 0) > 0
                THEN (c.closed_won_data ->> 'original_loan_total')::numeric
            WHEN c.case_type IN ('Refinancing', 'Equity Loan')
                THEN GREATEST(COALESCE(c.existing_loan_amount, 0), 0)
            ELSE GREATEST(COALESCE(c.loan_size, 0), 0)
        END * 0.0015, 2) * 0.90, 2) - COALESCE(c.correction_fee, 0),
    COALESCE((c.commission_paid_at AT TIME ZONE 'Asia/Singapore')::date, (now() AT TIME ZONE 'Asia/Singapore')::date),
    'Recorded before the payout ledger (backfilled from the old paid status)'
FROM public.cases c
WHERE c.commission_status = 'paid'
  AND c.stage = 'Closed Won'
  AND NOT EXISTS (SELECT 1 FROM public.commission_payouts p WHERE p.case_id = c.id)
  -- amount must be non-zero (CHECK); a case owing nothing gets no row
  AND round(round(
        CASE
            WHEN COALESCE((c.closed_won_data ->> 'original_loan_total')::numeric, 0) > 0
                THEN (c.closed_won_data ->> 'original_loan_total')::numeric
            WHEN c.case_type IN ('Refinancing', 'Equity Loan')
                THEN GREATEST(COALESCE(c.existing_loan_amount, 0), 0)
            ELSE GREATEST(COALESCE(c.loan_size, 0), 0)
        END * 0.0015, 2) * 0.90, 2) - COALESCE(c.correction_fee, 0) <> 0;
