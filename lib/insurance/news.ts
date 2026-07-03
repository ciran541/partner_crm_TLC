/**
 * Mortgage News — ingestion, relevance classification, and AI summaries.
 *
 * Sourcing: NEWS_SOURCES (lib/types/news.ts) lists each publisher's genuine
 * native RSS feed, confirmed working by fetching the raw XML directly (real
 * article URLs, real content snippets, official publisher-run endpoints — no
 * ToS ambiguity, unlike the Google News site-scoped search trick this replaced).
 * Scope was deliberately narrowed to Business Times + CNA rather than padding
 * the source list with a lower-quality/riskier mechanism for publishers that
 * don't have a working native feed (EdgeProp's only feed is property listings
 * not news; MAS/URA/MND block automated requests; Bloomberg has no free feed).
 *
 * Business Times' feed carries genuine per-item <category> tags (confirmed via
 * the raw XML), so BT_RELEVANT_CATEGORIES pre-filters to only categories that
 * could plausibly be mortgage-relevant before anything reaches DeepSeek — cuts
 * obvious noise (Arts & Design, Sports, etc.) for free and reduces DeepSeek call
 * volume. CNA's feed has no comparably useful category scoping available, so it
 * relies on DeepSeek classification alone, same as every candidate that passes
 * the category pre-filter.
 *
 * DeepSeek is used two ways here, both degrading to null on any failure so a bad
 * API call never blocks ingestion or shows a false positive:
 *  - classifyRelevance: JSON-mode relevance gate (never assume relevant on failure)
 *  - summarizeArticle: plain-text 2-3 sentence summary, from title+snippet only
 *    (never scraped article HTML — avoids paywall/ToS issues)
 */

import Parser from 'rss-parser'
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
// Classification is deliberately SEQUENTIAL (one call at a time), not parallel
// — confirmed via live testing (against Gemini, before the DeepSeek switch)
// that firing several classifyRelevance() calls concurrently trips the
// free-tier rate limit on every model in the chain at once (429s across the
// board), which parallel retries can't route around. Kept sequential here as a
// reasonable precaution rather than re-verifying the same risk doesn't apply
// to DeepSeek too.
const FEED_TIMEOUT_MS = 15000
const MAX_NEW_PER_RUN = 30
const RUN_TIME_BUDGET_MS = 40000   // leaves headroom under maxDuration=60 for feed fetching + DB writes

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
    try {
        const feed = await parser.parseURL(source.rssUrl)
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

// ── DeepSeek ─────────────────────────────────────────────────────────────────
// Switched from Gemini to DeepSeek for this file specifically (Knowledge Engine
// and rate ingestion elsewhere in the codebase still use Gemini — not part of
// this change). Reasons: Gemini's free tier turned out to cap at 20 requests/
// day *per model* (confirmed live against the actual key in use, far tighter
// than general documentation suggested), and DeepSeek is meaningfully cheaper
// per token on the paid tier besides. OpenAI-compatible chat completions API —
// same retry-on-5xx/429 pattern as the Gemini helpers elsewhere for consistency.
const DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro']

async function callDeepSeek(
    systemInstruction: string,
    userMessage: string,
    options: { jsonMode?: boolean; maxTokens?: number } = {}
): Promise<string | null> {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) return null

    const body = JSON.stringify({
        model: DEEPSEEK_MODELS[0],
        messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userMessage },
        ],
        temperature: 0,
        max_tokens: options.maxTokens ?? 500,
        // Confirmed live: deepseek-v4-flash's reasoning tokens (returned in a
        // separate reasoning_content field) still count against max_tokens —
        // a real call for a simple classification used 95 reasoning tokens
        // before writing the actual answer. Same class of risk as the Gemini
        // thinking-budget truncation bug found earlier; disabling it here
        // proactively rather than waiting to reproduce that bug on this
        // provider too. Per DeepSeek's own docs, this is a top-level field.
        thinking: { type: 'disabled' },
        ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    })

    for (const model of DEEPSEEK_MODELS) {
        const modelBody = model === DEEPSEEK_MODELS[0] ? body : body.replace(`"model":"${DEEPSEEK_MODELS[0]}"`, `"model":"${model}"`)
        try {
            let res: Response | null = null
            for (let attempt = 0; attempt < 2; attempt++) {
                res = await fetch('https://api.deepseek.com/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                    body: modelBody,
                    signal: AbortSignal.timeout(20000),
                })
                if (res.ok || (res.status !== 503 && res.status !== 429)) break
                if (attempt === 0) await new Promise(r => setTimeout(r, 700))
            }
            if (!res || !res.ok) {
                console.error(`[news] ${model} HTTP ${res?.status}`)
                continue
            }
            const json = await res.json()
            const text = json?.choices?.[0]?.message?.content
            if (typeof text === 'string' && text.trim()) return text.trim()
        } catch (err) {
            console.error(`[news] ${model} threw: ${String(err)}`)
        }
    }
    return null
}

