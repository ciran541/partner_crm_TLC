-- Closed-Won enrichment + insurance follow-up calendar sync
--
-- 1. Structured Closed-Won data: per-loan amounts/tenures, the chosen package
--    schedule, Letter-of-Offer document refs, and the computed combined
--    outstanding after lock-in (used for next-cycle income projection).
ALTER TABLE public.cases
    ADD COLUMN IF NOT EXISTS closed_won_data jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Insurance follow-up calendar events (mirrors property_calendar_events, but
--    FK's to cases). Accessed only server-side via the service-role admin client,
--    which bypasses RLS — so RLS is enabled with no client policies.
CREATE TABLE IF NOT EXISTS public.insurance_calendar_events (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
    agent_id uuid NOT NULL,
    google_event_id text NOT NULL,
    calendar_target text NOT NULL DEFAULT 'self'::text,
    event_date date NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);
ALTER TABLE public.insurance_calendar_events ENABLE ROW LEVEL SECURITY;

-- 3. Storage bucket for Letter-of-Offer documents (PDF / images).
INSERT INTO storage.buckets (id, name, public)
VALUES ('insurance-documents', 'insurance-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "ins_agent_upload_own_folder" ON storage.objects;
CREATE POLICY "ins_agent_upload_own_folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'insurance-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "ins_agent_read_own_files" ON storage.objects;
CREATE POLICY "ins_agent_read_own_files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'insurance-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
      )
    )
  );
