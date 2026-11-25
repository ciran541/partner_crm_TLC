-- Action Centre reads. Agent's own cases only, one page at a time, continuing
-- from the last row, so the cost depends on what is on screen and not on how
-- many cases exist. Read-only: no table, column or rule changes.
--
-- Deliberately separate from search_cases(): one function serving agents AND
-- admins with optional filters can't use these indexes, and it computes loan
-- volume, payouts and commission that this screen never shows.

CREATE INDEX IF NOT EXISTS idx_cases_owner_follow_up
    ON public.cases (created_by, follow_up_date, id) WHERE follow_up_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cases_owner_no_follow_up
    ON public.cases (created_by) WHERE follow_up_date IS NULL;

-- Exactly what a card and the "Update FU" form use. closed_won_data is trimmed
-- to the keys they read (followUpLimit(), next-cycle income). A view, not a
-- function over the row: that would unpack workflow_data for every card.
CREATE OR REPLACE VIEW public.action_centre_cards WITH (security_invoker = true) AS
    SELECT c.id, jsonb_build_object(
        'id', c.id, 'stage', c.stage, 'case_type', c.case_type,
        'client_name', c.client_name, 'client_mobile', c.client_mobile, 'client_email', c.client_email,
        'follow_up_date', c.follow_up_date, 'follow_up_remark', c.follow_up_remark,
        'no_follow_up', c.no_follow_up, 'client_reminder_opt_in', c.client_reminder_opt_in,
        'lock_in_end_date', c.lock_in_end_date, 'updated_at', c.updated_at,
        'closed_won_data', jsonb_strip_nulls(jsonb_build_object(
            'closed_at', c.closed_won_data -> 'closed_at',
            'lock_in_end_date', c.closed_won_data -> 'lock_in_end_date',
            'combined_outstanding', c.closed_won_data -> 'combined_outstanding',
            'package', CASE WHEN c.closed_won_data -> 'package' -> 'lockin_years' IS NOT NULL
                THEN jsonb_build_object('lockin_years', c.closed_won_data -> 'package' -> 'lockin_years') END
        ))
    ) AS card
    FROM public.cases c;
REVOKE ALL ON public.action_centre_cards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.action_centre_cards TO service_role;

-- Dated follow-ups in (p_after, p_to], soonest first. p_cur_* = the last row seen.
-- The total is only counted for a first page.
CREATE OR REPLACE FUNCTION public.action_centre_dated(
    p_viewer   uuid,
    p_after    date,
    p_to       date,
    p_limit    int,
    p_cur_date date DEFAULT '-infinity',
    p_cur_id   uuid DEFAULT '00000000-0000-0000-0000-000000000000',
    p_stage    text DEFAULT NULL,
    p_search   text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
SELECT jsonb_build_object(
    'rows', COALESCE((
        SELECT jsonb_agg(k.card ORDER BY x.follow_up_date, x.id) FROM (
            SELECT c.follow_up_date, c.id FROM cases c
            WHERE c.created_by = p_viewer
              AND c.follow_up_date > p_after AND c.follow_up_date <= p_to
              AND (c.follow_up_date, c.id) > (p_cur_date, p_cur_id)
              AND (p_stage IS NULL OR c.stage = p_stage)
              AND (p_search IS NULL
                   OR c.client_name   ILIKE '%' || p_search || '%'
                   OR c.client_mobile ILIKE '%' || p_search || '%'
                   OR c.client_email  ILIKE '%' || p_search || '%')
            ORDER BY c.follow_up_date, c.id
            LIMIT p_limit
        ) x JOIN action_centre_cards k ON k.id = x.id), '[]'::jsonb),
    'total', CASE WHEN p_cur_date <> '-infinity'::date THEN NULL
    -- No filters: counted from the index alone.
    WHEN p_stage IS NULL AND p_search IS NULL THEN (
        SELECT count(*) FROM cases c
        WHERE c.created_by = p_viewer AND c.follow_up_date > p_after AND c.follow_up_date <= p_to
    ) ELSE (
        SELECT count(*) FROM cases c
        WHERE c.created_by = p_viewer
          AND c.follow_up_date > p_after AND c.follow_up_date <= p_to
          AND (p_stage IS NULL OR c.stage = p_stage)
          AND (p_search IS NULL
               OR c.client_name   ILIKE '%' || p_search || '%'
               OR c.client_mobile ILIKE '%' || p_search || '%'
               OR c.client_email  ILIKE '%' || p_search || '%')
    ) END
)
$$;

-- "Needs a follow-up date", most recently touched first. Same rule as
-- search_cases(p_missing_follow_up) / needsFollowUp().
CREATE OR REPLACE FUNCTION public.action_centre_missing(
    p_viewer  uuid,
    p_limit   int,
    p_cur_at  timestamptz DEFAULT NULL,
    p_cur_id  uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
WITH m AS (
    SELECT c.id, COALESCE(c.updated_at, 'epoch'::timestamptz) AS at
    FROM cases c
    WHERE c.created_by = p_viewer
      AND c.follow_up_date IS NULL
      AND NOT (c.no_follow_up AND c.stage = 'Closed Lost')
      AND NOT (c.stage = 'Touched Base' AND COALESCE(BTRIM(c.client_name), '') = '')
      AND NOT EXISTS (SELECT 1 FROM cases ch WHERE ch.parent_case_id = c.id)
), pg AS (
    SELECT * FROM m
    WHERE p_cur_at IS NULL OR at < p_cur_at OR (at = p_cur_at AND id > p_cur_id)
    ORDER BY at DESC, id LIMIT p_limit
)
SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(k.card ORDER BY pg.at DESC, pg.id) FROM pg JOIN action_centre_cards k ON k.id = pg.id), '[]'::jsonb),
    'total', CASE WHEN p_cur_at IS NULL THEN (SELECT count(*) FROM m) END
)
$$;

