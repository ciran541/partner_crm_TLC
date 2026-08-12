import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import type { PropertyAgentCommissionRow } from '@/lib/types/property'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/property/earnings          — master table, one row per agent
 * GET /api/admin/property/earnings?agent=id — that agent's commission cases
 *
 * Both shapes live in one route because the drill-down must apply EXACTLY the
 * same filters as the aggregate: if the two disagreed, an admin would open an
 * agent showing $40k and count $38k of cases underneath it, with no way to tell
 * which number is the real one. The filter is stated once, here and in
 * property_commission_by_agent(), and the two are kept in step deliberately.
 */

/** Excluded from earnings for the same reasons in both code paths. */
const DRAFT_STATUS = 'draft'

export async function GET(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const agentId = new URL(request.url).searchParams.get('agent')
    const admin = createAdminClient()

    if (agentId) {
        const { data, error } = await admin
            .from('property_cases')
            .select('id, client_name, case_type, status, commission_status, agent_commission_amount, gross_commission_amount, outstanding_loan_amount, lockin_confirmed_date, created_at')
            .eq('agent_id', agentId)
            .not('agent_commission_amount', 'is', null)
            .neq('status', DRAFT_STATUS)
            .eq('is_duplicate', false)
            .order('created_at', { ascending: false })

        if (error) {
            console.error('[GET /api/admin/property/earnings?agent]', error)
            return NextResponse.json({ error: 'Failed to load agent earnings' }, { status: 500 })
        }
        return NextResponse.json({ cases: data ?? [] })
    }

    const { data, error } = await admin.rpc('property_commission_by_agent')

    if (error) {
        console.error('[GET /api/admin/property/earnings]', error)
        return NextResponse.json({ error: 'Failed to load earnings' }, { status: 500 })
    }

    return NextResponse.json({ rows: (data ?? []) as PropertyAgentCommissionRow[] })
}
