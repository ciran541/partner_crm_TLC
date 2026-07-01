-- Insurance commission payout tracking.
-- Commission amounts are computed on the fly (loan × 0.15%, agent 90% / TLC 10%);
-- only the paid/unpaid state needs to persist, and only matters once a case is
-- Closed Won.
ALTER TABLE public.cases
    ADD COLUMN IF NOT EXISTS commission_status text NOT NULL DEFAULT 'unpaid';

ALTER TABLE public.cases DROP CONSTRAINT IF EXISTS cases_commission_status_check;
ALTER TABLE public.cases
    ADD CONSTRAINT cases_commission_status_check CHECK (commission_status IN ('unpaid', 'paid'));
