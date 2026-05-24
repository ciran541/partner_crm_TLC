import { NextResponse } from 'next/server'
import { processReminders } from '@/lib/property/processReminders'

// Called daily by Vercel Cron (see vercel.json).
// Also callable manually: GET /api/property/reminders/process
// with Authorization: Bearer {CRON_SECRET}
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET
    if (secret) {
        const authHeader = request.headers.get('authorization')
        if (authHeader !== `Bearer ${secret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
    }

    const result = await processReminders()

    return NextResponse.json({
        ok: true,
        processed: result.processed,
        caseStatusUpdated: result.caseStatusUpdated,
        errors: result.errors,
        ranAt: new Date().toISOString(),
    })
}
