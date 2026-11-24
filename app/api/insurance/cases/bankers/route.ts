import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'

/** GET /api/insurance/cases/bankers[?agent=]: bankers on the viewer's open cases, for Track's filter. */
export async function GET(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const agent = new URL(request.url).searchParams.get('agent')
    const { data, error } = await createAdminClient().rpc('open_case_bankers', {
        p_viewer_id: auth.userId,
        p_is_admin: auth.isAdmin,
        p_agent: auth.isAdmin ? agent || null : null,
    })
    if (error) {
        console.error('[GET /api/insurance/cases/bankers]', error)
        return NextResponse.json({ error: 'Failed to load bankers' }, { status: 500 })
    }
    return NextResponse.json({ bankers: data ?? [] })
}
