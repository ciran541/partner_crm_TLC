-- Sortable columns on the agent's Cases list: own_cases() gains sort orders.
-- Same arguments and result as 20261213000000; only p_sort accepts more values:
--   type | loan | banker | input | due (follow-up) | closed, each with _asc / _desc.

CREATE OR REPLACE FUNCTION public.own_cases(
    p_owner         uuid,
    p_limit         int     DEFAULT 25,
    p_stage         text    DEFAULT NULL,
    p_sort          text    DEFAULT 'updated',
    p_cursor_key    text    DEFAULT NULL,
    p_cursor_id     uuid    DEFAULT NULL,
    p_search        text    DEFAULT NULL,
    p_from          date    DEFAULT NULL,
    p_to            date    DEFAULT NULL,
    p_month         text    DEFAULT NULL,
    p_closed        text    DEFAULT NULL,
    p_bucket        text    DEFAULT NULL,
    p_follow_up_to  date    DEFAULT NULL,
    p_banker_name   text    DEFAULT NULL,
    p_banker_bank   text    DEFAULT NULL,
    p_lock_in_from  date    DEFAULT NULL,
    p_lock_in_to    date    DEFAULT NULL,
    p_drafts        boolean DEFAULT false,
    p_count_only    boolean DEFAULT false,
    p_follow_up_after date  DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
    w    text := 'c.created_by = $1';
    k    text;       -- sort key
    ktyp text;
    dir  text;
    fu   text;       -- tie-break inside a Type / Banker group
    loan text := $k$CASE
        WHEN c.stage = 'Closed Won' AND COALESCE((c.closed_won_data ->> 'original_loan_total')::numeric, 0) > 0
            THEN (c.closed_won_data ->> 'original_loan_total')::numeric
        WHEN c.case_type IN ('Refinancing', 'Equity Loan') THEN GREATEST(COALESCE(c.existing_loan_amount, 0), 0)
        ELSE GREATEST(COALESCE(c.loan_size, 0), 0) END$k$;
    cmp  text;
    res  jsonb;
    tot  jsonb := '{}'::jsonb;
BEGIN
    -- Days since 2000 (undated = year 9999), so the soonest follow-up comes first either way.
    fu := $k$GREATEST(COALESCE(c.follow_up_date, '9999-12-31'::date) - '2000-01-01'::date, 0)$k$;
    IF right(p_sort, 5) = '_desc' THEN fu := '3000000 - ' || fu; END IF;
    fu := $k$ || '.' || lpad(($k$ || fu || $k$)::text, 8, '0')) COLLATE "C"$k$;

    CASE p_sort
        WHEN 'follow_up' THEN k := 'COALESCE(c.follow_up_date, ''infinity''::date)'; ktyp := 'date'; dir := 'ASC'; cmp := '>';
        WHEN 'lock_in'   THEN k := 'c.lock_in_end_date'; ktyp := 'date'; dir := 'ASC'; cmp := '>';
        WHEN 'closed'    THEN k := 'COALESCE(case_closed_on(c.closed_won_data, c.updated_at), ''-infinity''::date)'; ktyp := 'date'; dir := 'DESC'; cmp := '<';
        -- Column headings. Blank values come last in both directions. Text is hex
        -- encoded: same order, and nothing readable or unsafe in the cursor.
        WHEN 'type_asc', 'type_desc' THEN
            k := $k$('1' || encode(convert_to(lower(c.case_type), 'UTF8'), 'hex')$k$ || fu;
            ktyp := 'text';
        WHEN 'banker_asc', 'banker_desc' THEN
            -- The first banker on the case, by name then bank.
            k := $k$(CASE WHEN COALESCE(BTRIM(c.referred_bankers -> 0 ->> 'name'), '') = '' THEN $k$
                || CASE WHEN p_sort = 'banker_asc' THEN $k$'2'$k$ ELSE $k$'0'$k$ END
                || $k$ ELSE '1' || encode(convert_to(lower(BTRIM(c.referred_bankers -> 0 ->> 'name')) || chr(9)
                    || lower(COALESCE(c.referred_bankers -> 0 ->> 'bank', '')), 'UTF8'), 'hex') END$k$ || fu;
            ktyp := 'text';
        WHEN 'loan_asc'    THEN k := 'COALESCE(NULLIF(' || loan || ', 0), 999999999999999)'; ktyp := 'numeric';
        WHEN 'loan_desc'   THEN k := '(' || loan || ')'; ktyp := 'numeric';
        WHEN 'input_asc', 'input_desc' THEN k := 'COALESCE(c.created_at, ''epoch''::timestamptz)'; ktyp := 'timestamptz';
        WHEN 'due_asc'     THEN k := 'COALESCE(c.follow_up_date, ''infinity''::date)'; ktyp := 'date';
        WHEN 'due_desc'    THEN k := 'COALESCE(c.follow_up_date, ''-infinity''::date)'; ktyp := 'date';
        WHEN 'closed_asc'  THEN k := 'COALESCE(case_closed_on(c.closed_won_data, c.updated_at), ''infinity''::date)'; ktyp := 'date';
        WHEN 'closed_desc' THEN k := 'COALESCE(case_closed_on(c.closed_won_data, c.updated_at), ''-infinity''::date)'; ktyp := 'date';
        ELSE                  k := 'COALESCE(c.updated_at, ''epoch''::timestamptz)'; ktyp := 'timestamptz'; dir := 'DESC'; cmp := '<';
    END CASE;
    IF dir IS NULL THEN
        dir := CASE WHEN right(p_sort, 5) = '_desc' THEN 'DESC' ELSE 'ASC' END;
        cmp := CASE WHEN dir = 'DESC' THEN '<' ELSE '>' END;
    END IF;

    IF p_stage IS NOT NULL THEN w := w || ' AND c.stage = $2'; END IF;
    IF NOT p_drafts THEN
        w := w || ' AND NOT (c.stage = ''Touched Base'' AND COALESCE(BTRIM(c.client_name), '''') = '''')';
    END IF;
    IF p_search IS NOT NULL THEN
        w := w || ' AND (COALESCE(c.client_name, '''') || E''\n'' || COALESCE(c.client_mobile, '''') || E''\n'' || COALESCE(c.client_email, '''')) ILIKE ''%'' || $3 || ''%''';
    END IF;
    IF p_from IS NOT NULL THEN w := w || ' AND c.created_at >= $4::timestamptz'; END IF;
    IF p_to IS NOT NULL THEN w := w || ' AND c.created_at < (($5 + 1)::timestamptz)'; END IF;
    IF p_month IS NOT NULL THEN w := w || ' AND to_char(c.created_at, ''YYYY-MM'') = $6'; END IF;
    IF p_closed IS NOT NULL THEN
        w := w || ' AND c.stage = ''Closed Won'' AND starts_with(to_char(case_closed_on(c.closed_won_data, c.updated_at), ''YYYY-MM''), $7)';
    END IF;
    IF p_bucket = 'closed_paid' THEN w := w || ' AND c.stage = ''Closed Won'' AND c.commission_status = ''paid''';
    ELSIF p_bucket = 'closed_unpaid' THEN w := w || ' AND c.stage = ''Closed Won'' AND c.commission_status IS DISTINCT FROM ''paid''';
    END IF;
    IF p_follow_up_to IS NOT NULL THEN w := w || ' AND c.follow_up_date <= $8'; END IF;
    -- Action Centre's Later search (same order and cursor as action_centre_dated()).
    IF p_follow_up_after IS NOT NULL THEN w := w || ' AND c.follow_up_date > $16'; END IF;
    IF p_banker_name IS NOT NULL THEN
        w := w || ' AND c.referred_bankers @> jsonb_build_array(jsonb_build_object(''name'', $9, ''bank'', COALESCE($10, '''')))';
    END IF;
    -- The lock-in window is the "Upcoming Lock-ins" screen: lost deals are not on it.
    IF p_lock_in_from IS NOT NULL THEN w := w || ' AND c.lock_in_end_date >= $11 AND c.lock_in_end_date <= $12 AND c.stage <> ''Closed Lost'''; END IF;

    IF p_cursor_id IS NULL THEN
        EXECUTE 'SELECT jsonb_build_object(''total'', count(*)'
            || CASE WHEN p_count_only THEN '' ELSE ', ''loan_volume'', COALESCE(SUM(' || loan || '), 0)' END
            || ') FROM cases c WHERE ' || w
        INTO tot
        USING p_owner, p_stage, p_search, p_from, p_to, p_month, p_closed, p_follow_up_to, p_banker_name, p_banker_bank, p_lock_in_from, p_lock_in_to,
              p_cursor_key, p_cursor_id, p_limit, p_follow_up_after;
    ELSE
        w := w || format(' AND %1$s %2$s= $13::%3$s AND (%1$s %2$s $13::%3$s OR c.id > $14)', k, cmp, ktyp);
    END IF;

    EXECUTE format('
        SELECT jsonb_build_object(
            ''rows'', COALESCE(jsonb_agg(v.card ORDER BY x.k %2$s, x.id), ''[]''::jsonb),
            ''next_cursor'', CASE WHEN count(*) = $15 THEN (array_agg(x.k::text || ''_'' || x.id ORDER BY x.k %2$s, x.id))[count(*)] END)
        FROM (SELECT c.id, %1$s AS k FROM cases c WHERE %3$s ORDER BY %1$s %2$s, c.id LIMIT $15) x
        JOIN own_case_cards v ON v.id = x.id', k, dir, w)
    INTO res
    USING p_owner, p_stage, p_search, p_from, p_to, p_month, p_closed, p_follow_up_to, p_banker_name, p_banker_bank, p_lock_in_from, p_lock_in_to,
          p_cursor_key, p_cursor_id, p_limit, p_follow_up_after;

    RETURN res || tot;
END;
$$;
