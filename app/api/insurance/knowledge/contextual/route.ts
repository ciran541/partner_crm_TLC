import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance } from '@/lib/permissions'

// GET /api/insurance/knowledge/contextual?case_type=Refinancing&step=<stepKey>
// Returns the few published articles tagged to this step (and case type).
// Scoped surfacing — never the full library.
export async function GET(request: Request) {
    const { user, profile } = await getServerUser()
    if (!user || !profile || !canAccessInsurance(profile.role, profile.app_type)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const caseType = searchParams.get('case_type')
    const step = searchParams.get('step')

    if (!step) return NextResponse.json({ data: [] })

    const supabaseAdmin = createAdminClient()
    let query = supabaseAdmin
        .from('knowledge_articles')
        .select('id, title, content, category, tags, case_types')
        .eq('status', 'published')
        .contains('step_keys', [step])

    if (caseType) query = query.contains('case_types', [caseType])

    const { data, error } = await query.limit(6)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data: data ?? [] })
}
