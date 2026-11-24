-- Follow-up limit (agreed 2026-11-24). Apply AFTER the matching code is deployed.
-- Closed Won and Inactive cases: the follow-up can't be later than 2 months before
-- the lock-in ends. SQL twin of followUpLimit() in lib/insurance/followUps.ts.
--   * lifts on the day the limit arrives (otherwise no date could be saved at all)
--   * checked only when the date or stage changes, so existing follow-ups that
--     already break it stay until next edited

CREATE OR REPLACE FUNCTION public.cases_follow_up_lockin_limit()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_end   date;
    v_limit date;
BEGIN
    IF NEW.follow_up_date IS NULL OR NEW.stage NOT IN ('Closed Won', 'Inactive') THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.follow_up_date IS NOT DISTINCT FROM OLD.follow_up_date
           AND NEW.stage IS NOT DISTINCT FROM OLD.stage THEN RETURN NEW; END IF;
    END IF;
    v_end := public.case_lock_in_end(NEW.stage, NEW.lock_in_end_date, NEW.closed_won_data);
    v_limit := (v_end - interval '2 months')::date;
    IF v_limit > (now() AT TIME ZONE 'Asia/Singapore')::date AND NEW.follow_up_date > v_limit THEN
        RAISE EXCEPTION 'The follow-up can''t be later than % (2 months before the lock-in ends on %)',
            to_char(v_limit, 'FMDD Mon YYYY'), to_char(v_end, 'FMDD Mon YYYY') USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cases_follow_up_lockin_limit ON public.cases;
CREATE TRIGGER cases_follow_up_lockin_limit BEFORE INSERT OR UPDATE ON public.cases
    FOR EACH ROW EXECUTE FUNCTION public.cases_follow_up_lockin_limit();
