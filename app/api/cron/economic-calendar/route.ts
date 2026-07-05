import { NextResponse } from 'next/server'
import { refreshAll } from '@/lib/insurance/economicCalendar'
import { requireCronAuth } from '@/lib/auth/requireCron'

// GET /api/cron/economic-calendar — daily Vercel cron. Scrapes FOMC dates from
// the Fed's own calendar page, refreshes CPI actual/previous/forecast from
// FRED. CPI release dates are NOT touched here — those only change via the
// admin's CPI ICS import, since BLS blocks automated fetches of that data.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
    const auth = requireCronAuth(request)
    if (!auth.authorized) return auth.response

    const result = await refreshAll()
    return NextResponse.json({ success: true, ...result })
}
