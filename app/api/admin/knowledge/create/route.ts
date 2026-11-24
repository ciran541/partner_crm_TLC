import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { readForm, saveArticle } from '@/lib/insurance/knowledgeAdmin'

// POST /api/admin/knowledge/create
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    try {
        const form = readForm(await request.json())
        if (typeof form === 'string') return NextResponse.json({ error: form }, { status: 400 })
        const { error, status } = await saveArticle(form, auth.userId)
        return error ? NextResponse.json({ error }, { status }) : NextResponse.json({ success: true })
    } catch (err) {
        console.error('[knowledge-create]', String(err))
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
