import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { rpcError } from '@/lib/admin/rpcError'

const KINDS = ['user', 'case', 'payout', 'bank']
const isDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

/** GET ?kind=&actor=&from=&to=&offset= — every admin action in one feed (admin_activity()). */
export async function GET(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const sp = new URL(request.url).searchParams
    const kind = sp.get('kind')
    const { data, error } = await createAdminClient().rpc('admin_activity', {
        p_kind: kind && KINDS.includes(kind) ? kind : null,
        p_actor: sp.get('actor') || null,
        p_from: isDate(sp.get('from')), p_to: isDate(sp.get('to')),
        p_limit: 50, p_offset: Math.max(0, Number(sp.get('offset')) || 0),
    })
    if (error) return rpcError('audit-log', error, 'Could not load the audit log.')
    return NextResponse.json(data)
}
