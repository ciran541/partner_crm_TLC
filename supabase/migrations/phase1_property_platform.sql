-- =============================================================
-- Phase 1: Property Platform Database Migrations
-- Run each section in order in the Supabase SQL Editor.
-- All statements are idempotent where possible.
-- =============================================================


-- ─── 1A. profiles — Additive columns ─────────────────────────
-- Safe to run multiple times (IF NOT EXISTS guards).
-- Existing insurance CRM rows are NOT affected.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS full_name            text,
  ADD COLUMN IF NOT EXISTS mobile               text,
  ADD COLUMN IF NOT EXISTS cea_registration_no  text,
  ADD COLUMN IF NOT EXISTS agency_name          text,
  ADD COLUMN IF NOT EXISTS joined_at            timestamptz DEFAULT now();


-- ─── 1B. banks — Master lookup table ─────────────────────────

CREATE TABLE IF NOT EXISTS banks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  is_active   boolean     NOT NULL DEFAULT true,
  sort_order  integer     NOT NULL DEFAULT 99,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE banks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "banks_select_authenticated"
  ON banks FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "banks_admin_all"
  ON banks FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

INSERT INTO banks (name, sort_order) VALUES
  ('DBS',                 1),
  ('OCBC',                2),
  ('UOB',                 3),
  ('Standard Chartered',  4),
  ('Maybank',             5),
  ('HSBC',                6),
  ('Citibank',            7),
  ('Bank of China',       8),
  ('CIMB',                9),
  ('Hong Leong Finance', 10),
  ('RHB',                11),
  ('State Bank of India', 12)
ON CONFLICT (name) DO NOTHING;


-- ─── 1C. property_cases — Full schema ────────────────────────
-- Drop dependent tables first (all pre-launch, no real data).

DROP TABLE IF EXISTS property_case_activity_logs CASCADE;
DROP TABLE IF EXISTS property_case_documents CASCADE;
DROP TABLE IF EXISTS property_reminders CASCADE;
DROP TABLE IF EXISTS property_cases CASCADE;

DO $$ BEGIN
  CREATE TYPE property_case_type AS ENUM (
    'new_purchase', 'refinance', 'decoupling', 'equity'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE property_case_status AS ENUM (
    'draft', 'submitted', 'under_review', 'verified',
    'closed_won', 'closed_lost', 'on_hold', 'opportunity_due'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE property_commission_status AS ENUM ('pending', 'confirmed', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE property_cases (
  -- Core
  id                          uuid                       PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id                    uuid                       NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  case_type                   property_case_type         NOT NULL,
  status                      property_case_status       NOT NULL DEFAULT 'draft',

  -- Client
  client_name                 text                       NOT NULL,
  client_mobile               text                       NOT NULL,
  client_email                text,
  property_address            text                       NOT NULL,

  -- Mortgage
  bank_id                     uuid                       REFERENCES banks(id) ON DELETE SET NULL,
  interest_rate               numeric(6,4),
  balance_tenure_months       integer,
  outstanding_loan_amount     numeric(15,2),
  subsidy_amount              numeric(15,2),

  -- Lock-in
  lockin_estimated_date       date,
  lockin_confirmed_date       date,

  -- Commission (calculated server-side on submit)
  gross_commission_amount     numeric(15,2),
  agent_commission_amount     numeric(15,2),
  tlc_commission_amount       numeric(15,2),
  commission_status           property_commission_status NOT NULL DEFAULT 'pending',

  -- Projection (amortization-based, calculated server-side)
  projected_remaining_balance numeric(15,2),
  projected_gross_commission  numeric(15,2),
  projected_agent_income      numeric(15,2),
  projected_tlc_income        numeric(15,2),

  -- Recurring (filled by admin at lock-in maturity)
  actual_recurring_gross          numeric(15,2),
  actual_recurring_agent_income   numeric(15,2),
  actual_recurring_tlc_income     numeric(15,2),
  recurring_converted             boolean     NOT NULL DEFAULT false,

  -- Ops
  is_duplicate                boolean     NOT NULL DEFAULT false,
  duplicate_reason            text,
  notes                       text,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER property_cases_updated_at
  BEFORE UPDATE ON property_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX property_cases_agent_id_idx   ON property_cases(agent_id);
CREATE INDEX property_cases_status_idx     ON property_cases(status);
CREATE INDEX property_cases_created_at_idx ON property_cases(created_at DESC);

ALTER TABLE property_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pc_select" ON property_cases FOR SELECT TO authenticated USING (
  agent_id = auth.uid()
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
);

CREATE POLICY "pc_insert" ON property_cases FOR INSERT TO authenticated
  WITH CHECK (agent_id = auth.uid());

CREATE POLICY "pc_update" ON property_cases FOR UPDATE TO authenticated USING (
  (agent_id = auth.uid() AND status IN ('draft', 'submitted'))
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
);

CREATE POLICY "pc_delete" ON property_cases FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
);


-- ─── 1D. property_case_documents ─────────────────────────────

CREATE TABLE property_case_documents (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid        NOT NULL REFERENCES property_cases(id) ON DELETE CASCADE,
  file_url    text        NOT NULL,
  file_name   text        NOT NULL,
  file_type   text        NOT NULL,
  uploaded_by uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX property_case_documents_case_id_idx ON property_case_documents(case_id);

ALTER TABLE property_case_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "docs_select" ON property_case_documents FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM property_cases pc WHERE pc.id = case_id AND (
      pc.agent_id = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
    )
  )
);

CREATE POLICY "docs_insert" ON property_case_documents FOR INSERT TO authenticated WITH CHECK (
  uploaded_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM property_cases pc WHERE pc.id = case_id AND pc.agent_id = auth.uid()
  )
);

