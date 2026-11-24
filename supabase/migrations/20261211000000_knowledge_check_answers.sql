-- "Check answers": what Claude answered, from which articles, and what agents
-- thought of it. 'report' = an agent marked an article's answer as wrong.
ALTER TABLE public.knowledge_gaps
    ADD COLUMN IF NOT EXISTS answer      text,
    ADD COLUMN IF NOT EXISTS article_ids uuid[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS cache_key   text,
    ADD COLUMN IF NOT EXISTS rating      smallint CHECK (rating IN (-1, 1));

ALTER TABLE public.knowledge_gaps DROP CONSTRAINT IF EXISTS knowledge_gaps_kind_check;
ALTER TABLE public.knowledge_gaps ADD CONSTRAINT knowledge_gaps_kind_check CHECK (kind IN ('gap', 'ai', 'report'));
