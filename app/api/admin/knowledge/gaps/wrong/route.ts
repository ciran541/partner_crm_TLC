import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { blockAnswer } from '@/lib/insurance/answerCache'

// POST /api/admin/knowledge/gaps/wrong — { ids }
// An AI answer is wrong: stop giving it. AI answers the question again only once
// an article behind it changes.
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    try {
        const { ids } = await request.json()
        if (!Array.isArray(ids) || !ids.length) return NextResponse.json({ error: 'Missing ids' }, { status: 400 })
        const { data, error } = await createAdminClient().from('knowledge_gaps').select('cache_key').in('id', ids).not('cache_key', 'is', null)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        const ok = await Promise.all([...new Set((data ?? []).map(r => r.cache_key as string))].map(blockAnswer))
        if (ok.includes(false)) return NextResponse.json({ error: 'Could not stop this answer. Please try again.' }, { status: 500 })
        return NextResponse.json({ success: true })
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
