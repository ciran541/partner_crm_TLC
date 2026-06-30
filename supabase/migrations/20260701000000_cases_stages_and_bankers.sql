-- Insurance Cases: pipeline stage restructure + referred bankers
--
-- 1. Pipeline stages collapse "Proposal Given" and "Referred to Bank" into a
--    single "Pending Docs" stage. The old "Referred to Bank" role is now carried
--    by the referred_bankers column below. New flow:
--    Touched Base -> Pending Docs -> Pending Approval -> Pending Signature -> Closed Won/Lost

-- The stage CHECK constraint was originally added directly (not via a migration),
-- so it isn't in the reference schema. Drop it before migrating values, then
-- re-add it with the new canonical stage set.
ALTER TABLE public.cases DROP CONSTRAINT IF EXISTS cases_stage_check;

UPDATE public.cases
SET stage = 'Pending Docs'
WHERE stage IN ('Proposal Given', 'Referred to Bank');

ALTER TABLE public.cases
    ADD CONSTRAINT cases_stage_check CHECK (stage IN (
        'Touched Base',
        'Pending Docs',
        'Pending Approval',
        'Pending Signature',
        'Closed Won',
        'Closed Lost'
    ));

-- 2. Referred bankers — agents can refer a case to one or more bankers, each
--    tied to a bank (e.g. [{ "bank": "DBS", "name": "Terence Lee Tze Ghee" }]).
ALTER TABLE public.cases
    ADD COLUMN IF NOT EXISTS referred_bankers jsonb NOT NULL DEFAULT '[]'::jsonb;
