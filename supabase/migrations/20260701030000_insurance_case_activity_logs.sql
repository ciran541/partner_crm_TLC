-- Audit trail for admin actions on insurance cases (mirrors property_case_activity_logs).
-- Written server-side via the service-role admin client (RLS on, no client policies).
CREATE TABLE IF NOT EXISTS public.insurance_case_activity_logs (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
    actor_id uuid NOT NULL,
    action text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);
ALTER TABLE public.insurance_case_activity_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS insurance_case_activity_logs_case_id_idx
    ON public.insurance_case_activity_logs (case_id, created_at DESC);
