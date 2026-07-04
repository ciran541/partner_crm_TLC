-- Layer 7 (resources): Economic Calendar — FOMC meetings, US CPI releases, and
-- MAS Monetary Policy Statements, with impact ratings and countdowns.
--
-- Three different sourcing paths feed this one table (see lib/insurance/economicCalendar.ts):
--   - fomc_meeting: scraped from the Fed's own official calendar page
--   - us_cpi: release *dates* come from an admin-imported BLS ICS calendar
--     (BLS's site blocks automated fetches of both the HTML schedule and the
--     .ics file itself, confirmed by testing — but a human downloading it in
--     a browser works fine, and BLS publishes ~18 months ahead, so this is a
--     rare admin action, not routine data entry); actual/previous/forecast
--     *values* come from FRED automatically
--   - mas_mps: MAS's site has no accessible schedule or API for this
--     (confirmed against their own 108-product API catalog) — admin-entered,
--     twice a year, whenever MAS announces the next date
CREATE TABLE IF NOT EXISTS economic_calendar_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_key       text NOT NULL,   -- 'fomc_meeting' | 'us_cpi' | 'mas_mps'
    event_name      text NOT NULL,
    event_date      date NOT NULL,
    actual          numeric,          -- CPI YoY % only; null for fomc_meeting/mas_mps
    previous        numeric,
    forecast        numeric,          -- CPI: FRED EXPINF1YR, shown honestly labeled (not literal "consensus")
    unit            text DEFAULT '%',
    impact_stars    smallint NOT NULL DEFAULT 3 CHECK (impact_stars BETWEEN 1 AND 5),
    is_manual       boolean NOT NULL DEFAULT false,  -- true for mas_mps and any QA override
    hidden          boolean NOT NULL DEFAULT false,
    admin_notes     text,
    external_key    text NOT NULL,    -- dedup key, e.g. 'fomc:2026-07-29', 'cpi:2026-08-12', 'mas_mps:2026-04-14'
    fetched_at      timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (external_key)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_date_key ON economic_calendar_events (event_key, event_date);

COMMENT ON TABLE economic_calendar_events IS 'FOMC/CPI/MAS MPS calendar. See lib/insurance/economicCalendar.ts for how each event_key is sourced.';

-- RLS on; all access via service-role server routes (cron/admin writes, agents read via API).
ALTER TABLE economic_calendar_events ENABLE ROW LEVEL SECURITY;
