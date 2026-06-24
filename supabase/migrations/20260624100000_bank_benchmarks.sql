-- Bank-set benchmark rates (FHR6, FHR8, FDR, board rates, etc.)
-- These are NOT published by MAS so cannot be auto-fetched. Admins maintain
-- them manually from the Rates page. The app reads them alongside SORA to
-- compute effective rates for floating packages pegged to these benchmarks.

CREATE TABLE IF NOT EXISTS bank_benchmarks (
    key         text PRIMARY KEY,           -- e.g. 'FHR6', 'FHR8', 'FDR'
    label       text NOT NULL,              -- display name, e.g. 'DBS FHR6'
    value       numeric(8,4) NOT NULL,      -- rate as a percentage, e.g. 0.8000
    updated_at  timestamptz DEFAULT now()
);

COMMENT ON TABLE bank_benchmarks IS
    'Admin-maintained bank benchmark rates (FHR6, FHR8, etc.) used to compute '
    'effective rates for floating packages. Not auto-fetched — updated manually.';

ALTER TABLE bank_benchmarks ENABLE ROW LEVEL SECURITY;
-- All access via service-role only (no direct client access)

-- Seed current known benchmarks
INSERT INTO bank_benchmarks (key, label, value) VALUES
    ('FHR6', 'DBS FHR6', 0.8000)
ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, label = EXCLUDED.label, updated_at = now();
