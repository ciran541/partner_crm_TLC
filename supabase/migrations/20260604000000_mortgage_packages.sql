-- Layer 5 (foundation): in-app Mortgage Packages (rates)
-- Replaces the external iframe (mortgage-package.vercel.app) with a native,
-- structured rates table. Rates are stored structured (per-year rate_schedule
-- JSONB) so they are sortable/filterable now and computable by the workflow
-- engine in phase 2 (Step 4 auto-recommendation).

CREATE TABLE IF NOT EXISTS mortgage_packages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bank            text NOT NULL,                 -- validated against banks.name at the app layer
    property_type   text NOT NULL,                 -- 'HDB' | 'Private' | 'HDB / Private' | 'Executive Condominium'
    category        text NOT NULL DEFAULT 'Fixed', -- 'Fixed' | 'Floating (Completed)' | 'BUC'
    min_loan_size   numeric NOT NULL DEFAULT 0,    -- SGD, raw number
    package_name    text NOT NULL,
    lockin_years    integer NOT NULL DEFAULT 0,    -- 0 = No Lock-in (int → sortable/filterable)
    rate_schedule   jsonb NOT NULL DEFAULT '[]',   -- structured per-year rates (see below)
    first_year_rate numeric,                        -- derived from rate_schedule[0] on save → sort/compare key
    features        text[] DEFAULT '{}',
    subsidies       text,
    remarks         text,
    status          text NOT NULL DEFAULT 'published', -- 'published' (agents see) | 'draft' (admin only)
    last_updated    date NOT NULL DEFAULT current_date,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mortgage_packages IS 'Layer 5 in-app mortgage rate packages. Admin CRUD via /api/admin/rates; agents read published via /api/insurance/rates.';
COMMENT ON COLUMN mortgage_packages.rate_schedule IS 'Ordered array of per-year entries: {year:int|null, thereafter?:bool, type:"fixed"|"floating", rate?:number (fixed %), reference?:text (e.g. "3M SORA"), spread?:number (floating margin %)}.';
COMMENT ON COLUMN mortgage_packages.first_year_rate IS 'Rough sort key derived from rate_schedule[0]: fixed→rate, floating→spread. Phase 2 computes the effective rate using live SORA.';

-- Filter/sort indexes (table is small but these match the common filter bar).
CREATE INDEX IF NOT EXISTS idx_mortgage_packages_bank ON mortgage_packages (bank);
CREATE INDEX IF NOT EXISTS idx_mortgage_packages_property_type ON mortgage_packages (property_type);
CREATE INDEX IF NOT EXISTS idx_mortgage_packages_category ON mortgage_packages (category);
CREATE INDEX IF NOT EXISTS idx_mortgage_packages_status ON mortgage_packages (status);

-- keep updated_at fresh
CREATE OR REPLACE FUNCTION mortgage_packages_touch_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mortgage_packages_touch ON mortgage_packages;
CREATE TRIGGER trg_mortgage_packages_touch
    BEFORE UPDATE ON mortgage_packages
    FOR EACH ROW EXECUTE FUNCTION mortgage_packages_touch_updated_at();

-- RLS: enabled, no client policies. All access flows through server API routes
-- using the service-role client after auth (same pattern as knowledge_articles).
ALTER TABLE mortgage_packages ENABLE ROW LEVEL SECURITY;
