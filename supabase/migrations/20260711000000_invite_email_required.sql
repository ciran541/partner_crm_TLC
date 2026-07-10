-- Require an invited_email on every agent invite going forward. Previously
-- optional, which meant a leaked/forwarded link with no email attached could
-- be claimed by anyone, active immediately, with zero identity check.
-- Enforced at the DB level too, not just the API, as defense-in-depth.
ALTER TABLE public.agent_invites
    ALTER COLUMN invited_email SET NOT NULL;
