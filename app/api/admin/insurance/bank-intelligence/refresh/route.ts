import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { discoverReports } from '@/lib/insurance/bankIntelligence'

// POST /api/admin/insurance/bank-intelligence/refresh — manual "Check for new
// reports" trigger, same effect as the daily cron. Guarded by requireAdminUser().
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const result = await discoverReports()
    return NextResponse.json({ success: true, ...result })
}
