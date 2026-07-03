-- Real per-article data confirmed available in the native feeds (not synthesized):
-- CNA's feed carries a genuine <media:thumbnail> on every item; Business Times'
-- feed carries genuine <category> tags. Both were previously discarded — this
-- persists them so the UI can show a real photo (CNA) and a category badge (BT).
ALTER TABLE mortgage_news_articles
    ADD COLUMN IF NOT EXISTS image_url text,
    ADD COLUMN IF NOT EXISTS category text;
