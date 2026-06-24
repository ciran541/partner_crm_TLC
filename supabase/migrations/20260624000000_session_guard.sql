-- Single-session enforcement: tracks the active session token per user.
-- When a new login happens, this is updated, invalidating any other active sessions.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_session_id uuid;
