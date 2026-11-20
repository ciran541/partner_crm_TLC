-- Follow-ups, step 1: history + the fields the Action Centre and client
-- reminders need. Additive only — nothing here changes how today's screens
-- behave. The "every case must have a follow-up date" rule lands in step 2,
-- together with the screens that set it (enforcing it first would make the
-- New Case form, mass import and stage changes fail for agents).
--
-- Rules agreed 2026-11-20:
--   * every case always has a next follow-up date + remark, until it is
--     Closed Lost with "Don't follow up" ticked (no_follow_up);
--   * the client is contacted (WhatsApp + email) ONLY when the case is
--     Closed Won AND the agent ticked "Client agreed to receive reminders"
--     (client_reminder_opt_in), once, on the follow-up date;
--   * every follow-up change is kept as history so the agent can see the
--     client's whole story.

-- ── 1. New case columns ─────────────────────────────────────────────────────

ALTER TABLE public.cases
    ADD COLUMN IF NOT EXISTS follow_up_remark        text,
    ADD COLUMN IF NOT EXISTS no_follow_up            boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS client_reminder_opt_in  boolean NOT NULL DEFAULT false,
    -- The follow_up_date a client reminder was last sent for. The daily job
    -- sends only when this differs from today's follow_up_date, so a re-run
    -- (or a retried cron) can never message the client twice for one date,
    -- while moving the date re-arms it.
    ADD COLUMN IF NOT EXISTS client_reminder_sent_for date;

-- "Don't follow up" only exists on Closed Lost; the reminder box only on Closed Won.
ALTER TABLE public.cases DROP CONSTRAINT IF EXISTS cases_no_follow_up_closed_lost;
ALTER TABLE public.cases
    ADD CONSTRAINT cases_no_follow_up_closed_lost
    CHECK (NOT no_follow_up OR stage = 'Closed Lost');

ALTER TABLE public.cases DROP CONSTRAINT IF EXISTS cases_reminder_opt_in_closed_won;
ALTER TABLE public.cases
    ADD CONSTRAINT cases_reminder_opt_in_closed_won
    CHECK (NOT client_reminder_opt_in OR stage = 'Closed Won');

-- Leaving a stage drops the flag that belongs to it, instead of making the
-- stage change fail on the constraints above. Reopening a Closed Lost case
-- therefore resumes follow-ups, and a case moved out of Closed Won stops
-- reminding the client.
CREATE OR REPLACE FUNCTION public.cases_normalise_follow_up_flags()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.stage IS DISTINCT FROM 'Closed Lost' THEN
        NEW.no_follow_up := false;
    END IF;
    IF NEW.stage IS DISTINCT FROM 'Closed Won' THEN
        NEW.client_reminder_opt_in := false;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cases_normalise_follow_up_flags ON public.cases;
CREATE TRIGGER cases_normalise_follow_up_flags
    BEFORE INSERT OR UPDATE ON public.cases
    FOR EACH ROW
    EXECUTE FUNCTION public.cases_normalise_follow_up_flags();

-- ── 2. History table ────────────────────────────────────────────────────────
--
-- One row each time a case's follow-up changes. follow_up_date NULL means the
-- follow-up was cleared (or "Don't follow up" was ticked — see no_follow_up).
-- `stage` is the case's stage at that moment, so the history reads like the
-- client's journey ("Pending Docs · 26 Nov · Obtain Documents").

CREATE TABLE IF NOT EXISTS public.case_follow_ups (
    id             uuid NOT NULL DEFAULT gen_random_uuid(),
    case_id        uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
    follow_up_date date,
    remark         text,
    stage          text NOT NULL,
    no_follow_up   boolean NOT NULL DEFAULT false,
    set_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at     timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS case_follow_ups_case_id_idx
    ON public.case_follow_ups (case_id, created_at DESC);

-- Agents read their own cases' history, admins read all. Nobody writes it
-- directly: rows come only from the trigger below, so the history can't be
-- edited or skipped from the browser.
ALTER TABLE public.case_follow_ups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "case_follow_ups_select" ON public.case_follow_ups;
CREATE POLICY "case_follow_ups_select" ON public.case_follow_ups
    FOR SELECT TO authenticated
    USING (
        public.is_admin_user()
        OR EXISTS (
            SELECT 1 FROM public.cases c
            WHERE c.id = case_follow_ups.case_id AND c.created_by = auth.uid()
        )
    );

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.case_follow_ups FROM anon, authenticated;

-- ── 3. Record history automatically ─────────────────────────────────────────
--
-- A trigger rather than API code, so EVERY write path is captured: the case
-- page (browser), the follow-up route, revisit, mass import, admin edits.
-- set_by = the signed-in user; service-role routes have no auth.uid(), and
-- those act for the case owner, so fall back to created_by.

CREATE OR REPLACE FUNCTION public.cases_record_follow_up_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.follow_up_date IS NULL AND NEW.follow_up_remark IS NULL AND NOT NEW.no_follow_up THEN
            RETURN NEW;
        END IF;
    ELSIF NEW.follow_up_date   IS NOT DISTINCT FROM OLD.follow_up_date
      AND NEW.follow_up_remark IS NOT DISTINCT FROM OLD.follow_up_remark
      AND NEW.no_follow_up     IS NOT DISTINCT FROM OLD.no_follow_up THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.case_follow_ups (case_id, follow_up_date, remark, stage, no_follow_up, set_by)
    VALUES (NEW.id, NEW.follow_up_date, NEW.follow_up_remark, NEW.stage, NEW.no_follow_up,
            COALESCE(auth.uid(), NEW.created_by));
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cases_record_follow_up_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cases_record_follow_up_history ON public.cases;
CREATE TRIGGER cases_record_follow_up_history
    AFTER INSERT OR UPDATE ON public.cases
    FOR EACH ROW
    EXECUTE FUNCTION public.cases_record_follow_up_history();

-- ── 4. Seed history with today's follow-ups ─────────────────────────────────
-- So a case that already has a date doesn't start with an empty history.
-- Dated at the case's last update — the closest we have to when it was set.

INSERT INTO public.case_follow_ups (case_id, follow_up_date, remark, stage, set_by, created_at)
SELECT c.id, c.follow_up_date, NULL, c.stage, c.created_by, COALESCE(c.updated_at, c.created_at, now())
FROM public.cases c
WHERE c.follow_up_date IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.case_follow_ups h WHERE h.case_id = c.id);
