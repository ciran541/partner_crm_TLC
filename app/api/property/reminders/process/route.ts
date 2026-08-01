import { NextResponse } from 'next/server'
import { processReminders } from '@/lib/property/processReminders'
import { requireCronAuth } from '@/lib/auth/requireCron'

// Called daily by Vercel Cron (see vercel.json).
// Also callable manually: GET /api/property/reminders/process
// with Authorization: Bearer {CRON_SECRET}
//
// This route predates lib/auth/requireCron.ts and had its own inline check that
// skipped verification entirely when CRON_SECRET was unset — meaning a
// production deploy missing that env var left this publicly triggerable, and it
// sends real email to clients. requireCronAuth fails CLOSED in production
// instead, matching every /api/cron/* route.
export async function GET(request: Request) {
    const cron = requireCronAuth(request)
    if (!cron.authorized) return cron.response

    const result = await processReminders()

    return NextResponse.json({
        ok: true,
        processed: result.processed,
        caseStatusUpdated: result.caseStatusUpdated,
        errors: result.errors,
        ranAt: new Date().toISOString(),
    })
}
