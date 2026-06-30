import { NextResponse } from 'next/server'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { buildAuthUrl } from '@/lib/google/oauth'

/**
 * GET /api/insurance/google/auth
 * Starts the Google OAuth flow for an insurance agent to connect their calendar.
 * Uses the shared callback (state='insurance' routes the redirect back here).
 */
export async function GET() {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    try {
        return NextResponse.redirect(buildAuthUrl('insurance'))
    } catch (err) {
        console.error('[Insurance Google auth] failed to build auth URL:', err)
        return NextResponse.json({ error: 'Google Calendar integration is not configured' }, { status: 503 })
    }
}
