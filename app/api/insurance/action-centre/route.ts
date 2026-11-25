import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { todaySgt } from '@/lib/insurance/promotions'
import { addDays, SOON_DAYS } from '@/lib/insurance/followUps'
import { PIPELINE_STAGES } from '@/lib/insurance/stages'
import {
    ACTION_SECTIONS, isDay, nextCursor, parseCursor, sectionWindow,
    type ActionCounts, type ActionRow, type ActionSection,
} from '@/lib/insurance/actionCentre'

interface RowsResult { rows: ActionRow[]; total: number | null }

/**
 * GET /api/insurance/action-centre — the signed-in user's OWN follow-ups.
 *
 *   section=now       counts + first rows (dated up to 14 days ahead) + first
 *                     "needs a date" rows: the whole first screen in one call
 *   section=missing | overdue | today | soon    one block
 *   section=later     day 15+; optional from / to (YYYY-MM-DD), stage, search
 *   section=day       date=YYYY-MM-DD (calendar day)
 *   section=calendar  month=YYYY-MM: per-day counts and first names
 *   limit (default 20, max 200), cursor (the previous page's nextCursor)
 */
export async function GET(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const sp = new URL(request.url).searchParams
    const db = createAdminClient()
    const today = todaySgt()
    const bad = (error: string) => NextResponse.json({ error }, { status: 400 })
    const failed = (where: string, error: unknown) => {
        console.error(`[GET /api/insurance/action-centre] ${where}`, error)
        return NextResponse.json({ error: 'Failed to load follow-ups' }, { status: 500 })
    }

    const section = sp.get('section') ?? 'now'

    if (section === 'calendar') {
        const from = `${sp.get('month')}-01`
        if (!isDay(from)) return bad('month must be YYYY-MM')
        const [y, m] = from.split('-').map(Number)
        const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
        const { data, error } = await db.rpc('action_centre_calendar', { p_viewer: auth.userId, p_from: from, p_to: to })
        if (error) return failed('calendar', error)
        return NextResponse.json({ rows: data ?? [], nextCursor: null })
    }

    if (!ACTION_SECTIONS.includes(section as ActionSection)) return bad('Unknown section')
    const s = section as ActionSection
    const limit = Math.min(200, Math.max(1, Number.parseInt(sp.get('limit') ?? '20', 10) || 20))
    const rawCursor = sp.get('cursor')
    const cursor = parseCursor(rawCursor, s)
    if (rawCursor && !cursor) return bad('Invalid cursor')

    const page = (d: RowsResult, of: ActionSection) => {
        const rows = d.rows ?? []
        const total = d.total ?? null
        return { rows, total, nextCursor: nextCursor(rows, limit, of, total) }
    }

    if (s === 'now' && !cursor) {
        const { data, error } = await db.rpc('action_centre', {
            p_viewer: auth.userId, p_today: today, p_soon: addDays(today, SOON_DAYS), p_limit: limit,
        })
        if (error) return failed('now', error)
        const d = data as RowsResult & { missing: RowsResult; counts: Omit<ActionCounts, 'missing'> }
        return NextResponse.json({
            ...page(d, 'now'),
            meta: { counts: { ...d.counts, missing: d.missing.total ?? 0 } },
            missing: page(d.missing, 'missing'),
        })
    }

    if (s === 'missing') {
        const { data, error } = await db.rpc('action_centre_missing', {
            p_viewer: auth.userId, p_limit: limit,
            ...(cursor ? { p_cur_at: cursor.sort, p_cur_id: cursor.id } : {}),
        })
        if (error) return failed('missing', error)
        return NextResponse.json(page(data as RowsResult, s))
    }

    const from = sp.get('from'), to = sp.get('to'), date = sp.get('date'), stage = sp.get('stage')
    if ([from, to, date].some(v => v && !isDay(v))) return bad('Dates must be YYYY-MM-DD')
    if (stage && !(PIPELINE_STAGES as readonly string[]).includes(stage)) return bad('Unknown status')
    const w = sectionWindow(s, today, { from, to, date })
    if (!w) return bad('date is required')
    const search = sp.get('search')?.trim().slice(0, 80)
    if (search) {
        const { data, error } = await db.rpc('own_cases', {
            p_owner: auth.userId, p_limit: limit, p_sort: 'follow_up', p_drafts: true, p_count_only: true, p_search: search,
            p_follow_up_after: w.after, p_follow_up_to: w.to,
            ...(stage ? { p_stage: stage } : {}),
            ...(cursor ? { p_cursor_key: cursor.sort, p_cursor_id: cursor.id } : {}),
        })
        if (error) return failed(s, error)
        return NextResponse.json(page(data as RowsResult, s))
    }
    const { data, error } = await db.rpc('action_centre_dated', {
        p_viewer: auth.userId, p_after: w.after, p_to: w.to, p_limit: limit,
        ...(cursor ? { p_cur_date: cursor.sort, p_cur_id: cursor.id } : {}),
        ...(stage ? { p_stage: stage } : {}),
    })
    if (error) return failed(s, error)
    return NextResponse.json(page(data as RowsResult, s))
}
