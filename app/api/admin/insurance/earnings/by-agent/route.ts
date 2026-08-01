import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import type { AgentCommissionRow } from '@/lib/insurance/commission'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/insurance/earnings/by-agent — the admin earnings master table.
 *
 * Replaces commissionByAgent(), which grouped a downloaded array of cases in the
 * browser and so only ever totalled the rows that survived the row cap.
 *
 * Spans the whole agent roster, so an agent with no cases still appears as a row
 * of zeros rather than dropping out of the table.
 */
export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const admin = createAdminClient()
    const { data, error } = await admin.rpc('case_commission_by_agent')

    if (error) {
        console.error('[GET /api/admin/insurance/earnings/by-agent]', error)
        return NextResponse.json({ error: 'Failed to load earnings' }, { status: 500 })
    }

    return NextResponse.json({ rows: (data ?? []) as AgentCommissionRow[] })
}