-- The whole first screen in one call: counts + first rows.
CREATE OR REPLACE FUNCTION public.action_centre(p_viewer uuid, p_today date, p_soon date, p_limit int)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT action_centre_dated(p_viewer, '-infinity'::date, p_soon, p_limit) || jsonb_build_object(
        'missing', action_centre_missing(p_viewer, p_limit),
        'counts', (
            SELECT jsonb_build_object(
                'overdue', count(*) FILTER (WHERE c.follow_up_date < p_today),
                'today',   count(*) FILTER (WHERE c.follow_up_date = p_today),
                'soon',    count(*) FILTER (WHERE c.follow_up_date > p_today AND c.follow_up_date <= p_soon),
                'later',   count(*) FILTER (WHERE c.follow_up_date > p_soon))
            FROM cases c WHERE c.created_by = p_viewer AND c.follow_up_date IS NOT NULL
        )
    )
$$;

-- Calendar month: how many per day, and the first three names for the cell.
CREATE OR REPLACE FUNCTION public.action_centre_calendar(p_viewer uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.day, 'count', d.n, 'names', d.names) ORDER BY d.day), '[]'::jsonb)
    FROM (
        SELECT r.day, max(r.n) AS n, jsonb_agg(r.name ORDER BY r.rn) FILTER (WHERE r.rn <= 3) AS names
        FROM (
            SELECT c.follow_up_date AS day, COALESCE(NULLIF(BTRIM(c.client_name), ''), 'Unnamed') AS name,
                   row_number() OVER (PARTITION BY c.follow_up_date ORDER BY c.id) AS rn,
                   count(*) OVER (PARTITION BY c.follow_up_date) AS n
            FROM cases c
            WHERE c.created_by = p_viewer AND c.follow_up_date >= p_from AND c.follow_up_date <= p_to
        ) r GROUP BY r.day
    ) d
$$;

-- Server routes only: the viewer comes from the session, never from the browser.
DO $$
DECLARE f text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'action_centre_dated(uuid, date, date, int, date, uuid, text, text)',
        'action_centre_missing(uuid, int, timestamptz, uuid)',
        'action_centre(uuid, date, date, int)',
        'action_centre_calendar(uuid, date, date)'
    ] LOOP
        EXECUTE 'REVOKE ALL ON FUNCTION public.' || f || ' FROM PUBLIC, anon, authenticated';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.' || f || ' TO service_role';
    END LOOP;
END $$;
