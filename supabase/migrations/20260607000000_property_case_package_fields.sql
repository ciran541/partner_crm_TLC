-- Add mortgage package detail columns to property_cases so agents can recall
-- exactly what package was submitted (category, banker, rates, etc.) when following up.

ALTER TABLE property_cases
  ADD COLUMN IF NOT EXISTS case_category        varchar(20),
  ADD COLUMN IF NOT EXISTS banker_name          varchar(255),
  ADD COLUMN IF NOT EXISTS property_type        varchar(255),
  ADD COLUMN IF NOT EXISTS package_type         varchar(20),
  ADD COLUMN IF NOT EXISTS free_conversion      integer,
  ADD COLUMN IF NOT EXISTS fixed_years          integer,
  ADD COLUMN IF NOT EXISTS floating_rate_type   varchar(50),
  ADD COLUMN IF NOT EXISTS year_rates           jsonb,
  ADD COLUMN IF NOT EXISTS letter_of_offer_date date;
