import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { testQuestion } from '@/lib/insurance/knowledgeAdmin'

// POST /api/admin/knowledge/test — { question, id?, title, content, tags }
// What an agent asking `question` would get if this draft were published. Free.
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    try {
        const b = await request.json()
        const text = (v: unknown) => typeof v === 'string' ? v.trim() : ''
        const question = text(b.question)
        if (question.length < 2) return NextResponse.json({ error: 'Type a question to test' }, { status: 400 })
        return NextResponse.json(await testQuestion(question, {
            id: text(b.id) || undefined, title: text(b.title), content: text(b.content),
            tags: Array.isArray(b.tags) ? b.tags.filter((t: unknown) => typeof t === 'string') : [],
        }))
    } catch (err) {
        console.error('[knowledge-test]', String(err))
        return NextResponse.json({ error: 'Could not run the test' }, { status: 500 })
    }
}
