-- Layer 6 (resources): auto-curated mortgage-relevant news from a fixed source
-- allow-list (Business Times, EdgeProp, Bloomberg, MAS, URA, CNA, MND). Ingested
-- daily via Google News site-scoped RSS queries (native feeds for these
-- publishers could not be confirmed reachable — see lib/insurance/news.ts),
-- filtered to recent items, classified for mortgage/property-finance relevance
-- by Gemini, with cached one-click AI summaries.

CREATE TABLE IF NOT EXISTS mortgage_news_articles (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source                text NOT NULL,   -- display name, e.g. 'Business Times'
    feed_key              text NOT NULL,   -- stable key matching NEWS_SOURCES in lib/types/news.ts
    title                 text NOT NULL,
    url                   text NOT NULL,
    guid                  text,
    published_at          timestamptz NOT NULL,
    description           text,            -- source snippet — the only text fed to Gemini (no scraping)
    is_relevant           boolean,         -- null = not yet classified
    relevance_reason      text,
    summary               text,            -- cached one-click AI summary
    summary_generated_at  timestamptz,
    hidden                boolean NOT NULL DEFAULT false,
    is_manual             boolean NOT NULL DEFAULT false,  -- admin QA addition; not part of the required ingestion path
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (url)
);

CREATE INDEX IF NOT EXISTS idx_mortgage_news_published ON mortgage_news_articles (published_at DESC);

COMMENT ON TABLE mortgage_news_articles IS 'Auto-curated mortgage/property-finance news, ingested daily via Google News site-scoped RSS + Gemini relevance filter.';

-- RLS on; all access via service-role server routes (cron writes, agents/admins read via API).
ALTER TABLE mortgage_news_articles ENABLE ROW LEVEL SECURITY;
