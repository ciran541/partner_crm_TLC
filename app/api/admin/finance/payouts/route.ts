import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { monthRangeOf } from '@/lib/insurance/financeStats'

const PAGE = 100

/** GET ?month=YYYY-MM|YYYY&agent=uuid&offset=n — every payout to agents, newest first. */
export async function GET(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const sp = new URL(request.url).searchParams
    const offset = Math.max(0, Number(sp.get('offset')) || 0)
    const range = monthRangeOf(sp.get('month'))
    const agent = sp.get('agent')

    const db = createAdminClient()
    let q = db.from('commission_payouts')
        .select('id, case_id, amount, paid_on, reference, note, reverses, batch_id, created_at, cases!inner(client_name, case_type, created_by, profiles(name)), recorder:profiles!commission_payouts_recorded_by_fkey(name)', { count: 'exact' })
        .order('paid_on', { ascending: false }).order('created_at', { ascending: false }).order('id')
        .range(offset, offset + PAGE - 1)
    if (range) q = q.gte('paid_on', range.from).lte('paid_on', range.to)
    if (agent) q = q.eq('cases.created_by', agent)
    const { data, error, count } = await q
    if (error) {
        console.error('[finance/payouts]', error)
        return NextResponse.json({ error: 'Could not load payout history.' }, { status: 500 })
    }
    // Which of these have been reversed (the reversal may be on another page).
    const ids = (data ?? []).map(r => r.id)
    const { data: rev } = ids.length
        ? await db.from('commission_payouts').select('reverses').in('reverses', ids)
        : { data: [] as { reverses: string }[] }
    const reversed = new Set((rev ?? []).map(r => r.reverses))
    return NextResponse.json({ rows: (data ?? []).map(r => ({ ...r, reversed: reversed.has(r.id) })), total: count ?? 0 })
}
