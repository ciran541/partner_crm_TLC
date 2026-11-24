import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { rpcError } from '@/lib/admin/rpcError'

/** GET — TLC Dashboard aggregates (finance_overview(); maths in lib/insurance/financeStats.ts). */
export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const { data, error } = await createAdminClient().rpc('finance_overview')
    if (error) return rpcError('finance/overview', error, 'Could not load the dashboard.')
    return NextResponse.json(data)
}
