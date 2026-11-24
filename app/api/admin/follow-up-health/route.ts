import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { rpcError } from '@/lib/admin/rpcError'

/** GET — per-agent overdue / undated follow-ups (Action Centre overview, agent page). */
export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const { data, error } = await createAdminClient().rpc('agent_follow_up_health')
    if (error) return rpcError('follow-up-health', error, 'Could not load follow-ups.')
    return NextResponse.json({ rows: data ?? [] })
}
