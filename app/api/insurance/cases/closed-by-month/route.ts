import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * GET /api/insurance/cases/closed-by-month[?from=YYYY-MM&to=YYYY-MM][&agent=uuid]
 * (no range = every month that has a closing — one small row per month)
 *
 * Closed Won totals per month (the month the case was marked Closed Won, SGT —
 * see migration 20261126000000) for the Cases → Closed Won chart:
 *   { months: [{ month: 'YYYY-MM', cases, loan_volume }] }   (months with none are omitted)
 * Revenue (0.15%) is applied in the app, like Potential Revenue.
 * Scoped from the session: agents see their own cases; `agent` is admin-only.
 */
export async function GET(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from') || null
    const to = searchParams.get('to') || null
    if ((from && !MONTH.test(from)) || (to && !MONTH.test(to))) {
        return NextResponse.json({ error: 'from and to must be YYYY-MM' }, { status: 400 })
    }

    const { data, error } = await createAdminClient().rpc('closed_won_by_month', {
        p_viewer_id: auth.userId,
        p_is_admin: auth.isAdmin,
        p_agent: auth.isAdmin ? searchParams.get('agent') || null : null,
        p_from: from,
        p_to: to,
    })
    if (error) {
        console.error('[GET /api/insurance/cases/closed-by-month]', error)
        return NextResponse.json({ error: 'Failed to load closed cases' }, { status: 500 })
    }
    return NextResponse.json({ months: data ?? [] })
}
