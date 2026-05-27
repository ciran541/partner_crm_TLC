import { NextResponse } from 'next/server'
import { requirePropertyUser } from '@/lib/auth/requirePropertyUser'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/property/google/status
 * Returns whether the current agent has connected their Google Calendar.
 */
export async function GET() {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    const admin = createAdminClient()

    const { data: profile } = await admin
        .from('profiles')
        .select('google_calendar_connected')
        .eq('id', auth.userId)
        .single()

    return NextResponse.json({
        connected: profile?.google_calendar_connected ?? false,
    })
}
