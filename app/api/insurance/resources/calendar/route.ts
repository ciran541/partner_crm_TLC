import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance, canAccessProperty } from '@/lib/permissions'
import { getUpcomingEvents, getNearestByKey } from '@/lib/insurance/economicCalendar'

// GET /api/insurance/resources/calendar — agent-facing feed.
// Shared resource: any authenticated insurance OR property user can read.
// Returns events from 120 days ago through 1 year ahead, plus the nearest
// upcoming event per key for the countdown badges. The backward window feeds the
// "Recent results" table — 120 days rather than 30 so it reliably covers at least
// one of each cadence (CPI monthly, FOMC ~6-weekly, MAS MPS quarterly).
export async function GET() {
    const { user, profile } = await getServerUser()
    if (!user || !profile) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const allowed =
        canAccessInsurance(profile.role, profile.app_type) ||
        canAccessProperty(profile.role, profile.app_type)
    if (!allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const today = new Date()
    const from = new Date(today)
    from.setDate(from.getDate() - 120)
    const to = new Date(today)
    to.setFullYear(to.getFullYear() + 1)

    const events = await getUpcomingEvents(from.toISOString().slice(0, 10), to.toISOString().slice(0, 10))
    const nearest = getNearestByKey(events, today.toISOString().slice(0, 10))

    return NextResponse.json({ data: events, nearest })
}
