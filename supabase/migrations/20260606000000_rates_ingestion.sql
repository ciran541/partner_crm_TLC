-- Rates ingestion: bank+category bulk replace + min_loan_note.
-- Banks reissue a whole category at once (per the Google Sheet workflow), so the
-- ingestion tool wipes-and-replaces a bank's packages within the affected
-- categories. This must be atomic — a failed insert can never leave a bank empty.

-- Premier/threshold wording that doesn't fit a single number (e.g. "≥$600k Premier / ≥$800k").
ALTER TABLE mortgage_packages ADD COLUMN IF NOT EXISTS min_loan_note text;

-- Atomic replace: delete the in-scope buckets, insert the reviewed set, one txn.
-- Called via the service-role admin client, so RLS does not apply.
CREATE OR REPLACE FUNCTION replace_bank_packages(
    p_bank       text,
    p_categories text[],
    p_packages   jsonb
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    inserted integer;
BEGIN
    -- 1. Remove existing packages for this bank within the affected categories only.
    DELETE FROM mortgage_packages
    WHERE bank = p_bank
      AND category = ANY(p_categories);

    -- 2. Insert the reviewed set (bank forced to p_bank — the admin's explicit choice).
    INSERT INTO mortgage_packages (
        bank, property_type, category, min_loan_size, package_name, lockin_years,
        rate_schedule, first_year_rate, features, subsidies, remarks, min_loan_note,
        status, last_updated
    )
    SELECT
        p_bank,
        COALESCE(x->>'property_type', 'HDB / Private'),
        COALESCE(x->>'category', 'Fixed'),
        COALESCE((x->>'min_loan_size')::numeric, 0),
        COALESCE(x->>'package_name', 'Untitled package'),
        COALESCE((x->>'lockin_years')::int, 0),
        COALESCE(x->'rate_schedule', '[]'::jsonb),
        NULLIF(x->>'first_year_rate', '')::numeric,
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(x->'features')), '{}'),
        NULLIF(x->>'subsidies', ''),
        NULLIF(x->>'remarks', ''),
        NULLIF(x->>'min_loan_note', ''),
        COALESCE(x->>'status', 'published'),
        current_date
    FROM jsonb_array_elements(p_packages) AS x;

    GET DIAGNOSTICS inserted = ROW_COUNT;
    RETURN inserted;
END;
$$;

COMMENT ON FUNCTION replace_bank_packages IS 'Atomically replace a bank''s packages within the given categories with a reviewed set. Used by the ingestion tool.';
