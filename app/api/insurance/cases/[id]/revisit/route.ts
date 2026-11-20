import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { revisitGate, buildRevisitCase } from '@/lib/insurance/revisit'
import { todaySgt } from '@/lib/insurance/promotions'
import { getCurrentSora } from '@/lib/insurance/sora'
import { syncInsuranceFollowUp } from '@/lib/google/syncFollowUpInsurance'
import type { Case } from '@/lib/types'

/**
 * POST /api/insurance/cases/[id]/revisit — start the next refinancing cycle for
 * a Closed Won or Closed Lost client (see lib/insurance/revisit.ts).
 *
 * Creates a NEW active case linked by parent_case_id — Refinancing after a win,
 * the same case type after a loss (another attempt at the same deal); the closed
 * case is not modified except that its follow-up date is cleared (the follow-up
 * has now been acted on — leaving it would keep reminding the agent about a
 * client who is already back in their pipeline).
 *
 * Guards (the same rule the button shows, enforced here):
 *   - caller owns the case, or is an admin
 *   - stage is Closed Won or Closed Lost (revisitGate)
 *   - today (SGT) is on/after the case's follow-up date
 *   - not already revisited — also enforced by a unique index, so two quick taps
 *     return the same new case instead of creating two
 *
 * Service role is used so an admin revisiting on an agent's behalf creates the
 * case for that agent (created_by = the case owner), and because the insert is
 * built entirely server-side from the closed case — nothing from the request body.
 */
export async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const { id } = await params
    const admin = createAdminClient()

    const { data: parent } = await admin.from('cases').select('*').eq('id', id).single<Case>()
    if (!parent) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    if (parent.created_by !== auth.userId && !auth.isAdmin) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const findChild = async () =>
        (await admin.from('cases').select('id').eq('parent_case_id', id).limit(1).maybeSingle()).data?.id as string | undefined

    const existingChild = await findChild()
    if (existingChild) return NextResponse.json({ id: existingChild, existed: true })

    const gate = revisitGate(parent, todaySgt())
    if (!gate.ok) return NextResponse.json({ error: gate.message, reason: gate.reason, unlocksOn: gate.unlocksOn }, { status: 400 })

    const sora = await getCurrentSora().catch(() => null)
    const { row } = buildRevisitCase(parent, todaySgt(), sora)

    const { data: created, error } = await admin
        .from('cases')
        // A new active case needs a follow-up like any other: today, "Engage
        // Prospect" (the DB fills the remark), so it heads the Action Centre.
        .insert({ ...row, created_by: parent.created_by, parent_case_id: id, follow_up_date: todaySgt() })
        .select('id')
        .single()

    if (error || !created) {
        // Lost a race with another tap/tab: the unique index kept it to one case.
        if (error?.code === '23505') {
            const child = await findChild()
            if (child) return NextResponse.json({ id: child, existed: true })
        }
        console.error('[POST /api/insurance/cases/[id]/revisit]', error)
        return NextResponse.json({ error: 'Could not start the revisit' }, { status: 500 })
    }

    // The follow-up has been acted on: stop reminding about the closed case.
    if (parent.follow_up_date) {
        await admin.from('cases').update({ follow_up_date: null }).eq('id', id)
        await syncInsuranceFollowUp(parent.created_by, id, 'delete', null, parent.client_name ?? null, '', parent.client_mobile ?? null)
            .catch(err => console.error('[Calendar sync] revisit:', err))
    }

    return NextResponse.json({ id: created.id })
}
