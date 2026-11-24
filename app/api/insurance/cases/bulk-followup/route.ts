import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { syncInsuranceFollowUp } from '@/lib/google/syncFollowUpInsurance'
import { autoRemark, followUpLimit } from '@/lib/insurance/followUps'
import { INACTIVE_STAGE, OPEN_STAGES } from '@/lib/insurance/stages'
import { todaySgt } from '@/lib/insurance/promotions'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
export const maxDuration = 60

const schema = z.object({
    ids: z.array(z.string().uuid()).min(1).max(50),
    follow_up_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** true = also move them to Active. */
    activate: z.boolean(),
})

/**
 * POST /api/insurance/cases/bulk-followup: one follow-up date for several Inactive
 * cases, optionally making them Active. Case by case, so one client the date is too
 * late for doesn't stop the rest; those come back in `failed`. Written with the
 * caller's session (RLS + triggers apply, and history records who did it).
 */
export async function POST(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Choose up to 50 cases and a follow-up date.' }, { status: 400 })
    const { ids, follow_up_date, activate } = parsed.data
    const today = todaySgt()
    if (follow_up_date < today) return NextResponse.json({ error: 'The follow-up date must be today or later.' }, { status: 400 })

    const db = await createServerSupabaseClient()
    const { data: rows, error } = await db.from('cases')
        .select('id, created_by, stage, client_name, client_mobile, lock_in_end_date, follow_up_remark')
        .in('id', ids).eq('stage', INACTIVE_STAGE)
    if (error) return NextResponse.json({ error: 'Could not load the cases.' }, { status: 500 })

    const stage = activate ? OPEN_STAGES[0] : INACTIVE_STAGE
    const failed: { id: string; name: string; reason: string }[] = []
    let updated = 0
    const one = async (c: NonNullable<typeof rows>[number]) => {
        const name = c.client_name || 'Unnamed'
        const limit = followUpLimit(c, today, stage)
        if (limit && follow_up_date > limit) {
            failed.push({ id: c.id, name, reason: `no later than ${limit.split('-').reverse().join('/')}, 2 months before the lock-in ends` })
            return
        }
        const { data: saved, error: err } = await db.from('cases').update({
            follow_up_date,
            follow_up_remark: activate ? autoRemark(stage) : c.follow_up_remark,
            ...(activate ? { stage } : {}),
            updated_at: new Date().toISOString(),
        }).eq('id', c.id).eq('stage', INACTIVE_STAGE).select('id')
        if (err || !saved?.length) {
            failed.push({ id: c.id, name, reason: err?.code === '23514' ? err.message : 'could not be saved' })
            return
        }
        updated++
        await syncInsuranceFollowUp(c.created_by, c.id, 'upsert', follow_up_date, c.client_name,
            `${APP_URL}/insurance/dashboard/cases/${c.id}`, c.client_mobile)
            .catch(e => console.error('[Calendar sync] bulk follow-up:', e))
    }
    for (let i = 0; i < (rows ?? []).length; i += 5) await Promise.all(rows!.slice(i, i + 5).map(one))

    const missing = ids.length - (rows?.length ?? 0)
    return NextResponse.json({ updated, failed, skipped: missing })
}
