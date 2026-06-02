import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'

// POST /api/admin/knowledge/delete — { id }
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    try {
        const { id } = await request.json()
        if (!id) return NextResponse.json({ error: 'Missing article ID' }, { status: 400 })

        const supabaseAdmin = createAdminClient()
        const { error } = await supabaseAdmin.from('knowledge_articles').delete().eq('id', id)

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ success: true })
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
