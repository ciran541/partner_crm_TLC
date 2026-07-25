-- Economic Calendar: link each event to its published result.
--
-- Until now the calendar only answered "when" — an agent could see that an FOMC
-- meeting or MAS MPS was coming, but nothing about what came out of it. This
-- column holds the URL of the published result, populated by the daily cron once
-- the event has happened:
--   fomc_meeting -> federalreserve.gov statement (URL derivable from the date)
--   us_cpi       -> bls.gov news release archive
--   mas_mps      -> mas.gov.sg release, discovered via their site-search API
--
-- Nullable by design: future events have no result yet, and a source that can't
-- be resolved must leave the column null rather than store a guessed dead link.

alter table public.economic_calendar_events
    add column if not exists source_url text;

comment on column public.economic_calendar_events.source_url is
    'URL of the published result for this event (FOMC statement, BLS CPI release, MAS MPS). Null until the event has happened and the link is resolved.';