const CLASSIFY_SYSTEM = `You classify Singapore news headlines for a mortgage/insurance CRM used by loan advisory agents.

Decide whether the article is relevant to: mortgage/home loan financing, SORA or other interest rate benchmarks, MAS monetary policy, bank lending rules, property cooling measures, or the Singapore property market (HDB/private) in a way that matters to a mortgage advisor and their clients.

NOT relevant: general politics, crime, sports, entertainment, unrelated business news, or static reference/regulation pages that aren't actual news (e.g. a generic "Regulation" or "Investor Alert List" page).

Base your answer only on the title and snippet given — do not guess beyond them.

Respond ONLY with a JSON object of this exact shape: {"isRelevant": boolean, "reason": string}`

export async function classifyRelevance(title: string, description: string): Promise<{ isRelevant: boolean; reason: string } | null> {
    const raw = await callDeepSeek(
        CLASSIFY_SYSTEM,
        `Title: ${title}\nSnippet: ${description || '(none)'}`,
        { jsonMode: true, maxTokens: 200 }
    )
    if (!raw) return null
    try {
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
        const parsed = JSON.parse(cleaned)
        if (typeof parsed?.isRelevant !== 'boolean') return null
        return { isRelevant: parsed.isRelevant, reason: String(parsed.reason ?? '').trim() }
    } catch {
        return null
    }
}

const SUMMARY_SYSTEM = `You summarize a Singapore mortgage/property-finance news item for a loan advisory agent. Using ONLY the title and snippet given, write 2-3 plain-English sentences explaining what happened and, where the snippet supports it, why it matters for mortgage rates or the property market. Do not invent facts beyond what is given.

Often no real snippet is available — just the headline. In that case, do not pad the summary with invented specifics or generic filler to make it sound fuller. Give a brief, honest restatement of what the headline itself says, and it is fine for this to be short.`

export async function summarizeArticle(title: string, description: string | null): Promise<string | null> {
    return callDeepSeek(SUMMARY_SYSTEM, `Title: ${title}\nSnippet: ${description || '(none)'}`, { maxTokens: 300 })
}

// ── Ingestion ────────────────────────────────────────────────────────────────

/**
 * Cron entrypoint: fetch both sources, date-filter, classify new items, upsert.
 *
 * Respects a wall-clock time budget (not just an item count cap) while calling
 * DeepSeek: live testing showed that when the free-tier quota is exhausted, EVERY
 * item burns through the full model-fallback × retry cascade before failing —
 * with enough items that alone can exceed the 60s serverless budget even though
 * each individual item "degrades gracefully" to null. Once the budget is spent,
 * remaining rows are inserted unclassified rather than left out entirely.
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

    // Rows already stored but never successfully classified (e.g. a prior run's
    // DeepSeek calls all failed) get a fresh attempt too, so a transient outage
    // doesn't strand articles as permanently unclassified/hidden.
    const { data: unclassifiedRows } = await admin
        .from('mortgage_news_articles')
        .select('id, source, feed_key, title, description')
        .is('is_relevant', null)
        .eq('is_manual', false)
        .gte('published_at', new Date(cutoff).toISOString())
        .limit(10)

    if (!candidates.length && !unclassifiedRows?.length) return { inserted: 0 }

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
        const withinBudget = Date.now() - startedAt < RUN_TIME_BUDGET_MS
        const classification = withinBudget ? await classifyRelevance(item.title, item.description ?? '') : null
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
                is_relevant: classification?.isRelevant ?? null,
                relevance_reason: classification?.reason ?? null,
            }, { onConflict: 'url', ignoreDuplicates: true })
        if (error) console.error('[news] insert failed:', error.message)
        else inserted++
    }

    for (const row of unclassifiedRows ?? []) {
        if (Date.now() - startedAt >= RUN_TIME_BUDGET_MS) break
        const classification = await classifyRelevance(row.title, row.description ?? '')
        if (!classification) continue   // still failing — leave it for a later run
        await admin
            .from('mortgage_news_articles')
            .update({ is_relevant: classification.isRelevant, relevance_reason: classification.reason, updated_at: new Date().toISOString() })
            .eq('id', row.id)
    }

    return { inserted }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** Agent-facing feed: relevant, non-hidden articles, most recent first. */
export async function getPublishedArticles(): Promise<NewsArticle[]> {
    const admin = createAdminClient()
    const { data } = await admin
        .from('mortgage_news_articles')
        .select('*')
        .eq('is_relevant', true)
        .eq('hidden', false)
        .order('published_at', { ascending: false })
        .limit(100)
    return (data ?? []) as NewsArticle[]
}

/** Admin view: everything, including unclassified/irrelevant/hidden. */
export async function getAllArticles(): Promise<NewsArticle[]> {
    const admin = createAdminClient()
    const { data } = await admin
        .from('mortgage_news_articles')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(300)
    return (data ?? []) as NewsArticle[]
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
