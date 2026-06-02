import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'

// GET /api/admin/knowledge — list all articles (admin only). Optional ?category= & ?q= filters.
export async function GET(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const q = searchParams.get('q')?.trim()

    const supabaseAdmin = createAdminClient()
    let query = supabaseAdmin
        .from('knowledge_articles')
        .select('*')
        .order('updated_at', { ascending: false })

    if (category) query = query.eq('category', category)
    if (q) query = query.or(`title.ilike.%${q}%,content.ilike.%${q}%`)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ data: data ?? [] })
}
