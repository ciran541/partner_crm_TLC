import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'

/**
 * GET /api/insurance/earnings/paid-by-month[?agent=uuid]
 *
 * Commission actually PAID to the agent, per month it was paid (SGT):
 *   { months: [{ month: 'YYYY-MM', cases, agent_share }] }   (months with none omitted)
 * Feeds Earnings' "Commission received" (this month / this year / all time) and
 * its last-month / last-year comparison. Scoped from the session; `agent` is
 * admin-only (the admin drill-down).
 */
export async function GET(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const agent = new URL(request.url).searchParams.get('agent')
    const { data, error } = await createAdminClient().rpc('paid_commission_by_month', {
        p_viewer_id: auth.userId,
        p_is_admin: auth.isAdmin,
        p_agent: auth.isAdmin ? agent || null : null,
    })
    if (error) {
        console.error('[GET /api/insurance/earnings/paid-by-month]', error)
        return NextResponse.json({ error: 'Failed to load earnings' }, { status: 500 })
    }
    return NextResponse.json({ months: data ?? [] })
}
