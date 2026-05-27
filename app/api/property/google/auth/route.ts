import { NextResponse } from 'next/server'
import { requirePropertyUser } from '@/lib/auth/requirePropertyUser'
import { buildAuthUrl } from '@/lib/google/oauth'

/**
 * GET /api/property/google/auth
 * Initiates the Google OAuth flow for an agent to connect their Google Calendar.
 * Redirects the browser to Google's consent screen.
 */
export async function GET() {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    try {
        const url = buildAuthUrl()
        return NextResponse.redirect(url)
    } catch (err) {
        console.error('[Google auth] failed to build auth URL:', err)
        return NextResponse.json(
            { error: 'Google Calendar integration is not configured' },
            { status: 503 }
        )
    }
}
