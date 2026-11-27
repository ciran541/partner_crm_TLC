import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { BULK_MAX, bulkMarkChecked, bulkPublish } from '@/lib/insurance/knowledgeBulk'

// Publishing re-reads official pages and re-embeds each article.
export const maxDuration = 60

// POST /api/admin/knowledge/bulk — { action: 'publish' | 'check', ids }
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const b = await request.json().catch(() => null) as { action?: string; ids?: unknown } | null
    const ids = Array.isArray(b?.ids) ? [...new Set(b.ids.filter((x): x is string => typeof x === 'string'))] : []
    if (!ids.length) return NextResponse.json({ error: 'Nothing selected' }, { status: 400 })
    if (ids.length > BULK_MAX) return NextResponse.json({ error: `Select at most ${BULK_MAX} at a time.` }, { status: 400 })
    try {
        if (b?.action === 'publish') return NextResponse.json(await bulkPublish(ids, auth.userId))
        if (b?.action === 'check') return NextResponse.json(await bulkMarkChecked(ids, auth.userId))
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    } catch (e) {
        console.error('[knowledge/bulk]', e)
        return NextResponse.json({ error: "Couldn't finish. Some may already be saved: refresh to see, then try the rest again." }, { status: 500 })
    }
}
