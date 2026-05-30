-- Enable RLS on property_calendar_events
-- All writes go through the service role (admin client) so backend ops are unaffected.
-- These policies only govern direct client-side access.

ALTER TABLE property_calendar_events ENABLE ROW LEVEL SECURITY;

-- Agents can read their own calendar event rows
CREATE POLICY "Agents can view own calendar events"
  ON property_calendar_events
  FOR SELECT
  TO authenticated
  USING (agent_id = auth.uid());

-- Admins can read all rows
CREATE POLICY "Admins can view all calendar events"
  ON property_calendar_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- No client-side INSERT / UPDATE / DELETE — all writes use the service role only
