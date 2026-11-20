import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { syncInsuranceFollowUp } from '@/lib/google/syncFollowUpInsurance'
import { autoRemark } from '@/lib/insurance/followUps'
import { INACTIVE_STAGE, OPEN_STAGES } from '@/lib/insurance/stages'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format')

const followupSchema = z.object({
    follow_up_date: z.union([DATE, z.literal(''), z.null()]).optional(),
    follow_up_remark: z.string().max(500, 'Remark is too long (500 characters max)').optional(),
    /** Move the case to another stage in the same save (Inactive / an open stage only). */
    stage: z.string().optional(),
    /** Closed Lost only: stop following up this client. */
    no_follow_up: z.boolean().optional(),
    /** Closed Won only: client agreed to a reminder on the follow-up date. */
    client_reminder_opt_in: z.boolean().optional(),
    /** Optional: record the banker(s) in the same save (Track board's move into Pending Docs). */
    referred_bankers: z.array(z.object({ bank: z.string().max(100), name: z.string().max(100) })).max(20).optional(),
})

/** Stages this route may move a case INTO. Closed Won / Lost go through their closing forms. */
const MOVABLE_TO: string[] = [INACTIVE_STAGE, ...OPEN_STAGES]

/**
 * PATCH /api/insurance/cases/[id]/followup — "Update follow-up".
 *
 * Body: { follow_up_date, follow_up_remark?, stage?, no_follow_up?, client_reminder_opt_in?, referred_bankers? }
 *
 * The one place a follow-up changes (Action Centre, case page, workflow). Rules
 * (lib/insurance/followUps.ts): a date is required unless the case is Closed
 * Lost and `no_follow_up` is set; a blank remark gets the stage's default; the
 * reminder box only exists on Closed Won.
 *
 * Written with the CALLER's session (RLS: owner or admin), not the service role,
 * so the history row the DB trigger writes records who actually made the change,
 * and the cases_protect_admin_fields trigger applies as for any browser write.
 * The DB enforces the same rules again (20261125000000_follow_up_required.sql).
 */
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const { id } = await params
    const db = await createServerSupabaseClient()

    const { data: existing } = await db
        .from('cases')
        .select('created_by, stage, client_name, client_mobile')
        .eq('id', id)
        .single()

    if (!existing) {
        return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }
    if (existing.created_by !== auth.userId && !auth.isAdmin) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const parsed = followupSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, { status: 400 })
    }
    const body = parsed.data

    // ── Stage ────────────────────────────────────────────────────────────────
    const stage = body.stage ?? existing.stage
    if (stage !== existing.stage) {
        if (existing.stage === 'Closed Won') {
            return NextResponse.json({ error: 'A Closed Won case can’t change stage. Use Revisit to start the next cycle.' }, { status: 400 })
        }
        if (!MOVABLE_TO.includes(stage)) {
            return NextResponse.json({ error: `To mark a case ${stage}, use the closing form on the case page.` }, { status: 400 })
        }
    }

    // ── Date / don't follow up ───────────────────────────────────────────────
    const noFollowUp = body.no_follow_up === true
    if (noFollowUp && stage !== 'Closed Lost') {
        return NextResponse.json({ error: '“Don’t follow up” is only available on Closed Lost cases.' }, { status: 400 })
    }
    const date = noFollowUp ? null : (body.follow_up_date || null)
    if (!noFollowUp && !date) {
        return NextResponse.json({ error: 'Set a follow-up date — every case needs one.' }, { status: 400 })
    }

    const remark = noFollowUp ? null : (body.follow_up_remark?.trim() || autoRemark(stage) || null)

    const updates: Record<string, unknown> = {
        follow_up_date: date,
        follow_up_remark: remark,
        no_follow_up: noFollowUp,
        updated_at: new Date().toISOString(),
    }
    if (stage !== existing.stage) updates.stage = stage
    if (body.referred_bankers) updates.referred_bankers = body.referred_bankers
    if (stage === 'Closed Won' && body.client_reminder_opt_in !== undefined) {
        updates.client_reminder_opt_in = body.client_reminder_opt_in
    }

    const { data: saved, error } = await db
        .from('cases')
        .update(updates)
        .eq('id', id)
        .select('id, stage, follow_up_date, follow_up_remark, no_follow_up, client_reminder_opt_in, referred_bankers')
        .single()

    if (error || !saved) {
        console.error('Insurance follow-up PATCH error:', error)
        // A DB rule message (e.g. the paid-commission freeze) is written for agents.
        const msg = error?.code === '42501' || error?.code === '23514' ? error.message : 'Failed to update follow-up'
        return NextResponse.json({ error: msg }, { status: 500 })
    }

    // Calendar event lands in the OWNING agent's calendar regardless of who edits.
    // Awaited (not fire-and-forget) so the DB row is committed before this
    // response returns — otherwise a second quick follow-up change can race the
    // still-in-flight first sync and see "no existing event", creating a
    // duplicate instead of updating. syncInsuranceFollowUp never throws.
    await syncInsuranceFollowUp(
        existing.created_by,
        id,
        date ? 'upsert' : 'delete',
        date,
        existing.client_name,
        `${APP_URL}/insurance/dashboard/cases/${id}`,
        existing.client_mobile,
    ).catch(err => console.error('[Calendar sync] insurance followup:', err))

    return NextResponse.json({ success: true, case: saved })
}

/**
 * GET /api/insurance/cases/[id]/followup — the case's follow-up history, newest first.
 * RLS on case_follow_ups limits it to the case owner and admins.
 */
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const { id } = await params
    const db = await createServerSupabaseClient()
    const { data, error } = await db
        .from('case_follow_ups')
        .select('id, case_id, follow_up_date, remark, stage, no_follow_up, set_by, created_at, profiles:set_by(name)')
        .eq('case_id', id)
        .order('created_at', { ascending: false })
        .limit(100)

    if (error) {
        console.error('Insurance follow-up history error:', error)
        return NextResponse.json({ error: 'Failed to load history' }, { status: 500 })
    }
    return NextResponse.json({ history: data ?? [] })
}
