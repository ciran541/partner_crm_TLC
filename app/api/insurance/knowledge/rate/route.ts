import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance } from '@/lib/permissions'

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

// POST /api/insurance/knowledge/rate
//   { logId, good }                  an AI answer this agent was given
//   { articleId, question, good }    an article's answer; only "wrong" is kept
export async function POST(request: Request) {
    const { user, profile } = await getServerUser()
    if (!user || !profile || !canAccessInsurance(profile.role, profile.app_type)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const b = await request.json().catch(() => null)
    const good = b?.good
    if (typeof good !== 'boolean') return NextResponse.json({ error: 'Bad request' }, { status: 400 })
    const db = createAdminClient()

    if (typeof b.logId === 'string' && UUID.test(b.logId)) {
        // Own answers only; a thumbs-down reopens one the admin had cleared.
        const { data, error } = await db.from('knowledge_gaps')
            .update({ rating: good ? 1 : -1, ...(good ? {} : { status: 'open' }) })
            .eq('id', b.logId).eq('asked_by', user.id).eq('kind', 'ai').select('id')
        if (error || !data?.length) return NextResponse.json({ error: 'Could not save' }, { status: error ? 500 : 404 })
        return NextResponse.json({ success: true })
    }

    if (typeof b.articleId === 'string' && UUID.test(b.articleId) && typeof b.question === 'string' && b.question.trim()) {
        if (good) return NextResponse.json({ success: true })
        const question = b.question.trim().slice(0, 500)
        const { data: article } = await db.from('knowledge_articles').select('id, content').eq('id', b.articleId).eq('status', 'published').maybeSingle()
        if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 })
        // One open report per agent, question and article.
        const { data: same } = await db.from('knowledge_gaps').select('id').eq('kind', 'report').eq('status', 'open')
            .eq('asked_by', user.id).eq('question', question).contains('article_ids', [article.id]).limit(1)
        if (!same?.length) {
            const { error } = await db.from('knowledge_gaps').insert({
                question, asked_by: user.id, kind: 'report', answer: article.content, article_ids: [article.id], rating: -1,
            })
            if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
        }
        return NextResponse.json({ success: true })
    }
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
}
