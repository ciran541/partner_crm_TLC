import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance } from '@/lib/permissions'
import { composeAnswer } from '@/lib/insurance/askGemini'
import { normalizeQuery } from '@/lib/insurance/normalizeQuery'
import { retrieveArticles } from '@/lib/insurance/retrieveKnowledge'
import { rateLimitUser } from '@/lib/rateLimit'

// POST /api/insurance/knowledge/ask  { question }
// Grounded RAG: retrieve matching articles, then Gemini composes an answer
// ONLY from them. Refuses when nothing relevant matched (never invents).
// Retrieval cascade (semantic → fulltext → substring) lives in
// lib/insurance/retrieveKnowledge.ts, shared with the /search route.
export async function POST(request: Request) {
    const { user, profile } = await getServerUser()
    if (!user || !profile || !canAccessInsurance(profile.role, profile.app_type)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Every call spends a Gemini request (plus an embedding). Bound it per agent
    // so a runaway client loop can't run up an unbounded bill.
    const limited = await rateLimitUser(user.id, 'knowledge-ask', 'ai')
    if (limited) return limited

    let question = ''
    try { question = (await request.json())?.question?.trim() ?? '' } catch { /* noop */ }
    if (question.length < 2) {
        return NextResponse.json({ answer: null, sources: [], grounded: false })
    }

    // ── Normalize the query before retrieval ──
    // Rewrites vague/poorly-typed questions into clean precise questions so
    // semantic search matches the Q&A knowledge base accurately.
    const normalizedQuestion = await normalizeQuery(question)
    const searchQuery = normalizedQuestion || question

    // ── Retrieve candidate articles (looser semantic gate than /search — the
    //    composer only sees 3 articles, so recall matters more than precision) ──
    const { articles: candidates } = await retrieveArticles(searchQuery, {
        matchThreshold: 0.25,
        matchCount: 3,
    })

    // ── Threshold gate: no relevant knowledge → refuse, never call the model ──
    if (candidates.length === 0) {
        await logGap(question, user.id)
        return NextResponse.json({ answer: null, sources: [], grounded: false })
    }

    // ── Compose a grounded answer from the candidates only ──
    const answer = await composeAnswer(question, candidates.map(c => ({ title: c.title, content: c.content })))

    if (answer === null) {
        // Model unavailable (no key / error) → degrade to showing the article cards
        return NextResponse.json({ answer: null, sources: candidates, fallback: true })
    }

    // The model read the articles but couldn't synthesise an answer from them —
    // still show the candidate articles so agents can read them directly.
    if (/check with your admin/i.test(answer)) {
        await logGap(question, user.id)
        return NextResponse.json({ answer: null, sources: candidates, fallback: true })
    }

    return NextResponse.json({ answer, sources: candidates, grounded: true })
}

// Record an unanswered question. Never throws — logging a gap must not break the response.
async function logGap(question: string, userId: string) {
    try {
        const supabaseAdmin = createAdminClient()
        const { error } = await supabaseAdmin.from('knowledge_gaps').insert({ question, asked_by: userId })
        if (error) console.error('[gap-insert] failed:', error.message)
    } catch (e) {
        console.error('[gap-insert] threw:', String(e))
    }
}
