import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { embedText, articleEmbedInput } from '@/lib/insurance/embed'

// POST /api/admin/knowledge/create
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    try {
        const body = await request.json()
        const { title, content, category, tags, case_types, step_keys, status } = body

        if (!title?.trim() || !content?.trim() || !category?.trim()) {
            return NextResponse.json({ error: 'Title, content and category are required' }, { status: 400 })
        }

        const tagList = Array.isArray(tags) ? tags : []
        // Auto-embed (gte-small). Null on failure — article still saves; search falls back to FTS.
        const embedding = await embedText(articleEmbedInput(title, content, tagList))

        const supabaseAdmin = createAdminClient()
        const { data, error } = await supabaseAdmin
            .from('knowledge_articles')
            .insert({
                title: title.trim(),
                content: content.trim(),
                category,
                tags: tagList,
                case_types: Array.isArray(case_types) ? case_types : [],
                step_keys: Array.isArray(step_keys) ? step_keys : [],
                status: status === 'draft' ? 'draft' : 'published',
                created_by: auth.userId,
                ...(embedding ? { embedding } : {}),
            })
            .select()
            .single()

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ data })
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
