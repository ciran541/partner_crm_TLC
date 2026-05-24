import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { processReminders } from '@/lib/property/processReminders'

export async function POST() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const result = await processReminders()

    return NextResponse.json({
        ok: true,
        processed: result.processed,
        caseStatusUpdated: result.caseStatusUpdated,
        emailsSent: result.emailsSent,
        errors: result.errors,
        ranAt: new Date().toISOString(),
    })
}
