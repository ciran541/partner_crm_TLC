import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { commissionWithFee, caseLoanBase } from '@/lib/insurance/commission'
import { todaySgt } from '@/lib/insurance/promotions'
import type { Case } from '@/lib/types'

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date')
const schema = z.union([
    // Reverse an earlier payment (a mistake) — a new, negative row; the original stays.
    z.object({
        reverses: z.string().uuid(),
        paidOn: DATE.optional(),
        note: z.string().max(300).optional(),
    }),
    // Record a payment. Amount defaults to everything still outstanding.
    z.object({
        caseId: z.string().uuid(),
        amount: z.number().positive().optional(),
        paidOn: DATE.optional(),
        reference: z.string().max(120).optional(),
        note: z.string().max(300).optional(),
    }),
])

/**
 * POST /api/admin/insurance/payouts — record (or reverse) a commission payout.
 *
 * The ledger (commission_payouts, migration 20261202000000) is permanent: rows
 * are never edited or deleted, a mistake is undone with a reversal row. The DB
 * recomputes the case's paid total / status / paid date from the ledger, and
 * rejects any other way of changing them. A payment can't exceed what's still
 * outstanding (overpaying would make "outstanding" negative and confusing).
 */
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    const body = parsed.data
    const db = createAdminClient()
    const paidOn = body.paidOn ?? todaySgt()
    if (paidOn > todaySgt()) return NextResponse.json({ error: 'A payout date can’t be in the future.' }, { status: 400 })

    if ('reverses' in body) {
        const { data: orig } = await db.from('commission_payouts').select('id, case_id, amount, reverses').eq('id', body.reverses).single()
        if (!orig) return NextResponse.json({ error: 'Payout not found' }, { status: 404 })
        if (orig.reverses || Number(orig.amount) < 0) return NextResponse.json({ error: 'A reversal can’t itself be reversed.' }, { status: 400 })
        const { error } = await db.from('commission_payouts').insert({
            case_id: orig.case_id, amount: -Number(orig.amount), paid_on: paidOn, reverses: orig.id,
            note: body.note?.trim() || 'Reversal', recorded_by: auth.userId,
        })
        if (error) {
            const dup = error.code === '23505'
            return NextResponse.json({ error: dup ? 'That payout has already been reversed.' : 'Could not record the reversal.' }, { status: dup ? 409 : 500 })
        }
        return NextResponse.json({ ok: true })
    }

    const { data: c } = await db.from('cases').select('*').eq('id', body.caseId).single<Case>()
    if (!c) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    if (c.stage !== 'Closed Won') return NextResponse.json({ error: 'Only a Closed Won case has commission to pay.' }, { status: 400 })

    const owed = commissionWithFee(caseLoanBase(c), c.correction_fee).agent
    const outstanding = Math.round((owed - Number(c.commission_paid_total ?? 0)) * 100) / 100
    if (outstanding <= 0) return NextResponse.json({ error: 'Nothing is outstanding on this case.' }, { status: 400 })
    const amount = Math.round((body.amount ?? outstanding) * 100) / 100
    if (amount > outstanding + 0.005) {
        return NextResponse.json({ error: `That's more than what's outstanding ($${outstanding.toFixed(2)}).` }, { status: 400 })
    }

    const { error } = await db.from('commission_payouts').insert({
        case_id: c.id, amount, paid_on: paidOn,
        reference: body.reference?.trim() || null, note: body.note?.trim() || null, recorded_by: auth.userId,
    })
    if (error) {
        console.error('[POST /api/admin/insurance/payouts]', error)
        return NextResponse.json({ error: 'Could not record the payout.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
}
