-- Follow-ups, step 2b: every case must have a follow-up date.
-- Apply AFTER the code from the same change is deployed (the old screens can
-- still clear a date or close a case without one).
--
-- Rule (agreed 2026-11-20, see lib/insurance/followUps.ts): a case always has a
-- next follow-up date, until it is Closed Lost with "Don't follow up" ticked.
--
-- Enforced HERE, not just in the screens, because agents write `cases` straight
-- from the browser. The check fires only when it matters — a new case, a stage
-- change, or the date / "Don't follow up" being changed — so older cases that
-- never had a date keep saving normally (workflow autosave etc.) and simply show
-- up in the Action Centre's "Needs a follow-up date" list until the agent sets one.
--
-- Exempt:
--   * planner drafts (Touched Base with no client name yet)
--   * Closed Lost + no_follow_up
--   * a case that has been revisited — the follow-on case carries the
--     follow-up, and the revisit route clears the old case's date
--

CREATE OR REPLACE FUNCTION public.cases_follow_up_required()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_relevant boolean;
BEGIN
    IF NEW.follow_up_date IS NOT NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.no_follow_up AND NEW.stage = 'Closed Lost' THEN
        RETURN NEW;
    END IF;
    IF NEW.stage = 'Touched Base' AND COALESCE(BTRIM(NEW.client_name), '') = '' THEN
        RETURN NEW;   -- planner draft
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_relevant := true;
    ELSE
        v_relevant := NEW.stage IS DISTINCT FROM OLD.stage
                   OR OLD.follow_up_date IS NOT NULL
                   OR NEW.no_follow_up IS DISTINCT FROM OLD.no_follow_up;
    END IF;
    IF NOT v_relevant THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM public.cases ch WHERE ch.parent_case_id = NEW.id) THEN
        RETURN NEW;   -- revisited: the follow-on case carries the follow-up
    END IF;

    RAISE EXCEPTION 'Set a follow-up date for this case'
        USING ERRCODE = '23514',
              HINT = 'Every case needs a next follow-up date, unless it is Closed Lost with "Don''t follow up" ticked.';
END;
$$;

-- Order against cases_normalise_follow_up_flags doesn't matter: a reopened
-- Closed Lost case fails the exemption either way (its stage is no longer
-- Closed Lost), so trigger order can't change the outcome.
DROP TRIGGER IF EXISTS cases_follow_up_required ON public.cases;
CREATE TRIGGER cases_follow_up_required
    BEFORE INSERT OR UPDATE ON public.cases
    FOR EACH ROW
    EXECUTE FUNCTION public.cases_follow_up_required();
