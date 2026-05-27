-- Migration: Google Calendar Sync for Property Agent Follow-Up Dates
-- Adds OAuth token storage per agent and event tracking table

-- Add Google OAuth columns to profiles table
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS google_refresh_token text,
  ADD COLUMN IF NOT EXISTS google_calendar_connected boolean NOT NULL DEFAULT false;

-- Track created Google Calendar events so we can update/delete them
CREATE TABLE IF NOT EXISTS property_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES property_cases(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL,
  google_event_id text NOT NULL,
  calendar_target text NOT NULL DEFAULT 'agent', -- 'agent' | 'tlc'
  event_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One calendar event per case (unique on case_id)
CREATE UNIQUE INDEX IF NOT EXISTS property_calendar_events_case_id_idx
  ON property_calendar_events(case_id);
