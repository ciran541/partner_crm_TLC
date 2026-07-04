import { NextResponse } from 'next/server'
import { refreshAll } from '@/lib/insurance/economicCalendar'

// GET /api/cron/economic-calendar — daily Vercel cron. Scrapes FOMC dates from
// the Fed's own calendar page, refreshes CPI actual/previous/forecast from
// FRED. CPI release dates are NOT touched here — those only change via the
// admin's CPI ICS import, since BLS blocks automated fetches of that data.
// Protected by CRON_SECRET (Vercel sends `Authorization: Bearer <CRON_SECRET>`).
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET
    if (secret) {
        const auth = request.headers.get('authorization')
        if (auth !== `Bearer ${secret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
    }

    const result = await refreshAll()
    return NextResponse.json({ success: true, ...result })
}
