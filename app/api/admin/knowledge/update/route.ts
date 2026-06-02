import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { embedText, articleEmbedInput } from '@/lib/insurance/embed'

// POST /api/admin/knowledge/update — { id, updates }
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    try {
        const { id, updates } = await request.json()
        if (!id) return NextResponse.json({ error: 'Missing article ID' }, { status: 400 })

        // Re-embed if any field that feeds the vector changed.
        const finalUpdates = { ...updates, updated_at: new Date().toISOString() }
        if ('title' in updates || 'content' in updates || 'tags' in updates) {
            const embedding = await embedText(
                articleEmbedInput(updates.title ?? '', updates.content ?? '', updates.tags ?? [])
            )
            if (embedding) finalUpdates.embedding = embedding
        }

        const supabaseAdmin = createAdminClient()
        const { data, error } = await supabaseAdmin
            .from('knowledge_articles')
            .update(finalUpdates)
            .eq('id', id)
            .select()
            .single()

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ data })
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
