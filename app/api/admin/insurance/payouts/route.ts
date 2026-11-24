import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { rpcError } from '@/lib/admin/rpcError'
import { todaySgt } from '@/lib/insurance/promotions'

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date')
const common = { paidOn: DATE.optional(), reference: z.string().max(120).optional(), note: z.string().max(300).optional() }
const schema = z.union([
    // Reverse one payment, or every payment in a batch. The originals stay.
    z.object({ reverses: z.string().uuid(), ...common }),
    z.object({ reverseBatch: z.string().uuid(), ...common }),
    // Pay many cases at once, each in full. All of them save, or none.
    z.object({ items: z.array(z.object({ caseId: z.string().uuid(), amount: z.number().positive() })).min(1).max(300), ...common }),
    // Pay one case (lower the amount for a partial payment).
    z.object({ caseId: z.string().uuid(), amount: z.number().positive(), ...common }),
])

/**
 * POST /api/admin/insurance/payouts — record or reverse commission payouts.
 *
 * The ledger (commission_payouts) is permanent: a mistake is undone with a
 * reversal row. Recording goes through record_commission_payouts() (migration
 * 20261204000000), which locks each case and re-checks what's outstanding, so
 * two admins can't pay the same case twice.
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
    const note = body.note?.trim() || null

    if ('reverses' in body) {
        const { data: orig } = await db.from('commission_payouts').select('id, case_id, amount, reverses').eq('id', body.reverses).single()
        if (!orig) return NextResponse.json({ error: 'Payout not found' }, { status: 404 })
        if (orig.reverses || Number(orig.amount) < 0) return NextResponse.json({ error: 'A reversal can’t itself be reversed.' }, { status: 400 })
        const { error } = await db.from('commission_payouts').insert({
            case_id: orig.case_id, amount: -Number(orig.amount), paid_on: paidOn, reverses: orig.id,
            note: note ?? 'Reversal', recorded_by: auth.userId,
        })
        if (error) {
            const dup = error.code === '23505'
            return NextResponse.json({ error: dup ? 'That payout has already been reversed.' : 'Could not record the reversal.' }, { status: dup ? 409 : 500 })
        }
        return NextResponse.json({ ok: true })
    }
    if ('reverseBatch' in body) {
        const { data, error } = await db.rpc('reverse_payout_batch', {
            p_batch: body.reverseBatch, p_paid_on: paidOn, p_note: note ?? 'Batch reversal', p_actor: auth.userId,
        })
        if (error) return rpcError('payouts reverse batch', error, 'Could not reverse the batch.')
        return NextResponse.json({ ok: true, reversed: data })
    }

    const batch = 'items' in body
    const items = batch ? body.items : [{ caseId: body.caseId, amount: body.amount }]
    const { data, error } = await db.rpc('record_commission_payouts', {
        p_items: items.map(i => ({ case_id: i.caseId, amount: i.amount })),
        p_paid_on: paidOn, p_reference: body.reference?.trim() || null, p_note: note, p_actor: auth.userId, p_batch: batch,
    })
    if (error) return rpcError('payouts', error, 'Could not record the payout.')
    return NextResponse.json({ ok: true, ...(data as object) })
}
