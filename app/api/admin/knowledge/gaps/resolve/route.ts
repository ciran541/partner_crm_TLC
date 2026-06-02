import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'

// POST /api/admin/knowledge/gaps/resolve — { ids: string[] }
// Marks the given gap rows resolved (dismisses them from the open list).
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    try {
        const { ids } = await request.json()
        if (!Array.isArray(ids) || ids.length === 0) {
            return NextResponse.json({ error: 'Missing ids' }, { status: 400 })
        }

        const supabaseAdmin = createAdminClient()
        const { error } = await supabaseAdmin
            .from('knowledge_gaps')
            .update({ status: 'resolved' })
            .in('id', ids)

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ success: true })
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