CREATE POLICY "docs_admin_delete" ON property_case_documents FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
);


-- ─── 1E. property_case_activity_logs ─────────────────────────

CREATE TABLE property_case_activity_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid        NOT NULL REFERENCES property_cases(id) ON DELETE CASCADE,
  actor_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action      text        NOT NULL,
  old_value   jsonb,
  new_value   jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX property_case_activity_logs_case_id_idx    ON property_case_activity_logs(case_id);
CREATE INDEX property_case_activity_logs_created_at_idx ON property_case_activity_logs(created_at DESC);

ALTER TABLE property_case_activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "logs_select" ON property_case_activity_logs FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM property_cases pc WHERE pc.id = case_id AND (
      pc.agent_id = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
    )
  )
);
-- INSERT goes through service role (createAdminClient) only — no direct client writes.


-- ─── 1F. property_reminders ──────────────────────────────────

DO $$ BEGIN
  CREATE TYPE reminder_type AS ENUM ('lockin_90_day');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE property_reminders (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid          NOT NULL REFERENCES property_cases(id) ON DELETE CASCADE,
  reminder_type   reminder_type NOT NULL DEFAULT 'lockin_90_day',
  trigger_date    date          NOT NULL,
  is_sent         boolean       NOT NULL DEFAULT false,
  sent_at         timestamptz,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX property_reminders_trigger_date_idx ON property_reminders(trigger_date) WHERE is_sent = false;
CREATE INDEX property_reminders_case_id_idx      ON property_reminders(case_id);

ALTER TABLE property_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reminders_select" ON property_reminders FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM property_cases pc WHERE pc.id = case_id AND (
      pc.agent_id = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
    )
  )
);
-- INSERT goes through service role only.


-- ─── 1G. Supabase Storage bucket ─────────────────────────────
-- Run this separately if storage.buckets is not accessible via SQL Editor.
-- Alternatively create the bucket named 'property-documents' via the Supabase dashboard
-- (Storage → New bucket → private).

INSERT INTO storage.buckets (id, name, public)
VALUES ('property-documents', 'property-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "agent_upload_own_folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'property-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "agent_read_own_files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'property-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
      )
    )
  );
