import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'

// GET /api/admin/knowledge/gaps
// Returns open gaps grouped by question, with how often each was asked.
export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const supabaseAdmin = createAdminClient()
    const { data, error } = await supabaseAdmin
        .from('knowledge_gaps')
        .select('id, question, created_at')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(500)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Group by normalized question text
    const groups = new Map<string, { question: string; count: number; lastAsked: string; ids: string[] }>()
    for (const row of data ?? []) {
        const key = row.question.trim().toLowerCase()
        const g = groups.get(key)
        if (g) {
            g.count++
            g.ids.push(row.id)
        } else {
            groups.set(key, { question: row.question.trim(), count: 1, lastAsked: row.created_at, ids: [row.id] })
        }
    }

    const result = [...groups.values()].sort((a, b) => b.count - a.count || (a.lastAsked < b.lastAsked ? 1 : -1))
    return NextResponse.json({ data: result })
}
