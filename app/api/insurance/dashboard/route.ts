import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'

/**
 * GET /api/insurance/dashboard[?agent=uuid]
 *
 * Aggregated data for the Dashboard (dashboard_analytics(), migration
 * 20261201000000): { closed: [...], leads: [...] } by month × lead source.
 * No case rows leave the DB. Scoped from the session; `agent` is admin-only.
 * All maths happens in lib/insurance/dashboardStats.ts.
 */
export async function GET(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const agent = new URL(request.url).searchParams.get('agent')
    const { data, error } = await createAdminClient().rpc('dashboard_analytics', {
        p_viewer_id: auth.userId,
        p_is_admin: auth.isAdmin,
        p_agent: auth.isAdmin ? agent || null : null,
    })
    if (error) {
        console.error('[GET /api/insurance/dashboard]', error)
        return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
    }
    return NextResponse.json(data ?? { closed: [], leads: [] })
}
