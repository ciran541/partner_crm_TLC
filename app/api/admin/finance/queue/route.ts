import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { rpcError } from '@/lib/admin/rpcError'

/** GET — Closed Won cases with money still to move (bank → TLC, or TLC → agent). */
export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const { data, error } = await createAdminClient().rpc('finance_queue')
    if (error) return rpcError('finance/queue', error, 'Could not load payouts.')
    return NextResponse.json({ rows: data ?? [] })
}
