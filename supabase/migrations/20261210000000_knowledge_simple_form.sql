-- Simple Knowledge form: where each answer came from and who checked it.
ALTER TABLE public.knowledge_articles
    ADD COLUMN IF NOT EXISTS source     text,
    ADD COLUMN IF NOT EXISTS checked_by text,
    ADD COLUMN IF NOT EXISTS checked_on date;

-- Questions Claude had to answer sit beside the gaps, so an admin can turn them
-- into free articles. 'ai' rows are deleted after 90 days by the ask route.
ALTER TABLE public.knowledge_gaps
    ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'gap' CHECK (kind IN ('gap', 'ai'));

-- Every earlier version of an article, so no edit or delete loses the original.
CREATE TABLE IF NOT EXISTS public.knowledge_article_history (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    article_id uuid NOT NULL,
    action     text NOT NULL,
    old_row    jsonb NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_article_history_article_idx ON public.knowledge_article_history (article_id, changed_at DESC);
ALTER TABLE public.knowledge_article_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.knowledge_article_history FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.knowledge_articles_keep_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'DELETE'
       OR (OLD.title, OLD.content, OLD.tags, OLD.status, OLD.source, OLD.checked_by, OLD.checked_on)
          IS DISTINCT FROM (NEW.title, NEW.content, NEW.tags, NEW.status, NEW.source, NEW.checked_by, NEW.checked_on) THEN
        INSERT INTO knowledge_article_history (article_id, action, old_row)
        VALUES (OLD.id, lower(TG_OP), to_jsonb(OLD) - 'embedding' - 'search_vector');
    END IF;
    RETURN COALESCE(NEW, OLD);
END $$;
REVOKE ALL ON FUNCTION public.knowledge_articles_keep_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_knowledge_history ON public.knowledge_articles;
CREATE TRIGGER trg_knowledge_history AFTER UPDATE OR DELETE ON public.knowledge_articles
    FOR EACH ROW EXECUTE FUNCTION public.knowledge_articles_keep_history();
