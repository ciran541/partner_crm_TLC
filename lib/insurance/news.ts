/**
 * Mortgage News — ingestion, relevance classification, and AI summaries.
 *
 * Sourcing: NEWS_SOURCES (lib/types/news.ts) lists each publisher's genuine feed,
 * confirmed working by fetching it directly (real article URLs, real content
 * snippets, official endpoints — no ToS ambiguity, unlike the Google News
 * site-scoped search trick this replaced). Scope was deliberately narrowed to
 * Business Times + CNA + MAS rather than padding the list with a lower-quality/
 * riskier mechanism for publishers that don't have a working feed (EdgeProp's
 * only feed is property listings not news; URA/HDB/SRX/99.co block automated
 * requests site-wide; Bloomberg/Reuters have no free feed; a WSJ feed exists but
 * is dead — every item over a year stale).
 *
 * MAS is not RSS — it's fetched from their own site-search JSON API (the same
 * one that powers the search box on mas.gov.sg/news), found by inspecting the
 * real browser network request behind that page and confirmed public with a
 * bare curl (no cookies/session/auth needed). See fetchMasFeed() below.
 *
 * Business Times' feed carries genuine per-item <category> tags (confirmed via
 * the raw XML), so BT_RELEVANT_CATEGORIES pre-filters to only categories that
 * could plausibly be mortgage-relevant before anything reaches Claude — cuts
 * obvious noise (Arts & Design, Sports, etc.) for free and reduces Claude call
 * volume. CNA and MAS have no comparably reliable category scoping to pre-filter
 * on (MAS's content types are a mix of clearly-relevant and ambiguous — e.g.
 * "Parliamentary Replies" spans everything from property cooling measures to
 * unrelated topics), so both rely on Claude classification alone.
 *
 * Claude is used two ways here, both degrading to null on any failure so a bad
 * API call never blocks ingestion or shows a false positive:
 *  - classifyBatch (newsClassify.ts): relevance gate (never assume relevant on failure)
 *  - summarizeArticle: plain-text 2-3 sentence summary, from title+snippet only
 *    (never scraped article HTML — avoids paywall/ToS issues)
 */

import Parser from 'rss-parser'
import { callFreeFirst } from '@/lib/ai/freeFirst'
import { classifyBatch, NEWS_BATCH } from '@/lib/insurance/newsClassify'
import { createAdminClient } from '@/lib/supabase/admin'
import { NEWS_SOURCES } from '@/lib/types/news'
import type { NewsArticle, NewsArticleInput } from '@/lib/types/news'

const STALE_DAYS = 7
// Confirmed via the raw Business Times feed (grep of every <category> value
// across a real fetch) — this is the subset plausibly relevant to mortgages/
// property, out of a much larger taxonomy that includes Arts & Design, Sports,
// Lifestyle, Startups & Tech, etc.
const BT_RELEVANT_CATEGORIES = new Set([
    'Property', 'Residential', 'Commercial & Industrial',
    'Banking & Finance', 'Capital Markets & Currencies',
    'Wealth', 'Wealth & Investing', 'Economy & Policy',
])
// Caps keep a single cron/refresh run bounded (Vercel maxDuration = 60s below):
// rss-parser has no default fetch timeout, so one slow/blocked feed could hang
// the whole run; MAX_NEW_PER_RUN keeps a large first-time backlog from blowing
// the time budget. Uninserted candidates aren't lost — they're not yet in the
// DB, so they're simply reconsidered next run.
//
// Classification runs in batches (newsClassify.ts), one batch at a time.
const FEED_TIMEOUT_MS = 15000
const MAX_NEW_PER_RUN = 60
const MAX_CLASSIFY_PER_RUN = 75
const CLASSIFY_START_BUDGET_MS = 25000   // leaves room under maxDuration=60

