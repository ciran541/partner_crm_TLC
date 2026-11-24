-- Free Gemini calls are now logged too: their successes must not hide a Claude
-- account problem, so the warning looks at Claude rows only.
CREATE OR REPLACE FUNCTION public.ai_spend()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT to_char(created_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD') AS day, feature, model, environment,
               count(*) AS calls, count(failure) AS failed, SUM(input_tokens) AS input, SUM(output_tokens) AS output,
               COALESCE(SUM(cost_usd), 0) AS cost, count(*) FILTER (WHERE cost_usd IS NULL) AS unpriced
        FROM ai_usage WHERE created_at >= now() - interval '25 months'
        GROUP BY 1, 2, 3, 4) x), '[]'::jsonb),
    'account_problem_at', (SELECT max(created_at) FROM ai_usage WHERE failure = 'account' AND environment = 'production'
        AND created_at > COALESCE((SELECT max(created_at) FROM ai_usage
            WHERE failure IS NULL AND environment = 'production' AND model LIKE 'claude-%'), '-infinity'))
)
$$;
