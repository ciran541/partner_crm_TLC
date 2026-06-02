import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance } from '@/lib/permissions'
import { embedText } from '@/lib/insurance/embed'
import { composeAnswer } from '@/lib/insurance/askGemini'

const REFUSAL = "I don't have guidance on that in our knowledge base — please check with your admin."

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

    // ── Retrieve candidate articles ──
    let candidates: any[] = []

    const queryEmbedding = await embedText(question)
    if (queryEmbedding) {
        const { data: matches } = await supabaseAdmin.rpc('match_knowledge_articles', {
            query_embedding: queryEmbedding,
            match_threshold: 0.45,
            match_count: 5,
            filter_case_type: null,
        })
        if (matches) candidates = matches
    }

    // Fallback retrieval via full-text if embedding unavailable / no semantic hits
    if (candidates.length === 0) {
        const { data: ftsData } = await supabaseAdmin
            .from('knowledge_articles')
            .select(SELECT)
            .eq('status', 'published')
            .textSearch('search_vector', question, { type: 'websearch', config: 'english' })
            .limit(5)
        if (ftsData) candidates = ftsData
    }

    // ── Threshold gate: no relevant knowledge → refuse, never call the model ──
    if (candidates.length === 0) {
        await logGap(supabaseAdmin, question, user.id)
        return NextResponse.json({ answer: REFUSAL, sources: [], grounded: false })
    }

    // ── Compose a grounded answer from the candidates only ──
    const answer = await composeAnswer(question, candidates.map(c => ({ title: c.title, content: c.content })))

    if (answer === null) {
        // Gemini unavailable (no key / error) → degrade to showing the article cards
        return NextResponse.json({ answer: null, sources: candidates, fallback: true })
    }

    // Gemini read the articles and determined they don't answer the question →
    // it's still a gap, even though retrieval returned loosely-related articles.
    if (/check with your admin/i.test(answer)) {
        await logGap(supabaseAdmin, question, user.id)
        return NextResponse.json({ answer: REFUSAL, sources: [], grounded: false })
    }

    return NextResponse.json({ answer, sources: candidates, grounded: true })
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
