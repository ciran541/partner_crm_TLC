import { NextResponse } from 'next/server'
import { discoverReports } from '@/lib/insurance/bankIntelligence'
import { requireCronAuth } from '@/lib/auth/requireCron'

// GET /api/cron/bank-intelligence — daily Vercel cron. Checks each bank's
// research listing for a new monthly report, then extracts a summary from the
// PDF via Claude (draft — still gated by admin review before agents see it).
export const dynamic = 'force-dynamic'
export const maxDuration = 60   // PDF downloads + Claude document extraction take longer than a text call

export async function GET(request: Request) {
    const auth = requireCronAuth(request)
    if (!auth.authorized) return auth.response

    const result = await discoverReports()
    return NextResponse.json({ success: true, ...result })
}
