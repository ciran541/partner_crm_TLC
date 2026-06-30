import { NextResponse } from 'next/server'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { createAdminClient } from '@/lib/supabase/admin'

/** GET /api/insurance/google/status — is the agent's Google Calendar connected? */
export async function GET() {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const admin = createAdminClient()
    const { data: profile } = await admin
        .from('profiles')
        .select('google_calendar_connected')
        .eq('id', auth.userId)
        .single()

    return NextResponse.json({ connected: profile?.google_calendar_connected ?? false })
}
