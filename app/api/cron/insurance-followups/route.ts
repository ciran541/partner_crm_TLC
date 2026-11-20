import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/auth/requireCron'
import { processInsuranceFollowUps } from '@/lib/insurance/processInsuranceFollowUps'

// GET /api/cron/insurance-followups — daily Vercel cron (see vercel.json).
// Client reminders: Closed Won cases whose agent ticked "Client agreed to
// receive a reminder", on the follow-up date — one Privyr WhatsApp + one email.
// See lib/insurance/processInsuranceFollowUps.ts.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
    const auth = requireCronAuth(request)
    if (!auth.authorized) return auth.response

    const result = await processInsuranceFollowUps()

    return NextResponse.json({
        ok: true,
        processed: result.processed,
        privyrSent: result.privyrSent,
        emailsSent: result.emailsSent,
        errors: result.errors,
        ranAt: new Date().toISOString(),
    })
}
