import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance } from '@/lib/permissions'
import { composeAnswer, composeKey } from '@/lib/insurance/composeAnswer'
import { isClaudeConfigured } from '@/lib/ai/claude'
import { exactMatch } from '@/lib/insurance/knowledgeRank'
import { loadPublished, rankPublished } from '@/lib/insurance/retrieveKnowledge'
import { CALC_KINDS, detectCalc, runCalc, type CalcKind, type CalcValues } from '@/lib/insurance/knowledgeCalc'
import { detectLive, runLive } from '@/lib/insurance/knowledgeLive'
import { rateLimitUser } from '@/lib/rateLimit'

// POST /api/insurance/knowledge/ask  { question, calc?: { kind, values } }
// Free answers first: a listed wording → live HUB data → HUB calculator → an approved article word
// for word. Claude is used only to combine several related articles.
export async function POST(request: Request) {
    const { user, profile } = await getServerUser()
    if (!user || !profile || !canAccessInsurance(profile.role, profile.app_type)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let question = ''
    let calc: { kind?: string; values?: CalcValues } | null = null
    try {
        const body = await request.json()
        question = typeof body?.question === 'string' ? body.question.trim().slice(0, 500) : ''
        calc = body?.calc && typeof body.calc === 'object' ? body.calc : null
    } catch { /* handled below */ }
    if (question.length < 2) return NextResponse.json({ error: 'Please type a question' }, { status: 400 })

    const published = await loadPublished()
    if (!calc) {
        const exact = exactMatch(question, published)
        if (exact) return NextResponse.json({ type: 'article', sources: [exact] })

        const live = detectLive(question)
        // A live lookup that fails falls through to the articles.
        const reply = live ? await runLive(live, question).catch(err => { console.error('[knowledge-live]', String(err)); return null }) : null
        if (reply) return NextResponse.json({ type: 'live', live: reply, sources: [] })
    }

    const asked = CALC_KINDS.includes(calc?.kind as CalcKind) ? calc!.kind as CalcKind : null
    const kind = asked ?? detectCalc(question)
    if (kind) {
        const given = asked && calc?.values && typeof calc.values === 'object' ? calc.values : {}
        return NextResponse.json({ type: 'calc', calc: runCalc(kind, question, given), sources: [] })
    }

    const { articles, confidence } = await rankPublished(question, published)
    if (confidence === 'none') {
        await logQuestion(question, user.id, 'gap')
        return NextResponse.json({ type: 'none', sources: [] })
    }
    if (confidence === 'direct') return NextResponse.json({ type: 'article', sources: articles.slice(0, 1), more: articles.slice(1, 3) })

    const related = articles.slice(0, 6)
    // Over the AI limit: show the articles, don't fail.
    if (isClaudeConfigured('askKnowledge') && !(await rateLimitUser(user.id, 'knowledge-ask', 'ai'))) {
        const used = related.map(a => ({ title: a.title, content: a.content }))
        const answer = await composeAnswer(question, used)
        if (answer && !/I don'?t have guidance on that/i.test(answer)) {
            const logId = await logQuestion(question, user.id, 'ai', { answer, article_ids: related.map(a => a.id), cache_key: composeKey(question, used) })
            return NextResponse.json({ type: 'answer', answer, logId, sources: related })
        }
    }
    await logQuestion(question, user.id, 'gap')
    return NextResponse.json({ type: 'related', sources: related.slice(0, 3) })
}

// For the admin: what isn't covered ('gap') and what AI answered ('ai', kept 90
// days). Never throws: logging must not break the reply.
async function logQuestion(question: string, userId: string, kind: 'gap' | 'ai', extra: { answer?: string; article_ids?: string[]; cache_key?: string } = {}): Promise<string | null> {
    try {
        const db = createAdminClient()
        const { data, error } = await db.from('knowledge_gaps').insert({ question, asked_by: userId, kind, ...extra }).select('id').single()
        if (error) console.error('[knowledge-log] failed:', error.message)
        if (kind === 'ai') await db.from('knowledge_gaps').delete().in('kind', ['ai', 'report']).lt('created_at', new Date(Date.now() - 90 * 86_400_000).toISOString())
        return data?.id ?? null
    } catch (e) {
        console.error('[knowledge-log] threw:', String(e))
        return null
    }
}
