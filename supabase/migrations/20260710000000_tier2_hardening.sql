-- Tier 2 hardening: storage upload limits + admin audit log.

-- 1. Storage buckets had no server-side file-size/MIME-type limit — client
-- JS validated (PDF/JPEG/PNG, 10MB) but a direct upload bypassing the
-- browser wasn't stopped server-side. Match the same limits at the bucket
-- level so enforcement doesn't depend on trusting the client.
UPDATE storage.buckets
SET file_size_limit = 10485760, -- 10 MB
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png']
WHERE id IN ('property-documents', 'insurance-documents');

-- 2. Admin action audit log — user creation, role/status changes, password
-- resets, and invite generation/revocation were previously untraceable
-- after the fact (console.error only). All access is via service-role
-- server routes (write on each admin action, read on the admin viewer page).
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    uuid REFERENCES public.profiles(id),
    action      text NOT NULL,
    target_type text,
    target_id   uuid,
    details     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON public.admin_audit_log (created_at DESC);

COMMENT ON TABLE public.admin_audit_log IS 'Admin action history (user create/update, password resets, invite create/revoke). Written by admin API routes, read by the /admin/audit-log viewer.';

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
