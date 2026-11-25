import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { isDay } from '@/lib/insurance/actionCentre'
import { searchOf, toListBody, type OwnCasesResult } from '@/lib/insurance/ownCasesServer'

const CARDS_PER_COLUMN = 10

/**
 * GET /api/insurance/my-cases/track[?search&followUpTo&bankerName&bankerBank]
 * The whole board in one call: each column's count, volume and first cards, plus
 * the banker filter. More cards per column: /api/insurance/my-cases?sort=follow_up.
 */
export async function GET(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const sp = new URL(request.url).searchParams
    const followUpTo = sp.get('followUpTo')
    if (followUpTo && !isDay(followUpTo)) return NextResponse.json({ error: 'followUpTo must be YYYY-MM-DD' }, { status: 400 })

    const { data, error } = await createAdminClient().rpc('own_track', {
        p_owner: auth.userId, p_limit: CARDS_PER_COLUMN, p_search: searchOf(sp), p_follow_up_to: followUpTo,
        p_banker_name: sp.get('bankerName') || null, p_banker_bank: sp.get('bankerBank') || null,
    })
    if (error) {
        console.error('[GET /api/insurance/my-cases/track]', error)
        return NextResponse.json({ error: 'Failed to load the board' }, { status: 500 })
    }
    const d = data as { columns: Record<string, OwnCasesResult>; bankers: unknown[] }
    return NextResponse.json({
        rows: [],
        meta: {
            bankers: d.bankers ?? [],
            columns: Object.fromEntries(Object.entries(d.columns).map(([stage, c]) => [stage, toListBody(c)])),
        },
    })
}
