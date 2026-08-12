-- Paid feature tier for the Property CRM ("premium" onboarding tier, sold
-- separately from the base app — see project notes). Only meaningful for
-- property agents; insurance rows just sit at the default and are never
-- checked. Lives on the shared profiles table like other property-specific
-- fields (cea_registration_no, agency_name) already do — a dedicated
-- subscriptions table can replace this later if billing history/expiry is
-- ever needed, not required for a manually admin-assigned flag.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS subscription_tier text NOT NULL DEFAULT 'standard';

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_subscription_tier_check
    CHECK (subscription_tier IN ('standard', 'premium'));
