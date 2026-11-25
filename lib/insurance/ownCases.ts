/**
 * An owner's case lists: Cases, Track, Upcoming Lock-ins, Earnings. Pure (no
 * React, no network): list keys, and how a moved Track card changes the loaded
 * columns. SQL side: migration 20261213000000_own_cases.sql.
 */

import type { CaseListRow } from '@/lib/insurance/caseQuery'
import type { ListPage } from '@/lib/shared/listStore'

export interface OwnCaseQuery {
    /** One stage; unset = every stage. */
    stage?: string
    /** 'updated' (default) | 'follow_up' | 'lock_in' | 'closed' */
    sort?: 'updated' | 'follow_up' | 'lock_in' | 'closed'
    search?: string
    /** Created between (YYYY-MM-DD, inclusive) or in a month (YYYY-MM). */
    from?: string
    to?: string
    month?: string
    /** Closed Won cases closed in this year 'YYYY' or month 'YYYY-MM'. */
    closed?: string
    followUpTo?: string
    bankerName?: string
    bankerBank?: string
    lockInFrom?: string
    lockInTo?: string
    /** Include planner drafts. */
    drafts?: boolean
    /** Total only, no loan volume (the screen doesn't show it). */
    countOnly?: boolean
}

export const OWN_CASES_API = '/api/insurance/my-cases'
export const TRACK_API = '/api/insurance/my-cases/track'
export const EARNINGS_API = '/api/insurance/my-earnings'
export const CLOSED_MONTHS_API = '/api/insurance/cases/closed-by-month'
export const DASHBOARD_KEY = '/api/insurance/dashboard'

/** A search runs from two characters: one matches almost everything. */
export const MIN_SEARCH = 2

const url = (base: string, params: Record<string, string | boolean | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v) p.set(k, String(v))
    const qs = p.toString()
    return qs ? `${base}?${qs}` : base
}

const searchTerm = (s?: string) => ((s ?? '').trim().length >= MIN_SEARCH ? s!.trim() : undefined)

export function ownCasesKey(q: OwnCaseQuery): string {
    return url(OWN_CASES_API, {
        stage: q.stage, sort: q.sort, search: searchTerm(q.search), from: q.from, to: q.to, month: q.month, closed: q.closed,
        followUpTo: q.followUpTo, bankerName: q.bankerName, bankerBank: q.bankerName ? q.bankerBank : undefined,
        lockInFrom: q.lockInFrom, lockInTo: q.lockInTo, drafts: q.drafts, countOnly: q.countOnly,
    })
}

// ─── Track ───────────────────────────────────────────────────────────────────

export interface TrackFilter { search?: string; followUpTo?: string; bankerName?: string; bankerBank?: string }

export const trackKey = (f: TrackFilter) => url(TRACK_API, {
    search: searchTerm(f.search), followUpTo: f.followUpTo, bankerName: f.bankerName, bankerBank: f.bankerName ? f.bankerBank : undefined,
})
export const trackColumnKey = (stage: string, f: TrackFilter) => ownCasesKey({ ...f, stage, sort: 'follow_up' })

/** The filters a track request was made with (to fill its columns). */
export function trackFilterOf(key: string): TrackFilter {
    const p = new URLSearchParams(key.split('?')[1] ?? '')
    const get = (k: string) => p.get(k) ?? undefined
    return { search: get('search'), followUpTo: get('followUpTo'), bankerName: get('bankerName'), bankerBank: get('bankerBank') }
}

/** Is this key a Track column? (Only those are edited in place.) */
const columnParams = (key: string): URLSearchParams | null => {
    const [base, qs] = key.split('?')
    const p = new URLSearchParams(qs ?? '')
    return base === OWN_CASES_API && p.get('sort') === 'follow_up' ? p : null
}

function inColumn(p: URLSearchParams, r: CaseListRow): boolean {
    if (r.stage !== p.get('stage')) return false
    const to = p.get('followUpTo')
    if (to && !(r.follow_up_date && r.follow_up_date.slice(0, 10) <= to)) return false
    const name = p.get('bankerName')
    if (name && !(r.referred_bankers ?? []).some(b => b.name === name && b.bank === (p.get('bankerBank') ?? ''))) return false
    const s = p.get('search')?.toLowerCase()
    return !s || [r.client_name, r.client_mobile, r.client_email].some(v => (v ?? '').toLowerCase().includes(s))
}

// Undated last, like the database.
const order = (a: CaseListRow, b: CaseListRow) => {
    const x = `${a.follow_up_date?.slice(0, 10) ?? '9999-99-99'}_${a.id}`
    const y = `${b.follow_up_date?.slice(0, 10) ?? '9999-99-99'}_${b.id}`
    return x < y ? -1 : x > y ? 1 : 0
}

/** Move a saved card between the loaded Track columns, with their counts and volume. */
export function applyMove(key: string, page: ListPage, before: CaseListRow, after: CaseListRow): ListPage {
    const p = columnParams(key)
    if (!p) return page
    const was = inColumn(p, before)
    const is = inColumn(p, after)
    if (!was && !is) return page

    let rows = (page.rows as CaseListRow[]).filter(r => r.id !== after.id)
    if (is) {
        const last = rows[rows.length - 1]
        // Past the last loaded card, it arrives with its own page.
        if (!page.nextCursor || (last && order(after, last) < 0)) rows = [...rows, after].sort(order)
    }
    const change = (is ? 1 : 0) - (was ? 1 : 0)
    const meta = page.meta as { loanVolume?: number } | undefined
    return {
        ...page, rows,
        total: page.total == null ? null : Math.max(0, page.total + change),
        meta: meta?.loanVolume == null ? meta : { ...meta, loanVolume: Math.max(0, meta.loanVolume + change * Number(after.loan_value ?? 0)) },
    }
}

// ─── Earnings ────────────────────────────────────────────────────────────────

export type EarningsTab = 'all' | 'closed_unpaid' | 'closed_paid'
export interface MonthEarned { month: string; cases: number; loan_volume?: number; agent_share: number }
export interface EarningsMeta {
    awaiting: number
    awaiting_cases: number
    closed_cases: number
    counts: Record<EarningsTab, number>
    /** Every month with a closing. */
    months: MonthEarned[]
    /** The months of the list on screen, however many rows are loaded. */
    groups: MonthEarned[]
}

export const earningsKey = (scope: string, tab: EarningsTab, agent?: string) =>
    url(EARNINGS_API, { scope: scope === 'all' ? undefined : scope, tab: tab === 'all' ? undefined : tab, agent })

// ─── Cursor ──────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
// What the database writes: a date, infinity, or a timestamp with its offset.
const SORT_KEY = /^(-?infinity|\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?)?)$/

export function parseOwnCursor(raw: string | null): { key: string; id: string } | null {
    if (!raw) return null
    const i = raw.lastIndexOf('_')
    const key = raw.slice(0, i)
    const id = raw.slice(i + 1)
    return i > 0 && SORT_KEY.test(key) && UUID.test(id) ? { key, id } : null
}
