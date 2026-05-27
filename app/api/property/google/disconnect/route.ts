import { NextResponse } from 'next/server'
import { requirePropertyUser } from '@/lib/auth/requirePropertyUser'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/property/google/disconnect
 * Removes the agent's stored Google OAuth token, disconnecting their calendar.
 * Does NOT delete existing Google Calendar events — those remain in the agent's calendar.
 */
export async function POST() {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    const admin = createAdminClient()

    const { error } = await admin
        .from('profiles')
        .update({
            google_refresh_token: null,
            google_calendar_connected: false,
        })
        .eq('id', auth.userId)

    if (error) {
        console.error('[Google disconnect] DB update failed:', error)
        return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
}
