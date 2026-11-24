-- Saved Knowledge answers, so an identical question isn't paid for twice.
-- `key` is a hash of the question, the exact articles and the instructions
-- (lib/insurance/answerCache.ts), so editing an article never serves an old answer.
CREATE TABLE IF NOT EXISTS public.ai_answer_cache (
    key        text PRIMARY KEY,
    answer     text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_answer_cache_created_at_idx ON public.ai_answer_cache (created_at);

-- Service role only: no client policies.
ALTER TABLE public.ai_answer_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_answer_cache FROM anon, authenticated;
