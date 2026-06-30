import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { exchangeCodeForTokens } from '@/lib/google/oauth'
import { createAdminClient } from '@/lib/supabase/admin'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/**
 * GET /api/property/google/callback?code=...&state=property|insurance
 * Shared Google OAuth callback for BOTH apps (the OAuth redirect_uri is a single
 * fixed value). Stores the refresh_token on the authenticated user's profile and
 * redirects back to the profile page of whichever app started the flow (state).
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const error = searchParams.get('error')
    const state = searchParams.get('state') === 'insurance' ? 'insurance' : 'property'

    const profileUrl = state === 'insurance'
        ? `${APP_URL}/insurance/dashboard/profile`
        : `${APP_URL}/property/profile`

    // Any authenticated user may connect their OWN calendar; the token is stored
    // on their own profile row only.
    const { user } = await getServerUser()
    if (!user) {
        const loginUrl = state === 'insurance' ? `${APP_URL}/insurance/login` : `${APP_URL}/property/login`
        return NextResponse.redirect(loginUrl)
    }

    if (error || !code) {
        const reason = error ?? 'no_code'
        return NextResponse.redirect(`${profileUrl}?calendar_error=${reason}`)
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
            .eq('id', user.id)

        return NextResponse.redirect(`${profileUrl}?calendar=connected`)
    } catch (err) {
        console.error('[Google callback] token exchange failed:', err)
        return NextResponse.redirect(`${profileUrl}?calendar_error=token_exchange`)
    }
}
