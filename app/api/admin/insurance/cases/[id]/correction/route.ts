import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { CORRECTION_FEE } from '@/lib/insurance/commission'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const { id } = await context.params
    let input
    try { input = await request.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
    if (!input || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000 || typeof input.charge !== 'boolean' || !['reopen', 'record'].includes(input.mode) || typeof input.updated_at !== 'string') {
        return NextResponse.json({ error: 'Provide a reason, fee decision and correction mode.' }, { status: 400 })
    }
    const db = createAdminClient()
    const { data: before, error: readError } = await db.from('cases').select('*').eq('id', id).single()
    if (readError || !before) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    if (before.stage !== 'Closed Won' || before.commission_status === 'paid' || before.updated_at !== input.updated_at) return NextResponse.json({ error: 'Only an unchanged, unpaid Closed Won case can be corrected. Refresh the case first.' }, { status: 409 })
    const fee = input.charge ? CORRECTION_FEE : 0
    const correction = { at: new Date().toISOString(), by: auth.userId, reason: input.reason.trim(), fee, mode: input.mode, from_stage: before.stage }
    const { data, error } = await db.from('cases').update({
        stage: input.mode === 'reopen' ? 'Pending Signature' : before.stage,
        correction_fee: Number(before.correction_fee ?? 0) + fee,
        corrections: [...(before.corrections ?? []), correction],
        updated_at: correction.at,
    }).eq('id', id).eq('updated_at', before.updated_at).eq('commission_status', 'unpaid').select().maybeSingle()
    if (error) return NextResponse.json({ error: 'Unable to record correction' }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Case changed. Refresh before trying again.' }, { status: 409 })
    await db.from('insurance_case_activity_logs').insert({ case_id: id, actor_id: auth.userId, action: 'correction', old_value: { stage: before.stage, fee: before.correction_fee }, new_value: { ...correction, stage: data.stage } })
    return NextResponse.json(data)
}
