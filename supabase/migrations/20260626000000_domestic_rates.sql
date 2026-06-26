-- Cache for MAS "Domestic Interest Rates – Daily" full payload.
-- One row per end_of_day date; `data` JSONB holds all MAS fields except the date.
-- Populated by the daily SORA cron (latest row) and lazily on first user request (full history).
-- Serves the Resources → Domestic Rates page without hitting the 8MB MAS endpoint per request.

CREATE TABLE IF NOT EXISTS domestic_rates (
    value_date  date        PRIMARY KEY,
    data        jsonb       NOT NULL,
    fetched_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE domestic_rates IS
    'Daily MAS Domestic Interest Rates — all fields keyed by date. Cron keeps it current; app reads from here instead of the live MAS endpoint.';

ALTER TABLE domestic_rates ENABLE ROW LEVEL SECURITY;
