import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { groupQuestions, type QuestionRow } from '@/lib/insurance/knowledgeQuestions'

// GET /api/admin/knowledge/gaps — open questions: not covered, and answers to check.
export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const { data, error } = await createAdminClient()
        .from('knowledge_gaps')
        .select('id, question, kind, answer, article_ids, rating, created_at')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1000)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data: groupQuestions((data ?? []) as QuestionRow[]) })
}
