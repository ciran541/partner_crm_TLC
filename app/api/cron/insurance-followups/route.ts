import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/auth/requireCron'
import { processInsuranceFollowUps } from '@/lib/insurance/processInsuranceFollowUps'

// GET /api/cron/insurance-followups — daily Vercel cron (see vercel.json).
// Finds all insurance cases where follow_up_date = today (excluding Closed Lost)
// and POSTs each client to Privyr to trigger the automated WhatsApp template.
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
        errors: result.errors,
        ranAt: new Date().toISOString(),
    })
}
