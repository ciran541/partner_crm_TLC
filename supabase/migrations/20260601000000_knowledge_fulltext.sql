-- Level 1 search upgrade: Postgres full-text search for the knowledge engine.
-- A trigger-maintained tsvector column (title + content + tags) with a GIN index.
-- A trigger is used instead of a GENERATED column because to_tsvector('english', ...)
-- is treated as non-immutable, which generated columns / expression indexes reject.
-- Gives stemming (refinance/refinancing), multi-word handling, and relevance ranking.

ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION knowledge_articles_search_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector := to_tsvector('english',
        coalesce(NEW.title, '') || ' ' ||
        coalesce(NEW.content, '') || ' ' ||
        coalesce(array_to_string(NEW.tags, ' '), ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_knowledge_search ON knowledge_articles;
CREATE TRIGGER trg_knowledge_search
    BEFORE INSERT OR UPDATE ON knowledge_articles
    FOR EACH ROW EXECUTE FUNCTION knowledge_articles_search_update();

-- Backfill existing seeded rows
UPDATE knowledge_articles SET search_vector = to_tsvector('english',
    coalesce(title, '') || ' ' ||
    coalesce(content, '') || ' ' ||
    coalesce(array_to_string(tags, ' '), ''));

CREATE INDEX IF NOT EXISTS idx_knowledge_fts ON knowledge_articles USING GIN (search_vector);
