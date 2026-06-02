import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance } from '@/lib/permissions'
import { embedText } from '@/lib/insurance/embed'

// GET /api/insurance/knowledge/search?q=<text>
// Agent-facing. REQUIRES a query — never returns an unfiltered list.
// Strategy: semantic (meaning) search first, then full-text, then substring.
// Each layer is a fallback so search never hard-fails if the embedder is down.
export async function GET(request: Request) {
    const { user, profile } = await getServerUser()
    if (!user || !profile || !canAccessInsurance(profile.role, profile.app_type)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')?.trim() ?? ''

    // Enforce a real query — no empty search that would expose everything
    if (q.length < 2) {
        return NextResponse.json({ data: [] })
    }

    const supabaseAdmin = createAdminClient()
    const SELECT = 'id, title, content, category, tags, case_types'

    // 1) Semantic search — embed the query and match by cosine similarity
    const queryEmbedding = await embedText(q)
    if (queryEmbedding) {
        const { data: matches, error: matchErr } = await supabaseAdmin.rpc('match_knowledge_articles', {
            query_embedding: queryEmbedding,
            match_threshold: 0.4,
            match_count: 8,
            filter_case_type: null,
        })
        if (!matchErr && matches && matches.length > 0) {
            return NextResponse.json({ data: matches, mode: 'semantic' })
        }
    }

    // 2) Full-text search (stemming, multi-word). 'websearch' parses input safely.
    const { data: ftsData } = await supabaseAdmin
        .from('knowledge_articles')
        .select(SELECT)
        .eq('status', 'published')
        .textSearch('search_vector', q, { type: 'websearch', config: 'english' })
        .limit(8)
    if (ftsData && ftsData.length > 0) {
        return NextResponse.json({ data: ftsData, mode: 'fulltext' })
    }

    // 3) Substring fallback (partial words like "claw")
    const safe = q.replace(/[,()*]/g, ' ').trim()
    const { data: likeData, error: likeErr } = await supabaseAdmin
        .from('knowledge_articles')
        .select(SELECT)
        .eq('status', 'published')
        .or(`title.ilike.%${safe}%,content.ilike.%${safe}%`)
        .limit(8)
    if (likeErr) return NextResponse.json({ error: likeErr.message }, { status: 500 })

    return NextResponse.json({ data: likeData ?? [], mode: 'substring' })
}