// MAS and HDB's WAFs return a decoy/error page instead of real content to
// requests without a browser-like User-Agent (confirmed live per-site: Node's
// default fetch UA gets blocked, this exact header gets the real page back).
// URA doesn't need this (a bare fetch works), but it's harmless to send anyway.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

// media:thumbnail isn't one of rss-parser's standard fields, so it needs an
// explicit customFields entry — confirmed via a live test fetch that CNA's feed
// carries a real photo (830x468, their own CDN) on every item this way.
type RawItem = { 'media:thumbnail'?: { $?: { url?: string } } }
const parser = new Parser<object, RawItem>({
    timeout: FEED_TIMEOUT_MS,
    customFields: { item: ['media:thumbnail'] },
})

interface FeedItem {
    title: string
    link: string
    guid: string | null
    publishedAt: string | null
    description: string | null
    imageUrl: string | null
    category: string | null
}

async function fetchFeed(source: (typeof NEWS_SOURCES)[number]): Promise<FeedItem[]> {
    if (source.key === 'mas') return fetchMasFeed(source.feedUrl)
    if (source.key === 'ura') return fetchUraFeed(source.feedUrl)
    if (source.key === 'hdb') return fetchHdbFeed(source.feedUrl)
    try {
        const feed = await parser.parseURL(source.feedUrl)
        let items = feed.items ?? []
        if (source.key === 'business_times') {
            items = items.filter(item => (item.categories ?? []).some(c => BT_RELEVANT_CATEGORIES.has(c)))
        }
        return items
            .map(item => ({
                title: (item.title ?? '').trim(),
                link: item.link ?? '',
                guid: item.guid ?? null,
                publishedAt: item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : null),
                description: (item.contentSnippet ?? item.content ?? '').trim() || null,
                imageUrl: item['media:thumbnail']?.$?.url ?? null,
                category: item.categories?.find(c => BT_RELEVANT_CATEGORIES.has(c)) ?? null,
            }))
            .filter(i => i.title && i.link)
    } catch (e) {
        console.error(`[news] fetchFeed(${source.key}) threw:`, String(e))
        return []
    }
}

// MAS's own site-search API (Sitecore/Solr-backed — same endpoint that powers
// the search box on mas.gov.sg/news), not RSS, so it gets its own fetch path
// rather than going through rss-parser. Confirmed via a live browser DevTools
// inspection + a follow-up bare curl (no cookies/session) that it's a plain
// public JSON endpoint — it's the same data already shown on MAS's own public
// news page, just fetched directly instead of via their frontend JS.
interface MasSearchDoc {
    document_title_string_s?: string
    page_url_s?: string
    itemid_s?: string
    mas_date_tdt?: string
    document_shortsummary_t?: string[] | string
    mas_contenttype_s?: string
}

