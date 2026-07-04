import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { refreshAll } from '@/lib/insurance/economicCalendar'

// POST /api/admin/insurance/calendar/refresh — manual "Refresh now" trigger
// for FOMC + CPI values, same effect as the daily cron. Guarded by requireAdminUser().
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const result = await refreshAll()
    return NextResponse.json({ success: true, ...result })
}
