-- One row per AI call (written by lib/ai/claude.ts), behind Admin > AI Spend.
-- Holds token counts and cost only, never what was sent or answered.
CREATE TABLE IF NOT EXISTS public.ai_usage (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at    timestamptz NOT NULL DEFAULT now(),
    feature       text NOT NULL,
    model         text NOT NULL,
    environment   text NOT NULL,
    input_tokens  integer NOT NULL DEFAULT 0,
    output_tokens integer NOT NULL DEFAULT 0,
    cost_usd      numeric(12, 6),          -- NULL = model has no known price
    failure       text                     -- NULL = worked
);
CREATE INDEX IF NOT EXISTS ai_usage_created_at_idx ON public.ai_usage (created_at);

-- Service role only: no client policies.
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.ai_spend()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT to_char(created_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD') AS day, feature, model, environment,
               count(*) AS calls, count(failure) AS failed, SUM(input_tokens) AS input, SUM(output_tokens) AS output,
               COALESCE(SUM(cost_usd), 0) AS cost, count(*) FILTER (WHERE cost_usd IS NULL) AS unpriced
        FROM ai_usage WHERE created_at >= now() - interval '25 months'
        GROUP BY 1, 2, 3, 4) x), '[]'::jsonb),
    -- Set only while production's newest account problem is newer than its last success.
    'account_problem_at', (SELECT max(created_at) FROM ai_usage WHERE failure = 'account' AND environment = 'production'
        AND created_at > COALESCE((SELECT max(created_at) FROM ai_usage WHERE failure IS NULL AND environment = 'production'), '-infinity'))
)
$$;
REVOKE ALL ON FUNCTION public.ai_spend() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_spend() TO service_role;
