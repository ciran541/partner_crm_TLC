-- Conversion: a contact marked Closed Lost without ever being worked is not a lead.
-- Tidying an imported list (Inactive -> Closed Lost) used to stamp
-- first_activated_at and count as a lost lead. Otherwise unchanged from
-- 20261201000000: stamped once, never changes. A direct Closed Won still counts,
-- in the month it closed. Rows already stamped are left alone.

CREATE OR REPLACE FUNCTION public.cases_stamp_first_activated()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.first_activated_at IS NOT NULL THEN
        NEW.first_activated_at := OLD.first_activated_at;
        RETURN NEW;
    END IF;

    IF NEW.stage NOT IN ('Inactive', 'Closed Lost')
       AND COALESCE(BTRIM(NEW.client_name), '') <> '' THEN
        NEW.first_activated_at := now();
    ELSE
        NEW.first_activated_at := NULL;   -- not a lead yet; can't be pre-set either
    END IF;
    RETURN NEW;
END;
$$;
