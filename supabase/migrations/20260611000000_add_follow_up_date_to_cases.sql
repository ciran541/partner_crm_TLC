-- Add a follow-up reminder date to insurance cases.
--
-- Set from the New Purchase workflow's "Next step" card and surfaced on the
-- insurance Follow Up page (/insurance/dashboard/followup). The property app
-- already has this column on property_cases; this brings parity to cases.

ALTER TABLE public.cases
    ADD COLUMN IF NOT EXISTS follow_up_date date;
