import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { syncInsuranceFollowUp } from '@/lib/google/syncFollowUpInsurance'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

const followupSchema = z.object({
    follow_up_date: z.union([
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
        z.literal(''),
    ]).nullable().optional(),
})

/**
 * PATCH /api/insurance/cases/[id]/followup
 * Body: { follow_up_date: string } to set, or { follow_up_date: null } to clear.
 * Updates the case and syncs the case OWNER's Google Calendar (non-blocking).
 */
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const { id } = await params
    const admin = createAdminClient()

    const { data: existing } = await admin
        .from('cases')
        .select('created_by, follow_up_date, client_name')
        .eq('id', id)
        .single()

    if (!existing) {
        return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }
    // Owner or any admin may set the follow-up.
    if (existing.created_by !== auth.userId && !auth.isAdmin) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const parsed = followupSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, { status: 400 })
    }
    const body = parsed.data

    const clearing = body.follow_up_date === null || body.follow_up_date === ''
    const newDate = clearing ? null : body.follow_up_date

    const { error } = await admin
        .from('cases')
        .update({ follow_up_date: newDate, updated_at: new Date().toISOString() })
        .eq('id', id)

    if (error) {
        console.error('Insurance follow-up PATCH error:', error)
        return NextResponse.json({ error: 'Failed to update follow-up' }, { status: 500 })
    }

    // Calendar event lands in the OWNING agent's calendar regardless of who edits.
    // Awaited (not fire-and-forget) so the DB row is committed before this
    // response returns — otherwise a second quick follow-up change (the
    // "Saving…" button re-enables as soon as this request resolves) can race
    // the still-in-flight first sync and see "no existing event", creating a
    // duplicate instead of updating. syncInsuranceFollowUp never throws
    // (internal try/catch), so this still can't fail the save.
    await syncInsuranceFollowUp(
        existing.created_by,
        id,
        clearing ? 'delete' : 'upsert',
        newDate,
        existing.client_name,
        `${APP_URL}/insurance/dashboard/cases/${id}`,
    ).catch(err => console.error('[Calendar sync] insurance followup:', err))

    return NextResponse.json({ success: true })
}