async function fetchMasFeed(apiUrl: string): Promise<FeedItem[]> {
    try {
        const res = await fetch(apiUrl, {
            // MAS's WAF returns a decoy HTML page instead of JSON to requests without
            // a browser-like User-Agent (confirmed live: Node's default fetch UA gets
            // "<!DOCTYPE ..." back, the same request with this header gets real JSON).
            headers: {
                Accept: 'application/json',
                'User-Agent': BROWSER_UA,
                Referer: 'https://www.mas.gov.sg/news',
            },
            signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        const docs: MasSearchDoc[] = json?.response?.docs ?? []
        return docs
            .map(doc => {
                const summary = Array.isArray(doc.document_shortsummary_t)
                    ? doc.document_shortsummary_t[0]
                    : doc.document_shortsummary_t
                return {
                    title: (doc.document_title_string_s ?? '').trim(),
                    link: doc.page_url_s ? `https://www.mas.gov.sg${doc.page_url_s}` : '',
                    guid: doc.itemid_s ?? null,
                    publishedAt: doc.mas_date_tdt ?? null,
                    description: (summary ?? '').trim() || null,
                    imageUrl: null,
                    category: doc.mas_contenttype_s ?? null,
                }
            })
            .filter(i => i.title && i.link)
    } catch (e) {
        console.error('[news] fetchMasFeed threw:', String(e))
        return []
    }
}

// A JSON string value's raw text, still escaped (e.g. "&" for "&") — used
// to unescape values pulled out of embedded framework JSON with plain regexes
// below, rather than hand-rolling entity decoding.
function jsonUnescape(raw: string): string {
    try {
        return JSON.parse(`"${raw}"`)
    } catch {
        return raw
    }
}

// URA's news/media page embeds its full recent press-release list directly in
// the page's server-rendered HTML as Next.js React Server Component state —
// not a separate API call, and no WAF/User-Agent gotcha like MAS or HDB below.
// Confirmed live: 300+ items in one fetch, dates within days of today. The data
// sits inside a <script> tag as an escaped JSON string, e.g.
//   \"id\":\"/news/media/pr26-53\",\"date\":\"$D2026-07-03T00:00:00.000Z\",\"category\":\"Press Releases\",\"title\":\"...\"
// so it's pulled out with a plain regex rather than a proper parser (there's no
// clean boundary to hand to JSON.parse) — fragile to a URA frontend redesign,
// same trade-off already accepted for MAS's search API.
async function fetchUraFeed(pageUrl: string): Promise<FeedItem[]> {
    try {
        const res = await fetch(pageUrl, {
            headers: { 'User-Agent': BROWSER_UA },
            signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const html = await res.text()

        const re = /\\"id\\":\\"(\/news\/media\/[a-z0-9-]+)\\",\\"date\\":\\"\$D([^\\]+)\\",\\"category\\":\\"([^\\]*)\\",\\"title\\":\\"([^\\]*)\\"/g
        const seen = new Set<string>()
        const items: FeedItem[] = []
        let m: RegExpExecArray | null
        while ((m = re.exec(html)) !== null) {
            const [, path, date, category, rawTitle] = m
            if (seen.has(path)) continue
            seen.add(path)
            const title = jsonUnescape(rawTitle).trim()
            if (!title) continue
            items.push({
                title,
                link: `https://www.ura.gov.sg${path}`,
                guid: path,
                publishedAt: date,
                description: null,
                imageUrl: null,
                category: jsonUnescape(category) || null,
            })
        }
        return items
    } catch (e) {
        console.error('[news] fetchUraFeed threw:', String(e))
        return []
    }
}

// HDB's news listing embeds its article list the same way URA's does (framework
// state in the page HTML, not a separate call), but in a different shape —
// Sitecore-style {"url":{"path":...},"fields":[{"name":"publishedDate","value":
// "20260630T160000Z"},{"name":"metaDescription","value":"..."},{"name":
// "navigationTitle"|"pageTitle","value":"..."}]} — and it needs the same bare
// User-Agent workaround as MAS (a header-less fetch gets a 403). Each item's
// search window is bounded to the next item's start so a malformed/sparse entry
// can't accidentally pick up a neighbouring item's fields.
function hdbDateToIso(raw: string): string {
    const y = raw.slice(0, 4), mo = raw.slice(4, 6), d = raw.slice(6, 8)
    const hh = raw.slice(9, 11), mi = raw.slice(11, 13), ss = raw.slice(13, 15)
    return `${y}-${mo}-${d}T${hh}:${mi}:${ss}Z`
}

async function fetchHdbFeed(pageUrl: string): Promise<FeedItem[]> {
    try {
        const res = await fetch(pageUrl, {
            headers: { 'User-Agent': BROWSER_UA },
            signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const html = await res.text()

        const urlRe = /"url":\{"path":"(\/hdb-pulse\/news\/[^"]+)"/g
        const matches: { path: string; start: number }[] = []
        let m: RegExpExecArray | null
        while ((m = urlRe.exec(html)) !== null) matches.push({ path: m[1], start: m.index })

        const seen = new Set<string>()
        const items: FeedItem[] = []
        matches.forEach(({ path, start }, i) => {
            if (seen.has(path)) return
            const end = matches[i + 1]?.start ?? start + 2000
            const windowText = html.slice(start, end)
            const dateM = windowText.match(/"publishedDate","value":"(\d{8}T\d{6}Z)"/)
            const titleM = windowText.match(/"(?:navigationTitle|pageTitle)","value":"([^"]*)"/)
            if (!dateM || !titleM) return
            const title = jsonUnescape(titleM[1]).trim()
            if (!title) return
            seen.add(path)
            const descM = windowText.match(/"metaDescription","value":"([^"]*)"/)
            items.push({
                title,
                link: `https://www.hdb.gov.sg${path}`,
                guid: path,
                publishedAt: hdbDateToIso(dateM[1]),
                description: jsonUnescape(descM?.[1] ?? '').trim() || null,
                imageUrl: null,
                category: null,
            })
        })
        return items
    } catch (e) {
        console.error('[news] fetchHdbFeed threw:', String(e))
        return []
    }
}

// ── AI: public headlines only, so free Gemini first (lib/ai/freeFirst.ts) ─────

const SUMMARY_SYSTEM = `You summarize a Singapore mortgage/property-finance news item for a loan advisory agent. Using ONLY the title and snippet given, write 2-3 plain-English sentences explaining what happened and, where the snippet supports it, why it matters for mortgage rates or the property market. Do not invent facts beyond what is given.

Often no real snippet is available — just the headline. In that case, do not pad the summary with invented specifics or generic filler to make it sound fuller. Give a brief, honest restatement of what the headline itself says, and it is fine for this to be short.`

export async function summarizeArticle(title: string, description: string | null): Promise<string | null> {
    return callFreeFirst({
        label: 'news-summary',
        system: SUMMARY_SYSTEM,
        user: `Title: ${title}\nSnippet: ${description || '(none)'}`,
        maxTokens: 500,
        thinking: 'off',
        freeTimeoutMs: 10000,
        timeoutMs: 20000,
    })
}

// ── Ingestion ────────────────────────────────────────────────────────────────

/**
 * Cron entrypoint: fetch every source, store what's new from the last STALE_DAYS,
 * then classify in batches. Rows a run couldn't classify stay NULL (hidden from
 * agents) and are picked up by the next run while still in that window.
 */
export async function ingestAll(): Promise<{ inserted: number } | null> {
    const admin = createAdminClient()
    const startedAt = Date.now()
    const cutoff = startedAt - STALE_DAYS * 24 * 60 * 60 * 1000

    const candidates: { source: (typeof NEWS_SOURCES)[number]; item: FeedItem }[] = []
    for (const source of NEWS_SOURCES) {
        const items = await fetchFeed(source)
        for (const item of items) {
            if (!item.publishedAt || new Date(item.publishedAt).getTime() < cutoff) continue
            candidates.push({ source, item })
        }
    }

    const { data: existingRows } = candidates.length
        ? await admin.from('mortgage_news_articles').select('url').in('url', candidates.map(c => c.item.link))
        : { data: [] }
    const existingUrls = new Set((existingRows ?? []).map(r => r.url as string))

    // Newest first, capped — bounds the DB-write side of a run regardless of how
    // large the backlog is; anything left over is picked up on the next run.
    const newCandidates = candidates
        .filter(c => !existingUrls.has(c.item.link))
        .sort((a, b) => (b.item.publishedAt ?? '').localeCompare(a.item.publishedAt ?? ''))
        .slice(0, MAX_NEW_PER_RUN)

    let inserted = 0
    for (const { source, item } of newCandidates) {
        // upsert + ignoreDuplicates rather than insert: a stray duplicate URL
        // (e.g. two near-identical feed entries for the same story) should skip
        // that one row, not fail the whole call.
        const { error } = await admin
            .from('mortgage_news_articles')
            .upsert({
                source: source.name,
                feed_key: source.key,
                title: item.title,
                url: item.link,
                guid: item.guid,
                published_at: item.publishedAt,
                description: item.description,
                image_url: item.imageUrl,
                category: item.category,
            }, { onConflict: 'url', ignoreDuplicates: true })
        if (error) console.error('[news] insert failed:', error.message)
        else inserted++
    }

    const { data: pending, error: pendingError } = await admin
        .from('mortgage_news_articles')
        .select('id, title, description')
        .is('is_relevant', null)
        .eq('is_manual', false)
        .gte('published_at', new Date(cutoff).toISOString())
        .order('published_at', { ascending: false })
        .limit(MAX_CLASSIFY_PER_RUN)
    if (pendingError) console.error('[news] loading unclassified failed:', pendingError.message)

    const rows = pending ?? []
    for (let i = 0; i < rows.length; i += NEWS_BATCH) {
        // A batch can take ~27s if both providers time out; don't start late.
        if (i > 0 && Date.now() - startedAt >= CLASSIFY_START_BUDGET_MS) break
        const batch = rows.slice(i, i + NEWS_BATCH)
        const verdicts = await classifyBatch(batch)
        await Promise.all(batch.map(async (row, n) => {
            const v = verdicts[n]
            if (!v) return
            // .is(null): never overwrite an admin's override made meanwhile.
            const { error } = await admin
                .from('mortgage_news_articles')
                .update({ is_relevant: v.isRelevant, relevance_reason: v.reason, updated_at: new Date().toISOString() })
                .eq('id', row.id)
                .is('is_relevant', null)
            if (error) console.error('[news] saving verdict failed:', error.message)
        }))
    }

    return { inserted }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** One page of articles plus the total matching the same filters (for "N remaining"). */
export interface NewsPage {
    data: NewsArticle[]
    total: number
}

export const NEWS_STATUS_FILTERS = ['relevant', 'not_relevant', 'unclassified', 'hidden'] as const
export type NewsStatusFilter = (typeof NEWS_STATUS_FILTERS)[number]

export interface NewsPageQuery {
    offset?: number
    limit?: number
    source?: string                 // feed_key
    search?: string                 // title substring (admin only)
    status?: NewsStatusFilter       // admin only — the agent feed is always "relevant, not hidden"
}

const MAX_PAGE = 50

/** Clamp paging input from a query string so a bad/huge value can't pull the whole table. */
export function parseNewsPageQuery(params: URLSearchParams, defaultLimit: number): NewsPageQuery {
    const int = (v: string | null, d: number) => {
        const n = Number.parseInt(v ?? '', 10)
        return Number.isFinite(n) && n >= 0 ? n : d
    }
    const status = params.get('status')
    return {
        offset: int(params.get('offset'), 0),
        limit: Math.min(Math.max(int(params.get('limit'), defaultLimit), 1), MAX_PAGE),
        source: params.get('source')?.trim() || undefined,
        search: params.get('search')?.trim().slice(0, 100) || undefined,
        status: (NEWS_STATUS_FILTERS as readonly string[]).includes(status ?? '') ? status as NewsStatusFilter : undefined,
    }
}

/**
 * ilike treats % and _ (and PostgREST also *) as wildcards. Backslash-escaping
 * them works in raw SQL but was confirmed live NOT to survive PostgREST (a search
 * for "50%_" still matched 101 titles), so they are replaced with a space
 * instead — a headline search never genuinely needs a literal % or _.
 */
const likeEscape = (s: string) => s.replace(/[\\%_*]/g, ' ').replace(/\s+/g, ' ').trim()

/** Agent-facing feed: relevant, non-hidden articles, most recent first. */
export async function getPublishedArticles(q: NewsPageQuery = {}): Promise<NewsPage> {
    const offset = q.offset ?? 0
    const limit = q.limit ?? 20
    let query = createAdminClient()
        .from('mortgage_news_articles')
        .select('*', { count: 'exact' })
        .eq('is_relevant', true)
        .eq('hidden', false)
    if (q.source) query = query.eq('feed_key', q.source)
    const { data, count, error } = await query
        .order('published_at', { ascending: false })
        .range(offset, offset + limit - 1)
    if (error) console.error('[news] published page failed:', error.message)
    return { data: (data ?? []) as NewsArticle[], total: count ?? 0 }
}

/** Admin view: everything, including unclassified/irrelevant/hidden. */
export async function getAllArticles(q: NewsPageQuery = {}): Promise<NewsPage> {
    const offset = q.offset ?? 0
    const limit = q.limit ?? 25
    let query = createAdminClient()
        .from('mortgage_news_articles')
        .select('*', { count: 'exact' })
    if (q.source) query = query.eq('feed_key', q.source)
    const search = q.search ? likeEscape(q.search) : ''
    if (search) query = query.ilike('title', `%${search}%`)
    // Mirrors the status badge in NewsAdminView: Hidden wins over the relevance state.
    if (q.status === 'hidden') query = query.eq('hidden', true)
    else if (q.status) {
        query = query.eq('hidden', false)
        if (q.status === 'relevant') query = query.eq('is_relevant', true)
        else if (q.status === 'not_relevant') query = query.eq('is_relevant', false)
        else query = query.is('is_relevant', null)
    }
    const { data, count, error } = await query
        .order('published_at', { ascending: false })
        .range(offset, offset + limit - 1)
    if (error) console.error('[news] admin page failed:', error.message)
    return { data: (data ?? []) as NewsArticle[], total: count ?? 0 }
}

export async function getArticleById(id: string): Promise<NewsArticle | null> {
    const admin = createAdminClient()
    const { data } = await admin.from('mortgage_news_articles').select('*').eq('id', id).maybeSingle()
    return data as NewsArticle | null
}

/** Returns the cached summary if present, else generates + caches one. */
export async function getOrCreateSummary(id: string): Promise<string | null> {
    const article = await getArticleById(id)
    if (!article) return null
    if (article.summary) return article.summary

    const summary = await summarizeArticle(article.title, article.description)
    if (!summary) return null

    const admin = createAdminClient()
    const { error } = await admin
        .from('mortgage_news_articles')
        .update({ summary, summary_generated_at: new Date().toISOString() })
        .eq('id', id)
    if (error) console.error('[news] saving summary failed:', error.message)
    return summary
}

// ── Admin QA (optional override layer — not part of the required pipeline) ────

export async function setHidden(id: string, hidden: boolean): Promise<boolean> {
    const admin = createAdminClient()
    const { error } = await admin
        .from('mortgage_news_articles')
        .update({ hidden, updated_at: new Date().toISOString() })
        .eq('id', id)
    return !error
}

// Override an AI classification that missed or over-included an article — the
// only way to fix one short of deleting + manually retyping it via Add Article.
export async function setRelevant(id: string, isRelevant: boolean): Promise<boolean> {
    const admin = createAdminClient()
    const { error } = await admin
        .from('mortgage_news_articles')
        .update({
            is_relevant: isRelevant,
            relevance_reason: 'Manually overridden by admin',
            updated_at: new Date().toISOString(),
        })
        .eq('id', id)
    return !error
}

export async function deleteArticle(id: string): Promise<boolean> {
    const admin = createAdminClient()
    const { error } = await admin.from('mortgage_news_articles').delete().eq('id', id)
    return !error
}

export async function createManualArticle(input: NewsArticleInput): Promise<NewsArticle | null> {
    const admin = createAdminClient()
    const { data, error } = await admin
        .from('mortgage_news_articles')
        .insert({
            source: input.source,
            feed_key: input.feed_key,
            title: input.title,
            url: input.url,
            description: input.description ?? null,
            published_at: input.published_at,
            is_relevant: true,
            is_manual: true,
        })
        .select()
        .single()
    if (error) {
        console.error('[news] createManualArticle failed:', error.message)
        return null
    }
    return data as NewsArticle
}
