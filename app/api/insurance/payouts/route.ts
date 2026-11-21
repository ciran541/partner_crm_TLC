import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'

/**
 * GET /api/insurance/payouts[?caseId=uuid][&agent=uuid]
 *
 * The commission payout ledger, newest first, with the case it belongs to —
 * Earnings' "Payout history" (all of an agent's payouts) and the admin
 * "Record payout" window (one case). Scoped from the session: agents only ever
 * see payouts on their own cases; `agent` is admin-only.
 */
export async function GET(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const sp = new URL(request.url).searchParams
    const caseId = sp.get('caseId')
    const agent = auth.isAdmin ? sp.get('agent') : null

    let q = createAdminClient()
        .from('commission_payouts')
        .select('id, case_id, amount, paid_on, reference, note, reverses, created_at, cases!inner(client_name, case_type, created_by), profiles:recorded_by(name)')
        .order('paid_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500)
    if (caseId) q = q.eq('case_id', caseId)
    if (!auth.isAdmin) q = q.eq('cases.created_by', auth.userId)
    else if (agent) q = q.eq('cases.created_by', agent)

    const { data, error } = await q
    if (error) {
        console.error('[GET /api/insurance/payouts]', error)
        return NextResponse.json({ error: 'Failed to load payouts' }, { status: 500 })
    }
    return NextResponse.json({ payouts: data ?? [] })
}
