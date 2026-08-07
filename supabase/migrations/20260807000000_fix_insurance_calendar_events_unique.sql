-- insurance_calendar_events was created (20260701010000_closed_won_and_calendar.sql)
-- without the same "one event per case" unique index that property_calendar_events
-- has (20260527000000_google_calendar_sync.sql). Without it, two concurrent
-- follow-up saves for the same case (e.g. a double-click on "Set reminder" — the
-- button has no in-flight guard) can both see "no existing row" in
-- syncInsuranceFollowUp and both insert, leaving two rows per case_id. Every
-- subsequent sync attempt then breaks silently: .single() on a 2-row result
-- errors, that error is swallowed by the calling function's try/catch (by
-- design, so a calendar failure never blocks the follow-up save), and the case
-- stops syncing to Google Calendar forever with no visible error to the agent.

-- Dedupe first — a UNIQUE index cannot be created over existing duplicate
-- case_id values. Keep the most recently updated row per case_id. Any stray
-- duplicate Google Calendar event left behind by a dropped duplicate row is a
-- harmless cosmetic leftover on the agent's calendar, not a data-integrity issue.
DELETE FROM public.insurance_calendar_events
WHERE id IN (
    SELECT id FROM (
        SELECT id, row_number() OVER (
            PARTITION BY case_id ORDER BY updated_at DESC, id DESC
        ) AS rn
        FROM public.insurance_calendar_events
    ) ranked
    WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS insurance_calendar_events_case_id_idx
    ON public.insurance_calendar_events(case_id);
