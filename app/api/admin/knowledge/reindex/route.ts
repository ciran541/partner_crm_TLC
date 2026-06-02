import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { embedText, articleEmbedInput } from '@/lib/insurance/embed'

// POST /api/admin/knowledge/reindex
// Backfills embeddings for articles that don't have one yet (or ?all=true to
// re-embed everything). Run once after deploying the embed Edge Function.
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const { searchParams } = new URL(request.url)
    const all = searchParams.get('all') === 'true'

    const supabaseAdmin = createAdminClient()

    let query = supabaseAdmin.from('knowledge_articles').select('id, title, content, tags, embedding')
    if (!all) query = query.is('embedding', null)

    const { data: articles, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    let embedded = 0
    let failed = 0
    for (const a of articles ?? []) {
        const vec = await embedText(articleEmbedInput(a.title, a.content, a.tags ?? []))
        if (!vec) { failed++; continue }
        const { error: updErr } = await supabaseAdmin
            .from('knowledge_articles')
            .update({ embedding: vec })
            .eq('id', a.id)
        if (updErr) failed++; else embedded++
    }

    return NextResponse.json({ total: articles?.length ?? 0, embedded, failed })
}
