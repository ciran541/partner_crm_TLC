import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { calendar_v3 } from 'googleapis'

// ─── Agent OAuth (per-agent, personal Google Calendar) ──────────────────────

/**
 * Returns a base OAuth2Client configured with the app's Google OAuth credentials.
 * Used for the per-agent calendar OAuth flow only.
 */
export function getOAuthClient(): OAuth2Client {
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const redirectUri = process.env.GOOGLE_REDIRECT_URI

    if (!clientId || !clientSecret) {
        throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET env vars')
    }

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

/**
 * Returns an authenticated Google Calendar client for a specific agent,
 * using their stored OAuth refresh token.
 */
export function getCalendarClientForAgent(refreshToken: string): calendar_v3.Calendar {
    const auth = getOAuthClient()
    auth.setCredentials({ refresh_token: refreshToken })
    return google.calendar({ version: 'v3', auth })
}

/**
 * Builds the Google OAuth consent URL for an agent to authorise calendar access.
 * `state` carries which app initiated the flow ('property' | 'insurance') so the
 * single shared callback can redirect back to the right profile page.
 */
export function buildAuthUrl(state: 'property' | 'insurance' = 'property'): string {
    const auth = getOAuthClient()
    return auth.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent', // force refresh_token even if previously authorised
        scope: ['https://www.googleapis.com/auth/calendar.events'],
        state,
    })
}

/**
 * Exchanges an OAuth authorisation code for tokens.
 * Returns the refresh_token (and access_token) from Google.
 */
export async function exchangeCodeForTokens(
    code: string
): Promise<{ refresh_token: string; access_token: string }> {
    const auth = getOAuthClient()
    const { tokens } = await auth.getToken(code)

    if (!tokens.refresh_token) {
        throw new Error(
            'No refresh_token returned by Google. The user may need to revoke access and re-authorise.'
        )
    }

    return {
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token ?? '',
    }
}

// ─── TLC Service Account (shared TLC calendar, no user OAuth needed) ─────────

/**
 * Returns an authenticated Google Calendar client for TLC's shared calendar,
 * using a Google Service Account (JWT — no user login required).
 *
 * Setup:
 *  1. Create a Service Account in Google Cloud Console
 *  2. Download the JSON key — copy client_email + private_key to .env.local
 *  3. In Google Calendar, share TLC's calendar with the service account email
 *     and grant "Make changes to events" permission
 *  4. Copy the Calendar ID from Calendar Settings → TLC_GOOGLE_CALENDAR_ID
 */
export function getCalendarClientForTLC(): calendar_v3.Calendar {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY

    if (!clientEmail || !privateKey) {
        throw new Error(
            'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY env vars'
        )
    }

    const auth = new google.auth.JWT({
        email: clientEmail,
        // Vercel/dotenv stores \n as literal \\n — restore real newlines
        key: privateKey.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/calendar.events'],
    })

    return google.calendar({ version: 'v3', auth })
}
