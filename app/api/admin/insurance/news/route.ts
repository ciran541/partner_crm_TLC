import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { getAllArticles, createManualArticle, setHidden, deleteArticle } from '@/lib/insurance/news'
import type { NewsArticleInput } from '@/lib/types/news'

// Admin QA for mortgage news. Guarded by requireAdminUser().
//   GET                          → list all articles (incl. unclassified/hidden)
//   POST   { input }             → one-off manual addition (QA use only — not the ingestion path)
//   PATCH  { id, hidden }        → hide/unhide
//   DELETE ?id=                  → delete

export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const data = await getAllArticles()
    return NextResponse.json({ data })
}

export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const body = await request.json().catch(() => ({}))
    const input = body?.input as NewsArticleInput | undefined
    if (!input?.title || !input?.url || !input?.source || !input?.feed_key || !input?.published_at) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const data = await createManualArticle(input)
    if (!data) return NextResponse.json({ error: 'Failed to create article (duplicate URL?)' }, { status: 500 })
    return NextResponse.json({ data })
}

export async function PATCH(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const body = await request.json().catch(() => ({}))
    const { id, hidden } = body as { id?: string; hidden?: boolean }
    if (!id || typeof hidden !== 'boolean') {
        return NextResponse.json({ error: 'Missing id or hidden' }, { status: 400 })
    }

    const ok = await setHidden(id, hidden)
    if (!ok) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const ok = await deleteArticle(id)
    if (!ok) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
    return NextResponse.json({ success: true })
}
