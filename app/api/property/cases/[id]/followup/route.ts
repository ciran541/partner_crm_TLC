import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePropertyUser } from '@/lib/auth/requirePropertyUser'
import { syncFollowUpToCalendar } from '@/lib/google/syncFollowUp'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    const { id } = await params
    const admin = createAdminClient()

    // Verify the agent owns this case; also fetch fields needed for calendar sync
    const { data: existing } = await admin
        .from('property_cases')
        .select('agent_id, followup_preference, follow_up_date, client_name, client_mobile')
        .eq('id', id)
        .single()

    if (!existing || existing.agent_id !== auth.userId) {
        return NextResponse.json({ error: 'Case not found or access denied' }, { status: 404 })
    }

    let body: { follow_up_date?: string; completed?: boolean }
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const update: Record<string, unknown> = {}

    if (body.completed) {
        update.followup_completed_at = new Date().toISOString()
    } else if (body.follow_up_date) {
        update.follow_up_date = body.follow_up_date
    } else {
        return NextResponse.json({ error: 'Provide follow_up_date or completed: true' }, { status: 400 })
    }

    const { error } = await admin
        .from('property_cases')
        .update(update)
        .eq('id', id)

    if (error) {
        console.error('Follow-up PATCH error:', error)
        return NextResponse.json({ error: 'Failed to update follow-up' }, { status: 500 })
    }

    // Sync Google Calendar. Awaited (not fire-and-forget) so the DB row is
    // committed before this response returns — otherwise a second quick
    // follow-up change can race the still-in-flight first sync and see "no
    // existing event", creating a duplicate instead of updating.
    // syncFollowUpToCalendar never throws (internal try/catch), so errors
    // still never surface to the agent or fail this save.
    const preference = existing.followup_preference as 'self' | 'tlc' | null
    const newDate = body.follow_up_date ?? existing.follow_up_date
    const action = body.completed ? 'delete' : 'upsert'

    await syncFollowUpToCalendar(
        auth.userId,
        id,
        preference,
        action,
        newDate,
        existing.client_name,
        `${APP_URL}/property/cases/${id}`,
        existing.client_mobile
    ).catch(err => console.error('[Calendar sync] followup patch:', err))

    return NextResponse.json({ success: true })
}
