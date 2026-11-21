-- Dashboard analytics, step 1: where each lead came from, and when it first
-- became a live opportunity.
--
-- lead_source (agreed 2026-11-21) — one of seven codes, labels in
-- lib/insurance/leadSources.ts:
--   existing_client       Existing insurance or mortgage clients
--   referral              Client referrals, friends, family
--   professional_referral Property agents, insurance agents, bankers
--   social_media          Facebook, Instagram, TikTok
--   website_search        Website, Google, Bing
--   networking_events     Roadshows, seminars, networking
--   others                Anything else (lead_source_other says what)
-- NULL = not set yet (older cases, mass uploads without the column). Required
-- on New Case by the app; not by the DB, so old rows and imports still save.
--
-- first_activated_at — the PERMANENT moment a case first became a live
-- opportunity: named (not a planner draft) and in any stage other than
-- Inactive. Conversion is measured by the month a lead was first activated,
-- so moving a case between stages later must never move it to another
-- cohort. A trigger stamps it once and then refuses to let anyone change it.
-- Imported Inactive contacts stay NULL (not leads) until someone activates them.

ALTER TABLE public.cases
    ADD COLUMN IF NOT EXISTS lead_source        text,
    ADD COLUMN IF NOT EXISTS lead_source_other  text,
    ADD COLUMN IF NOT EXISTS first_activated_at timestamptz;

ALTER TABLE public.cases DROP CONSTRAINT IF EXISTS cases_lead_source_valid;
ALTER TABLE public.cases
    ADD CONSTRAINT cases_lead_source_valid CHECK (
        lead_source IS NULL OR lead_source IN (
            'existing_client', 'referral', 'professional_referral', 'social_media',
            'website_search', 'networking_events', 'others'
        )
    );

CREATE OR REPLACE FUNCTION public.cases_stamp_first_activated()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    -- Once set, it never changes (not by a stage move, not by any client write).
    IF TG_OP = 'UPDATE' AND OLD.first_activated_at IS NOT NULL THEN
        NEW.first_activated_at := OLD.first_activated_at;
        RETURN NEW;
    END IF;

    IF NEW.stage IS DISTINCT FROM 'Inactive'
       AND COALESCE(BTRIM(NEW.client_name), '') <> '' THEN
        NEW.first_activated_at := now();
    ELSE
        NEW.first_activated_at := NULL;   -- not a lead yet; can't be pre-set either
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cases_stamp_first_activated ON public.cases;
CREATE TRIGGER cases_stamp_first_activated
    BEFORE INSERT OR UPDATE ON public.cases
    FOR EACH ROW
    EXECUTE FUNCTION public.cases_stamp_first_activated();

-- Backfill: existing live / closed cases count from when they were created —
-- the closest record we have. Inactive cases and unnamed drafts stay NULL.
-- The trigger is off for this block (it would stamp now() instead).
ALTER TABLE public.cases DISABLE TRIGGER cases_stamp_first_activated;
UPDATE public.cases
SET first_activated_at = created_at
WHERE first_activated_at IS NULL
  AND stage <> 'Inactive'
  AND COALESCE(BTRIM(client_name), '') <> '';

-- Revisits are, by definition, existing clients.
UPDATE public.cases SET lead_source = 'existing_client'
WHERE parent_case_id IS NOT NULL AND lead_source IS NULL;
ALTER TABLE public.cases ENABLE TRIGGER cases_stamp_first_activated;

-- ── Dashboard data: one call, aggregated (no case rows leave the DB) ──────────
--   closed: Closed Won per closing month (SGT) × source — cases, loan volume
--   leads:  leads per first-activation month (SGT) × source — activated, won,
--           lost, still open (anything not closed: open stages or parked)
-- Loan figure mirrors caseLoanBase() / search_cases. Service role only; the
-- route passes the viewer from the session.
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
    ), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.dashboard_analytics(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_analytics(uuid, boolean, uuid) TO service_role;
