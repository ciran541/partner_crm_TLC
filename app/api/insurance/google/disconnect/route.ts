import { NextResponse } from 'next/server'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/insurance/google/disconnect
 * Removes the agent's stored Google token. Existing calendar events are left intact.
 */
export async function POST() {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const admin = createAdminClient()
    const { error } = await admin
        .from('profiles')
        .update({ google_refresh_token: null, google_calendar_connected: false })
        .eq('id', auth.userId)

    if (error) {
        console.error('[Insurance Google disconnect] DB update failed:', error)
        return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
}
