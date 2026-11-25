/**
 * Action Centre list logic. Pure (no React, no network): which list a case
 * belongs to, page cursors, and how a saved follow-up moves a case between the
 * lists already on screen. SQL side: migration 20261212000000_action_centre.sql.
 */

import { addDays, followUpBucket, needsFollowUp, SOON_DAYS, type FollowUpBucket } from '@/lib/insurance/followUps'
import type { ListPage } from '@/lib/shared/listStore'
import type { Case } from '@/lib/types'

export type ActionRow = Pick<Case,
    'id' | 'stage' | 'case_type' | 'client_name' | 'client_mobile' | 'client_email' | 'follow_up_date' | 'follow_up_remark' |
    'no_follow_up' | 'client_reminder_opt_in' | 'lock_in_end_date' | 'closed_won_data' | 'updated_at'>

export interface ActionCounts { missing: number; overdue: number; today: number; soon: number; later: number }
export interface ActionMeta { counts: ActionCounts }
/** A calendar day: `id` is the date. */
export interface ActionDay { id: string; count: number; names: string[] }

/** 'now' = everything dated up to the end of the next-14-days window. */
export type ActionSection = 'now' | 'missing' | FollowUpBucket | 'day'
export const ACTION_SECTIONS: ActionSection[] = ['now', 'missing', 'overdue', 'today', 'soon', 'later', 'day']

const API = '/api/insurance/action-centre'
export const NOW_KEY = `${API}?section=now`
export const MISSING_KEY = `${API}?section=missing`
export const CALENDAR_PREFIX = `${API}?section=calendar`

export function sectionKey(section: ActionSection, filters: Record<string, string | undefined> = {}): string {
    const p = new URLSearchParams({ section })
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v)
    return `${API}?${p}`
}

/** Date window (after, to] of a dated list. 'later' can be narrowed but never reaches back into the 14 days. */
export function sectionWindow(
    section: ActionSection, today: string, f: { from?: string | null; to?: string | null; date?: string | null } = {},
): { after: string; to: string } | null {
    const soon = addDays(today, SOON_DAYS)
    switch (section) {
        case 'now': return { after: '-infinity', to: soon }
        case 'overdue': return { after: '-infinity', to: addDays(today, -1) }
        case 'today': return { after: addDays(today, -1), to: today }
        case 'soon': return { after: today, to: soon }
        case 'later': {
            const dayBefore = f.from ? addDays(f.from, -1) : soon
            return { after: dayBefore > soon ? dayBefore : soon, to: f.to || 'infinity' }
        }
        case 'day': return f.date ? { after: addDays(f.date, -1), to: f.date } : null
        default: return null
    }
}

// ─── Cursors ─────────────────────────────────────────────────────────────────

/** Where the next page starts: the last row's sort value + id. null = no more rows. */
export function nextCursor(rows: ActionRow[], limit: number, section: ActionSection, total: number | null = null): string | null {
    const last = rows[rows.length - 1]
    if (!last || rows.length < limit || (total != null && rows.length >= total)) return null
    const sort = section === 'missing' ? last.updated_at ?? '1970-01-01T00:00:00Z' : last.follow_up_date
    return `${sort}_${last.id}`
}

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export const isDay = (v: string | null | undefined): v is string =>
    !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v

