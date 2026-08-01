-- Make updated_at trustworthy everywhere.
--
-- Until now only property_cases and mortgage_packages had a BEFORE UPDATE
-- trigger; every other table with an updated_at column relied on application
-- code remembering to set it by hand. It already didn't:
-- app/api/admin/update-case/route.ts issues `.update(updates)` with no
-- timestamp, so an admin editing a case never bumped cases.updated_at.
--
-- Two consequences, one live and one latent:
--   * Live — the insurance case list orders by updated_at DESC and caps at
--     1000 rows, so an admin-edited case sorts as though it were stale and
--     can fall off the bottom of the very list the admin is working in.
--   * Latent — any future incremental/delta sync ("send me rows changed since
--     <cursor>") silently SKIPS rows whose timestamp was never bumped. That
--     failure is invisible: no error, just missing data.
--
-- Doing this pre-launch is deliberate: there is no production data to
-- backfill, so the timestamps are correct from the first row written.
--
-- The trigger always bumps on UPDATE rather than only when the row really
-- changed (`NEW IS DISTINCT FROM OLD`). A no-op update therefore touches the
-- timestamp, which costs a delta-sync client a redundant re-send but can never
-- cause it to MISS a change. Given the whole point here is a timestamp you can
-- trust, over-sending is the right side to err on.

-- Shared trigger function. Already created by phase1_property_platform.sql;
-- repeated here with CREATE OR REPLACE so this migration stands alone and is
-- safe to run against a database where that function is missing.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Tables that have an updated_at column but no trigger maintaining it.
-- property_cases and mortgage_packages are deliberately left alone: they
-- already have working equivalents (property_cases_updated_at and
-- trg_mortgage_packages_touch) and there is no reason to churn them.
DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'cases',
        'knowledge_articles',
        'mortgage_news_articles',
        'economic_calendar_events',
        'bank_intelligence_reports',
        'bank_benchmarks',
        'insurance_calendar_events',
        'property_calendar_events'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        -- Skip anything not present in this environment rather than failing the
        -- whole migration.
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE NOTICE 'skipping %, table not found', t;
            CONTINUE;
        END IF;

        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_touch_updated_at ON public.%I', t, t);
        EXECUTE format(
            'CREATE TRIGGER trg_%s_touch_updated_at
                 BEFORE UPDATE ON public.%I
                 FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
            t, t
        );
    END LOOP;
END $$;

-- cases.updated_at is both the current sort key for the case list and the
-- future delta-sync cursor, but had no index — every list load was sorting the
-- table. DESC matches the query's ORDER BY; a range scan for `updated_at > x`
-- uses it just as well.
CREATE INDEX IF NOT EXISTS idx_cases_updated_at ON public.cases (updated_at DESC);
