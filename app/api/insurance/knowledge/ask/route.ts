import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance } from '@/lib/permissions'
import { embedText } from '@/lib/insurance/embed'
import { composeAnswer } from '@/lib/insurance/askGemini'
import { normalizeQuery } from '@/lib/insurance/normalizeQuery'

// POST /api/insurance/knowledge/ask  { question }
// Grounded RAG: retrieve matching articles, then Gemini composes an answer
// ONLY from them. Refuses when nothing relevant matched (never invents).
export async function POST(request: Request) {
    const { user, profile } = await getServerUser()
    if (!user || !profile || !canAccessInsurance(profile.role, profile.app_type)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let question = ''
    try { question = (await request.json())?.question?.trim() ?? '' } catch { /* noop */ }
    if (question.length < 2) {
        return NextResponse.json({ answer: null, sources: [], grounded: false })
    }

    const supabaseAdmin = createAdminClient()
    const SELECT = 'id, title, content, category, tags, case_types'

    // ── Normalize the query before retrieval ──
    // Rewrites vague/poorly-typed questions into clean precise questions so
    // semantic search matches the Q&A knowledge base accurately.
    const normalizedQuestion = await normalizeQuery(question)
    const searchQuery = normalizedQuestion || question

    // ── Retrieve candidate articles ──
    let candidates: any[] = []
    let semanticHit = false

    const queryEmbedding = await embedText(searchQuery)
    if (queryEmbedding) {
        const { data: matches } = await supabaseAdmin.rpc('match_knowledge_articles', {
            query_embedding: queryEmbedding,
            match_threshold: 0.25,
            match_count: 3,
            filter_case_type: null,
        })
        if (matches?.length) { candidates = matches; semanticHit = true }
    }

    // Tier 2: full-text search if semantic returned nothing
    if (candidates.length === 0) {
        const { data: ftsData } = await supabaseAdmin
            .from('knowledge_articles')
            .select(SELECT)
            .eq('status', 'published')
            .textSearch('search_vector', searchQuery, { type: 'websearch', config: 'english' })
            .limit(3)
        if (ftsData) candidates = ftsData
    }

    // Tier 3: keyword ILIKE fallback — extract non-trivial words and match on title/content
    if (candidates.length === 0) {
        const stopWords = new Set(['what','is','the','a','an','my','for','of','to','in','on','at','are','how','do','does','can','will','if','client','has','have','with','and','or','but','not','this','that','their','its','be','been','was','were','when'])
        const keywords = searchQuery
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3 && !stopWords.has(w))
            .slice(0, 4)
        if (keywords.length > 0) {
            const { data: ilikeData } = await supabaseAdmin
                .from('knowledge_articles')
                .select(SELECT)
                .eq('status', 'published')
                .or(keywords.map(k => `title.ilike.%${k}%,content.ilike.%${k}%`).join(','))
                .limit(3)
            if (ilikeData) candidates = ilikeData
        }
    }

    // Re-rank Tier 2/3 results by keyword overlap (semantic is already relevance-ordered)
    if (!semanticHit && candidates.length > 1) {
        candidates = rankByKeywords(candidates, searchQuery)
    }

    // ── Threshold gate: no relevant knowledge → refuse, never call the model ──
    if (candidates.length === 0) {
        await logGap(supabaseAdmin, question, user.id)
        return NextResponse.json({ answer: null, sources: [], grounded: false })
    }

    // ── Compose a grounded answer from the candidates only ──
    const answer = await composeAnswer(question, candidates.map(c => ({ title: c.title, content: c.content })))

    if (answer === null) {
        // Gemini unavailable (no key / error) → degrade to showing the article cards
        return NextResponse.json({ answer: null, sources: candidates, fallback: true })
    }

    // Gemini read the articles but couldn't synthesise an answer from them —
    // still show the candidate articles so agents can read them directly.
    if (/check with your admin/i.test(answer)) {
        await logGap(supabaseAdmin, question, user.id)
        return NextResponse.json({ answer: null, sources: candidates, fallback: true })
    }

    return NextResponse.json({ answer, sources: candidates, grounded: true })
}

// Score each article by keyword overlap with the question — title hits are weighted
// higher than content hits. Used to sort FTS / ILIKE results that have no native ranking.
function rankByKeywords(articles: any[], question: string): any[] {
    const STOP = new Set(['what','is','the','a','an','my','for','of','to','in','on','at','are','how','do','does','can','will','if','client','has','have','with','and','or','but','not','this','that','their','its','be','been','was','were','when','take','long','longest','could','much'])
    const words = question
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !STOP.has(w))

    if (words.length === 0) return articles

    return articles
        .map(a => {
            const title = (a.title ?? '').toLowerCase()
            const content = (a.content ?? '').toLowerCase()
            const tags = ((a.tags ?? []) as string[]).join(' ').toLowerCase()
            const score = words.reduce((s, w) => {
                if (title.includes(w)) s += 3
                if (tags.includes(w)) s += 2
                if (content.includes(w)) s += 1
                return s
            }, 0)
            return { ...a, _score: score }
        })
        .sort((a, b) => b._score - a._score)
        .map(({ _score, ...a }) => a)
}

// Record an unanswered question. Never throws — logging a gap must not break the response.
async function logGap(supabaseAdmin: ReturnType<typeof createAdminClient>, question: string, userId: string) {
    try {
        const { error } = await supabaseAdmin.from('knowledge_gaps').insert({ question, asked_by: userId })
        if (error) console.error('[gap-insert] failed:', error.message)
    } catch (e) {
        console.error('[gap-insert] threw:', String(e))
    }
}
