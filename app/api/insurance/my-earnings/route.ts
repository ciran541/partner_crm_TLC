import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { cursorOf, isPeriod, limitOf, toListBody, type OwnCasesResult } from '@/lib/insurance/ownCasesServer'
import type { EarningsMeta } from '@/lib/insurance/ownCases'

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

/**
 * GET /api/insurance/my-earnings[?scope=YYYY|YYYY-MM][&tab=closed_unpaid|closed_paid]
 * Everything the Earnings page shows: totals, tab counts, months, month subtotals
 * and the first cases, latest closing first. With a cursor: only the next cases.
 * The signed-in user's own; `agent` is admin-only and ignored otherwise.
 */
export async function GET(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const sp = new URL(request.url).searchParams
    const bad = (error: string) => NextResponse.json({ error }, { status: 400 })
    const scope = sp.get('scope') || null
    const tab = sp.get('tab') || null
    const agent = auth.isAdmin ? sp.get('agent') || null : null
    if (scope && !isPeriod(scope)) return bad('scope must be YYYY or YYYY-MM')
    if (tab && tab !== 'closed_unpaid' && tab !== 'closed_paid') return bad('Unknown tab')
    if (agent && !UUID.test(agent)) return bad('Invalid agent')
    const cursor = cursorOf(sp)
    if (!cursor) return bad('Invalid cursor')

    const owner = agent ?? auth.userId
    const limit = limitOf(sp)
    const db = createAdminClient()
    const { data, error } = sp.get('cursor')
        ? await db.rpc('own_cases', { p_owner: owner, p_limit: limit, p_stage: 'Closed Won', p_sort: 'closed', p_closed: scope, p_bucket: tab, ...cursor })
        : await db.rpc('own_earnings', { p_owner: owner, p_scope: scope, p_bucket: tab, p_limit: limit })
    if (error) {
        console.error('[GET /api/insurance/my-earnings]', error)
        return NextResponse.json({ error: 'Failed to load earnings' }, { status: 500 })
    }
    const d = data as OwnCasesResult & { meta?: EarningsMeta }
    return NextResponse.json({ ...toListBody(d), meta: d.meta })
}
