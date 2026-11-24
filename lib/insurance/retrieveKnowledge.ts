/**
 * Knowledge retrieval — the ONE implementation of the three-tier cascade:
 *
 *   1. semantic  — pgvector cosine match via the embed Edge Function
 *   2. fulltext  — Postgres websearch FTS (stemming, multi-word)
 *   3. substring — ILIKE on the whole query, then on extracted keywords
 *
 * Each tier is a fallback so retrieval never hard-fails when the embedder is
 * down. Previously the ask and search routes each carried their own copy of
 * this cascade (with two stopword lists that had already drifted apart);
 * both now call retrieveArticles() with their own threshold/count.
 *
 * Server-side only (uses the service-role client) — RLS stays closed and all
 * agent access flows through the guarded API routes.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { embedText } from '@/lib/insurance/embed'
import { rankArticles, type Confidence } from '@/lib/insurance/knowledgeRank'

const SELECT = 'id, title, content, category, tags, case_types, source, checked_by, checked_on'

const STOP_WORDS = new Set([
    'what', 'is', 'the', 'a', 'an', 'my', 'for', 'of', 'to', 'in', 'on', 'at',
    'are', 'how', 'do', 'does', 'can', 'will', 'if', 'client', 'has', 'have',
    'with', 'and', 'or', 'but', 'not', 'this', 'that', 'their', 'its', 'be',
    'been', 'was', 'were', 'when', 'take', 'long', 'longest', 'could', 'much',
])

export interface RetrievedArticle {
    id: string
    title: string
    content: string
    category: string | null
    tags: string[] | null
    case_types: string[] | null
    source?: string | null
    checked_by?: string | null
    checked_on?: string | null
}

export type RetrievalMode = 'semantic' | 'fulltext' | 'substring' | 'none'

export interface RetrievalOptions {
    /** Minimum cosine similarity for a semantic hit (ask uses a looser gate than search). */
    matchThreshold?: number
    /** Maximum articles to return. */
    matchCount?: number
}

/** Non-trivial words for keyword fallback / re-ranking. */
export function extractKeywords(text: string, max = 4): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !STOP_WORDS.has(w))
        .slice(0, max)
}

/**
 * Score articles by keyword overlap with the question — title hits weigh more
 * than tag hits, tag hits more than content hits. Used to order FTS/ILIKE
 * results, which have no native relevance ranking (semantic results are
 * already ordered by similarity).
 */
export function rankByKeywords<T extends { title?: string; content?: string; tags?: string[] | null }>(
    articles: T[],
    question: string,
): T[] {
    const words = extractKeywords(question, Infinity)
    if (words.length === 0) return articles

    return articles
        .map(a => {
            const title = (a.title ?? '').toLowerCase()
            const content = (a.content ?? '').toLowerCase()
            const tags = (a.tags ?? []).join(' ').toLowerCase()
            const score = words.reduce((s, w) => {
                if (title.includes(w)) s += 3
                if (tags.includes(w)) s += 2
                if (content.includes(w)) s += 1
                return s
            }, 0)
            return { article: a, score }
        })
        .sort((x, y) => y.score - x.score)
        .map(x => x.article)
}

/** Run the cascade. Returns published articles only, best-first, and the tier that hit. */
export async function retrieveArticles(
    query: string,
    { matchThreshold = 0.4, matchCount = 8 }: RetrievalOptions = {},
): Promise<{ articles: RetrievedArticle[]; mode: RetrievalMode }> {
    const q = query.trim()
    if (q.length < 2) return { articles: [], mode: 'none' }

    const admin = createAdminClient()

    // 1) Semantic — embed the query, match by cosine similarity
    const queryEmbedding = await embedText(q)
    if (queryEmbedding) {
        const { data: matches, error } = await admin.rpc('match_knowledge_articles', {
            query_embedding: queryEmbedding,
            match_threshold: matchThreshold,
            match_count: matchCount,
            filter_case_type: null,
        })
        if (!error && matches?.length) {
            return { articles: matches as RetrievedArticle[], mode: 'semantic' }
        }
    }

    // 2) Full-text ('websearch' parses arbitrary input safely)
    const { data: ftsData } = await admin
        .from('knowledge_articles')
        .select(SELECT)
        .eq('status', 'published')
        .textSearch('search_vector', q, { type: 'websearch', config: 'english' })
        .limit(matchCount)
    if (ftsData?.length) {
        return { articles: rankByKeywords(ftsData as RetrievedArticle[], q), mode: 'fulltext' }
    }

    // 3a) Substring on the whole query (catches partial words like "claw")
    const safe = q.replace(/[,()*]/g, ' ').trim()
    if (safe) {
        const { data: likeData } = await admin
            .from('knowledge_articles')
            .select(SELECT)
            .eq('status', 'published')
            .or(`title.ilike.%${safe}%,content.ilike.%${safe}%`)
            .limit(matchCount)
        if (likeData?.length) {
            return { articles: rankByKeywords(likeData as RetrievedArticle[], q), mode: 'substring' }
        }
    }

    // 3b) Substring on extracted keywords (multi-word queries whose exact
    //     phrasing appears nowhere, e.g. "clawback period condo")
    const keywords = extractKeywords(q)
    if (keywords.length) {
        const { data: kwData } = await admin
            .from('knowledge_articles')
            .select(SELECT)
            .eq('status', 'published')
            .or(keywords.map(k => `title.ilike.%${k}%,content.ilike.%${k}%`).join(','))
            .limit(matchCount)
        if (kwData?.length) {
            return { articles: rankByKeywords(kwData as RetrievedArticle[], q), mode: 'substring' }
        }
    }

    return { articles: [], mode: 'none' }
}

export async function loadPublished(): Promise<RetrievedArticle[]> {
    const { data, error } = await createAdminClient().from('knowledge_articles').select(SELECT).eq('status', 'published').limit(1000)
    if (error) throw error
    return (data ?? []) as RetrievedArticle[]
}

/** Meaning score per published article; empty when the embedder is down. */
export async function similarities(embedding: number[] | null): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    if (!embedding) return out
    const { data } = await createAdminClient().rpc('match_knowledge_articles', {
        query_embedding: embedding, match_threshold: -1, match_count: 1000, filter_case_type: null,
    })
    for (const r of (data ?? []) as { id: string; similarity: number }[]) out.set(r.id, r.similarity)
    return out
}

/** Ask: rank every published article (words first, meaning as tie-breaker). */
export async function rankPublished(question: string, published: RetrievedArticle[]): Promise<{ articles: RetrievedArticle[]; confidence: Confidence }> {
    const { ranked, confidence } = rankArticles(question, published, await similarities(await embedText(question)))
    return { articles: ranked.map(r => r.article), confidence }
}
