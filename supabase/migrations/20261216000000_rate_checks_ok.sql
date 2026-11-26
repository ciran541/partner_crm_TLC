-- Rate warnings an admin has checked and marked as correct, so they stop showing.
-- The key includes the warning's text, which includes the figures, so if the
-- packages change in a way that matters the warning comes back by itself.
CREATE TABLE IF NOT EXISTS public.rate_checks_ok (
    key        text PRIMARY KEY,
    bank       text NOT NULL,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_checks_ok_bank ON public.rate_checks_ok (bank);

-- All access goes through guarded server routes.
ALTER TABLE public.rate_checks_ok ENABLE ROW LEVEL SECURITY;
