import { NextResponse } from 'next/server'
import { requirePropertyUser } from '@/lib/auth/requirePropertyUser'
import { exchangeCodeForTokens } from '@/lib/google/oauth'
import { createAdminClient } from '@/lib/supabase/admin'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/**
 * GET /api/property/google/callback?code=...
 * Handles the OAuth callback from Google after the agent grants calendar access.
 * Stores the refresh_token on their profile and redirects back to the profile page.
 */
export async function GET(request: Request) {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const error = searchParams.get('error')

    if (error || !code) {
        // User denied access or something went wrong
        const reason = error ?? 'no_code'
        return NextResponse.redirect(`${APP_URL}/property/profile?calendar_error=${reason}`)
    }

    try {
        const { refresh_token } = await exchangeCodeForTokens(code)

        const admin = createAdminClient()
        await admin
            .from('profiles')
            .update({
                google_refresh_token: refresh_token,
                google_calendar_connected: true,
            })
            .eq('id', auth.userId)

        return NextResponse.redirect(`${APP_URL}/property/profile?calendar=connected`)
    } catch (err) {
        console.error('[Google callback] token exchange failed:', err)
        return NextResponse.redirect(`${APP_URL}/property/profile?calendar_error=token_exchange`)
    }
}
