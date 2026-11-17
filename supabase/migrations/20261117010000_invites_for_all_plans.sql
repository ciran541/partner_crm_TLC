-- Invite-only signup for EVERY plan, not just Premium.
--
-- Until now only the insurance app ("Premium") was invite-gated; the property
-- app ("Basic" / "Starter") had an open public signup. TLC HUB is now
-- invite-only across the board: an admin sends a link after payment is
-- confirmed offline, and the link alone decides which plan the account gets.
--
-- agent_invites already carries app_type; this adds the property tier so a
-- single invite fully determines the plan:
--   app_type='insurance', subscription_tier NULL        → Premium
--   app_type='property',  subscription_tier='premium'   → Basic
--   app_type='property',  subscription_tier='standard'  → Starter
-- (Display names live in lib/permissions planName(); stored values unchanged.)

ALTER TABLE public.agent_invites
    ADD COLUMN IF NOT EXISTS subscription_tier text;

-- app_type was free text with a default; pin it to the two real apps.
ALTER TABLE public.agent_invites
    ADD CONSTRAINT agent_invites_app_type_check
    CHECK (app_type IN ('insurance', 'property'));

-- A property invite must name its tier; an insurance invite must not (the
-- tier column on profiles is ignored for insurance users). Existing rows are
-- all insurance with a NULL tier, so they satisfy this as-is.
ALTER TABLE public.agent_invites
    ADD CONSTRAINT agent_invites_tier_check
    CHECK (
        (app_type = 'insurance' AND subscription_tier IS NULL)
        OR (app_type = 'property' AND subscription_tier IN ('standard', 'premium'))
    );

COMMENT ON COLUMN public.agent_invites.subscription_tier IS
    'Property invites only: standard = Starter, premium = Basic. NULL for insurance (Premium) invites.';
