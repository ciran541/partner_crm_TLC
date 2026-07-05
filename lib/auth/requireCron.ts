import { NextResponse } from 'next/server'

type CronGuardResult =
    | { authorized: true }
    | { authorized: false; response: NextResponse }

/**
 * Guard for /api/cron/* routes. Vercel cron sends `Authorization: Bearer
 * <CRON_SECRET>`; anything else is rejected.
 *
 * Fail-closed in production: if CRON_SECRET is not configured there, the
 * endpoint refuses to run rather than becoming publicly triggerable (each run
 * burns MAS/DeepSeek/FRED quota and DB writes). Locally the secret is optional
 * so `curl localhost:3000/api/cron/...` still works for manual testing.
 */
export function requireCronAuth(request: Request): CronGuardResult {
    const secret = process.env.CRON_SECRET

    if (!secret) {
        if (process.env.NODE_ENV === 'production') {
            console.error('[cron] CRON_SECRET is not set — refusing to run in production')
            return {
                authorized: false,
                response: NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 }),
            }
        }
        return { authorized: true }   // local dev only
    }

    if (request.headers.get('authorization') !== `Bearer ${secret}`) {
        return {
            authorized: false,
            response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        }
    }
    return { authorized: true }
}
