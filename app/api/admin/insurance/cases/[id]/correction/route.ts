import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { rpcError } from '@/lib/admin/rpcError'
import { CORRECTION_FEE } from '@/lib/insurance/commission'

const schema = z.object({ reason: z.string().trim().min(1).max(2000), charge: z.boolean(), updated_at: z.string() })

/**
 * POST — send a Closed Won case back to the agent (Pending Signature) to fix.
 * Fixing it yourself is PATCH /api/admin/insurance/cases/[id]. Both go through
 * admin_edit_case(), which blocks a case that's been paid, fully or partly.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const { id } = await context.params
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Give a reason and decide on the fee.' }, { status: 400 })
    const { data, error } = await createAdminClient().rpc('admin_edit_case', {
        p_case: id, p_actor: auth.userId, p_expected: parsed.data.updated_at, p_changes: {},
        p_reason: parsed.data.reason, p_fee: parsed.data.charge ? CORRECTION_FEE : 0, p_reopen: true,
    })
    if (error) return rpcError('correction', error, 'Unable to send the case back.')
    return NextResponse.json(data)
}
