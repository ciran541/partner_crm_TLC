/**
 * Layer 6 — Mortgage News. Native RSS/JSON feeds from a fixed source allow-list
 * + Claude relevance filter, agent-facing read-only feed with on-demand AI
 * summaries.
 */

// Only sources with a confirmed, genuine, official feed (real article URLs, real
// content snippets) — verified by fetching each one directly. Business Times,
// EdgeProp, Bloomberg, ABS, MND, CPF Board, Straits Times, Reuters, WSJ, SRX and
// 99.co were all considered; EdgeProp's feed turned out to be property listings
// not news, SRX/99.co block automated requests even with a full realistic
// browser header set (TLS/bot-detection, not fixable by header spoofing),
// Bloomberg/Reuters have no free feed, the WSJ feed found is dead (every item
// over a year stale), Straits Times' feed (same SPH infra as BT) is broken —
// stale channel date, garbage item content — and CPF Board has no dated
// news/press-release feed, just an evergreen "Infohub" content hub. MND has a
// real press-releases page but only ~5 weeks fresh at last check, and most
// property-relevant announcements already surface via URA/HDB directly (both
// are statutory boards under MND), so it wasn't pursued further. IRAS's
// newsroom is real, clean, and technically the easiest of any source (plain
// server-rendered `<article>` markup, no WAF) — deliberately left out anyway
// after checking real relevance density: of the last 20 articles, only one was
// mortgage-relevant (the rest were tax-crime prosecutions and general tax-admin
// notices). FT and The Edge Singapore are both standard RSS feeds, no WAF
// issue, flow through the same generic RSS path as BT/CNA.
//
// MAS, URA and HDB are not RSS at all — each blocks/omits the obvious feed
// paths, so each was found by digging into the real page (MAS: the JSON API
// behind mas.gov.sg/news's search box, found via live browser DevTools; URA/HDB:
// their own recent-news list is embedded directly in the page's server-rendered
// HTML as framework state, not a separate call). See fetchMasFeed/fetchUraFeed/
// fetchHdbFeed in lib/insurance/news.ts.
export const NEWS_SOURCES = [
    { key: 'business_times', name: 'Business Times',  feedUrl: 'https://www.businesstimes.com.sg/rss.xml' },
    { key: 'cna',            name: 'CNA',              feedUrl: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?category=10416' },
    // FT's Singapore section, not the international front page. The front-page feed
    // carried only global news (oil, tariffs, Ukraine, US tech) — 156 articles
    // ingested, zero mortgage-relevant, so the FT chip was permanently empty. FT has
    // no property/mortgages feed (that slug 404s); the section feeds do work, and
    // /singapore is the one with any chance of SG policy, bank and property content.
    { key: 'ft',             name: 'Financial Times',  feedUrl: 'https://www.ft.com/singapore?format=rss' },
    { key: 'edge_sg',        name: 'The Edge Singapore', feedUrl: 'https://www.theedgesingapore.com/rss.xml' },
    { key: 'mas',            name: 'MAS',              feedUrl: 'https://www.mas.gov.sg/api/v1/search?json.nl=map&indent=on&q=*:*&start=0&rows=30&fq=mas_mastercontenttypes_sm:%22News%22&sort=mas_date_tdt%20desc' },
    { key: 'ura',            name: 'URA',              feedUrl: 'https://www.ura.gov.sg/news/media/' },
    { key: 'hdb',            name: 'HDB',              feedUrl: 'https://www.hdb.gov.sg/hdb-pulse/news' },
] as const

export type NewsSourceKey = (typeof NEWS_SOURCES)[number]['key']

export interface NewsArticle {
    id: string
    source: string
    feed_key: string
    title: string
    url: string
    guid: string | null
    published_at: string
    description: string | null
    image_url: string | null    // real photo when the source provides one (e.g. CNA's <media:thumbnail>), else null
    category: string | null     // real publisher category when available (BT's <category>, MAS's content type), else null
    is_relevant: boolean | null
    relevance_reason: string | null
    summary: string | null
    summary_generated_at: string | null
    hidden: boolean
    is_manual: boolean
    created_at?: string
    updated_at?: string
}

// Input for an admin QA one-off addition — not the automated ingestion path.
export interface NewsArticleInput {
    source: string
    feed_key: string
    title: string
    url: string
    description?: string | null
    published_at: string
}

/**
 * Only render a stored article URL as a link when it is a real http(s) URL.
 * URLs enter the table from RSS feeds and admin manual adds; a hostile or
 * malformed value (e.g. a javascript: URI) must never become a clickable href.
 * Returns the URL unchanged when safe, null otherwise.
 */
export function safeHttpUrl(url: string | null | undefined): string | null {
    if (!url) return null
    try {
        const parsed = new URL(url)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null
    } catch {
        return null
    }
}
