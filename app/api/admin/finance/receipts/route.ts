import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { rpcError } from '@/lib/admin/rpcError'
import { todaySgt } from '@/lib/insurance/promotions'
import { monthRangeOf } from '@/lib/insurance/financeStats'

const PAGE = 100
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date')
const schema = z.union([
    z.object({ reverses: z.string().uuid(), note: z.string().max(300).optional() }),
    z.object({
        kind: z.enum(['receipt', 'clawback']),
        receivedOn: DATE,
        reference: z.string().max(120).optional(),
        note: z.string().max(300).optional(),
        items: z.array(z.object({
            caseId: z.string().uuid(),
            amount: z.number().positive().max(9_999_999),
            bank: z.string().max(100).optional(),
            /** Received total on screen when the admin confirmed (stops double entry). */
            seen: z.number(),
        })).min(1).max(300),
    }),
])

/** GET ?caseId= | ?month=&agent=&offset= — bank payments, newest first. */
export async function GET(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const sp = new URL(request.url).searchParams
    const offset = Math.max(0, Number(sp.get('offset')) || 0)
    const range = monthRangeOf(sp.get('month'))
    const db = createAdminClient()
    let q = db.from('bank_receipts')
        .select('id, case_id, kind, amount, bank, received_on, reverses, created_at, transfer_id, bank_transfers(reference, note), cases!inner(client_name, case_type, created_by, profiles(name)), recorder:profiles!bank_receipts_recorded_by_fkey(name)', { count: 'exact' })
        .order('received_on', { ascending: false }).order('created_at', { ascending: false }).order('id')
        .range(offset, offset + PAGE - 1)
    if (sp.get('caseId')) q = q.eq('case_id', sp.get('caseId')!)
    if (sp.get('agent')) q = q.eq('cases.created_by', sp.get('agent')!)
    if (range) q = q.gte('received_on', range.from).lte('received_on', range.to)
    const { data, error, count } = await q
    if (error) {
        console.error('[finance/receipts]', error)
        return NextResponse.json({ error: 'Could not load bank payments.' }, { status: 500 })
    }
    const ids = (data ?? []).map(r => r.id)
    // Case page only: was the agent paid before bank payments were tracked?
    const { data: untracked } = sp.get('caseId')
        ? await db.from('bank_receipt_untracked').select('case_id').eq('case_id', sp.get('caseId')!).maybeSingle()
        : { data: null }
    const { data: rev } = ids.length
        ? await db.from('bank_receipts').select('reverses').in('reverses', ids)
        : { data: [] as { reverses: string }[] }
    const reversed = new Set((rev ?? []).map(r => r.reverses))
    return NextResponse.json({ rows: (data ?? []).map(r => ({ ...r, reversed: reversed.has(r.id) })), total: count ?? 0, untracked: !!untracked })
}

/** POST — record bank money (one transfer, many cases), a clawback, or a reversal. */
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    const body = parsed.data
    const db = createAdminClient()

    if ('reverses' in body) {
        const { error } = await db.rpc('reverse_bank_receipt', {
            p_receipt: body.reverses, p_on: todaySgt(), p_note: body.note?.trim() || 'Reversal', p_actor: auth.userId,
        })
        if (error) return rpcError('finance/receipts reverse', error, 'Could not record the reversal.')
        return NextResponse.json({ ok: true })
    }
    if (body.receivedOn > todaySgt()) return NextResponse.json({ error: 'The date can’t be in the future.' }, { status: 400 })
    const { data, error } = await db.rpc('record_bank_receipts', {
        p_items: body.items.map(i => ({ case_id: i.caseId, amount: i.amount, bank: i.bank ?? null, seen: i.seen })),
        p_received_on: body.receivedOn, p_reference: body.reference?.trim() || null, p_note: body.note?.trim() || null,
        p_actor: auth.userId, p_kind: body.kind,
    })
    if (error) return rpcError('finance/receipts', error, 'Could not record the bank payment.')
    return NextResponse.json(data)
}
