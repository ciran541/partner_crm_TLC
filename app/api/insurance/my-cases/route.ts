import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { isDay } from '@/lib/insurance/actionCentre'
import { OWN_CASE_SORTS } from '@/lib/insurance/ownCases'
import { PIPELINE_STAGES } from '@/lib/insurance/stages'
import { cursorOf, isPeriod, limitOf, searchOf, toListBody, type OwnCasesResult } from '@/lib/insurance/ownCasesServer'

/**
 * GET /api/insurance/my-cases — the signed-in user's OWN cases, a page at a time.
 * Filters: see OwnCaseQuery (lib/insurance/ownCases.ts). limit (≤ 200), cursor.
 * { rows, nextCursor, total, meta: { loanVolume } }; total and volume describe
 * every match and come with the first page only.
 */
export async function GET(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const sp = new URL(request.url).searchParams
    const bad = (error: string) => NextResponse.json({ error }, { status: 400 })
    const get = (k: string) => sp.get(k)?.trim() || null

    const stage = get('stage'), sort = get('sort') ?? 'updated', month = get('month'), closed = get('closed')
    if (stage && !(PIPELINE_STAGES as readonly string[]).includes(stage)) return bad('Unknown status')
    if (!OWN_CASE_SORTS.includes(sort)) return bad('Unknown sort')
    if (['from', 'to', 'followUpTo', 'lockInFrom', 'lockInTo'].some(k => get(k) && !isDay(get(k)))) return bad('Dates must be YYYY-MM-DD')
    if (month && !isDay(`${month}-01`)) return bad('month must be YYYY-MM')
    if (closed && !isPeriod(closed)) return bad('closed must be YYYY or YYYY-MM')
    if (!!get('lockInFrom') !== !!get('lockInTo')) return bad('lockInFrom and lockInTo go together')
    if (sort === 'lock_in' && !get('lockInFrom')) return bad('lockInFrom is required')
    const cursor = cursorOf(sp)
    if (!cursor) return bad('Invalid cursor')

    const { data, error } = await createAdminClient().rpc('own_cases', {
        p_owner: auth.userId, p_limit: limitOf(sp), p_stage: stage, p_sort: sort, p_search: searchOf(sp),
        p_from: get('from'), p_to: get('to'), p_month: month, p_closed: closed,
        p_follow_up_to: get('followUpTo'), p_banker_name: get('bankerName'), p_banker_bank: get('bankerBank'),
        p_lock_in_from: get('lockInFrom'), p_lock_in_to: get('lockInTo'),
        p_drafts: sp.get('drafts') === 'true', p_count_only: sp.get('countOnly') === 'true',
        ...cursor,
    })
    if (error) {
        console.error('[GET /api/insurance/my-cases]', error)
        return NextResponse.json({ error: 'Failed to load cases' }, { status: 500 })
    }
    return NextResponse.json(toListBody(data as OwnCasesResult))
}
