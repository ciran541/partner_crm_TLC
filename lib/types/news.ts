/**
 * Layer 6 — Mortgage News. Native RSS from a fixed source allow-list + Gemini
 * relevance filter, agent-facing read-only feed with on-demand AI summaries.
 */

// Only sources with a confirmed, genuine, official native RSS feed (real article
// URLs, real content snippets, no ToS ambiguity) — verified by fetching each feed
// directly and inspecting the raw XML. Business Times, EdgeProp, Bloomberg, MAS,
// URA, CNA and MND were all considered; only Business Times and CNA had a working
// native feed with real news content (EdgeProp's feed turned out to be property
// listings, not news; MAS/URA/MND blocked automated requests; Bloomberg has no
// free feed at all). Scope intentionally kept to these two rather than padding
// the list with a lower-quality/riskier fallback mechanism for the rest.
export const NEWS_SOURCES = [
    { key: 'business_times', name: 'Business Times', rssUrl: 'https://www.businesstimes.com.sg/rss.xml' },
    { key: 'cna',            name: 'CNA',             rssUrl: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?category=10416' },
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
    category: string | null     // real publisher category when available (e.g. Business Times' <category>), else null
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
