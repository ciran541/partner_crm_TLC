-- Layer 5 (decision support): daily SORA benchmark values from the MAS API.
-- Floating mortgage rates are quoted as "<benchmark> + spread"; to turn that into
-- a dollar figure (Step 4 auto-recommendation) we need the live benchmark value.
-- A daily cron fetches MAS "Domestic Interest Rates – Daily" and upserts the
-- latest compounded SORA tenors here. Reads are instant from this table.

CREATE TABLE IF NOT EXISTS sora_rates (
    value_date      date PRIMARY KEY,       -- MAS end_of_day (the rate's value date)
    sora            numeric,                -- overnight SORA
    sora_index      numeric,
    comp_sora_1m    numeric,                -- 1-month compounded SORA (banks price off this)
    comp_sora_3m    numeric,                -- 3-month compounded SORA
    comp_sora_6m    numeric,
    published_date  date,                   -- MAS publication date (value_date + ~1 business day)
    fetched_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sora_rates IS 'Daily compounded SORA from the MAS Domestic Interest Rates API. Powers Step 4 floating-rate computation.';

-- RLS on; all access via service-role server routes (cron writes, app reads the latest).
ALTER TABLE sora_rates ENABLE ROW LEVEL SECURITY;