export function parseCursor(raw: string | null, section: ActionSection): { sort: string; id: string } | null {
    if (!raw) return null
    const i = raw.lastIndexOf('_')
    const sort = raw.slice(0, i)
    const id = raw.slice(i + 1)
    if (i < 1 || !UUID.test(id)) return null
    const ok = section === 'missing' ? /^\d{4}-\d{2}-\d{2}T/.test(sort) && !Number.isNaN(Date.parse(sort)) : isDay(sort)
    return ok ? { sort, id } : null
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

export type ActionTab = keyof ActionCounts
/** Tab order on screen. */
export const TAB_ORDER: ActionTab[] = ['missing', 'overdue', 'today', 'soon', 'later']
/** Which tab to work on first. */
const URGENCY: ActionTab[] = ['overdue', 'today', 'soon', 'missing', 'later']

/** The most urgent tab with cases, other than `except`; null = none. */
export function urgentTab(counts: ActionCounts, except?: ActionTab): ActionTab | null {
    return URGENCY.find(t => t !== except && counts[t] > 0) ?? null
}

export const nothingDue = (c: ActionCounts) => c.missing + c.overdue + c.today + c.soon === 0

/**
 * The first 'now' rows are one date-ordered stream, so they already hold the
 * start of the tabs: fill those instead of asking again. A tab whose cases start
 * further down the stream is left to load itself.
 */
export function tabPages(rows: ActionRow[], counts: ActionCounts, today: string): { section: 'overdue' | 'today' | 'soon'; rows: ActionRow[]; total: number; nextCursor: string | null }[] {
    return (['overdue', 'today', 'soon'] as const).flatMap(section => {
        const total = counts[section]
        const mine = rows.filter(r => r.follow_up_date && followUpBucket(r.follow_up_date, today) === section)
        if (mine.length === 0 && total > 0) return []
        return [{ section, rows: mine, total, nextCursor: nextCursor(mine, 1, section, total) }]
    })
}

// ─── After a save ────────────────────────────────────────────────────────────

export function bucketOf(r: ActionRow, today: string): keyof ActionCounts | null {
    if (r.follow_up_date) return followUpBucket(r.follow_up_date, today)
    return needsFollowUp(r) ? 'missing' : null
}

/** Does this case belong in the list loaded under `key`? */
export function belongsIn(key: string, r: ActionRow, today: string): boolean {
    const p = new URLSearchParams(key.split('?')[1] ?? '')
    const section = p.get('section') as ActionSection
    if (section === 'missing') return bucketOf(r, today) === 'missing'
    const w = sectionWindow(section, today, { from: p.get('from'), to: p.get('to'), date: p.get('date') })
    const d = r.follow_up_date?.slice(0, 10)
    if (!w || !d) return false
    if (w.after !== '-infinity' && d <= w.after) return false
    if (w.to !== 'infinity' && d > w.to) return false
    const stage = p.get('stage')
    if (stage && r.stage !== stage) return false
    const s = p.get('search')?.trim().toLowerCase()
    return !s || [r.client_name, r.client_mobile, r.client_email].some(v => (v ?? '').toLowerCase().includes(s))
}

const order = (a: ActionRow, b: ActionRow) => {
    const x = `${a.follow_up_date}_${a.id}`
    const y = `${b.follow_up_date}_${b.id}`
    return x < y ? -1 : x > y ? 1 : 0
}

/**
 * Move one saved case between the loaded lists: no refetch, no scroll jump.
 * Calendar months return null (dropped, so the one on screen reloads).
 */
export function applySave(key: string, page: ListPage, before: ActionRow, after: ActionRow, today: string): ListPage | null {
    if (key.startsWith(CALENDAR_PREFIX)) return null
    const was = belongsIn(key, before, today)
    const is = belongsIn(key, after, today)

    let rows = (page.rows as ActionRow[]).filter(r => r.id !== after.id)
    if (is) {
        const last = rows[rows.length - 1]
        // Past the last loaded row, it arrives with its own page.
        if (!page.nextCursor || (last && order(after, last) < 0)) rows = [...rows, after].sort(order)
    }

    let meta = page.meta as ActionMeta | undefined
    if (meta?.counts) {
        const counts = { ...meta.counts }
        const from = bucketOf(before, today)
        const to = bucketOf(after, today)
        if (from) counts[from] = Math.max(0, counts[from] - 1)
        if (to) counts[to] += 1
        meta = { ...meta, counts }
    }
    const total = page.total == null ? null : Math.max(0, page.total + (is ? 1 : 0) - (was ? 1 : 0))
    return { ...page, rows, total, meta }
}
