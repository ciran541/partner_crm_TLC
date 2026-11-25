import { describe, expect, it } from 'vitest'
import {
    applySave, belongsIn, CALENDAR_PREFIX, isDay, MISSING_KEY, nextCursor, nothingDue, NOW_KEY, parseCursor, sectionKey, sectionWindow,
    tabPages, urgentTab,
    type ActionMeta, type ActionRow,
} from '../actionCentre'
import type { ListPage } from '@/lib/shared/listStore'

const TODAY = '2026-11-25'
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const row = (n: number, date: string | null, over: Partial<ActionRow> = {}) => ({
    id: uid(n), stage: 'Pending Docs', case_type: 'Purchase', client_name: `Client ${n}`, client_mobile: '91234567', client_email: null,
    follow_up_date: date, follow_up_remark: null, no_follow_up: false, client_reminder_opt_in: false, lock_in_end_date: null,
    closed_won_data: null, updated_at: '2026-11-20T01:02:03.456789+00:00', ...over,
}) as unknown as ActionRow
const page = (rows: ActionRow[], over: Partial<ListPage> = {}): ListPage => ({ rows, nextCursor: null, total: rows.length, fetchedAt: 1, ...over })
const counts = { missing: 1, overdue: 2, today: 0, soon: 1, later: 5 }
const idsOf = (p: ListPage | null) => p!.rows.map(r => (r as ActionRow).id)
const countsOf = (p: ListPage | null) => (p!.meta as ActionMeta).counts

describe('windows', () => {
    it('cover every date exactly once', () => {
        const dates = ['2020-01-01', '2026-11-24', TODAY, '2026-11-26', '2026-12-09', '2026-12-10', '2031-01-01']
        const at = (d: string) => (['overdue', 'today', 'soon', 'later'] as const).filter(s => belongsIn(sectionKey(s), row(1, d), TODAY))
        expect(dates.map(at)).toEqual([['overdue'], ['overdue'], ['today'], ['soon'], ['soon'], ['later'], ['later']])
        expect(dates.map(d => belongsIn(NOW_KEY, row(1, d), TODAY))).toEqual([true, true, true, true, true, false, false])
    })
    it('a later filter never reaches back into the 14 days', () => {
        expect(sectionWindow('later', TODAY, { from: '2026-01-01', to: '2026-12-31' })).toEqual({ after: '2026-12-09', to: '2026-12-31' })
        expect(sectionWindow('later', TODAY, { from: '2027-03-01', to: '2027-03-31' })).toEqual({ after: '2027-02-28', to: '2027-03-31' })
    })
    it('later honours status and search', () => {
        const k = sectionKey('later', { stage: 'Closed Won', search: 'CLIENT 7' })
        expect(belongsIn(k, row(7, '2027-01-01', { stage: 'Closed Won' }), TODAY)).toBe(true)
        expect(belongsIn(k, row(7, '2027-01-01'), TODAY)).toBe(false)
        expect(belongsIn(k, row(8, '2027-01-01', { stage: 'Closed Won' }), TODAY)).toBe(false)
    })
})

describe('cursors', () => {
    it('round-trip', () => {
        expect(parseCursor(nextCursor([row(1, '2026-11-01')], 1, 'now'), 'now')).toEqual({ sort: '2026-11-01', id: uid(1) })
        expect(parseCursor(nextCursor([row(1, null)], 1, 'missing'), 'missing')).toEqual({ sort: '2026-11-20T01:02:03.456789+00:00', id: uid(1) })
    })
    it('end when the page is short or everything is loaded', () => {
        expect(nextCursor([row(1, '2026-11-01')], 20, 'now')).toBeNull()
        expect(nextCursor([row(1, '2026-11-01')], 1, 'now', 1)).toBeNull()
        expect(nextCursor([], 20, 'now')).toBeNull()
    })
    it('reject anything malformed', () => {
        for (const bad of ['x', '2026-11-01', `2026-13-40_${uid(1)}`, '2026-11-01_nope', `_${uid(1)}`]) expect(parseCursor(bad, 'now')).toBeNull()
        expect(isDay('2026-02-30')).toBe(false)
        expect(isDay('null-01')).toBe(false)
    })
})

describe('tabs', () => {
    const zero = { missing: 0, overdue: 0, today: 0, soon: 0, later: 0 }
    it('opens on the most urgent tab with cases', () => {
        expect(urgentTab({ missing: 3, overdue: 1, today: 1, soon: 1, later: 1 })).toBe('overdue')
        expect(urgentTab({ ...zero, today: 1, later: 9 })).toBe('today')
        expect(urgentTab({ ...zero, missing: 1, later: 9 })).toBe('missing')
        expect(urgentTab({ ...zero, later: 9 })).toBe('later')
        expect(urgentTab(zero)).toBeNull()
        expect(urgentTab({ ...zero, overdue: 2, soon: 1 }, 'overdue')).toBe('soon')
    })
    it('is caught up only when nothing is due or undated', () => {
        expect(nothingDue({ ...zero, later: 5 })).toBe(true)
        expect(nothingDue({ ...zero, missing: 1 })).toBe(false)
    })
    it('the first rows fill every tab they fully or partly cover', () => {
        const rows = [row(1, '2026-11-01'), row(2, TODAY), row(3, '2026-11-28')]
        const pages = tabPages(rows, { ...zero, overdue: 1, today: 1, soon: 4 }, TODAY)
        expect(pages.map(p => [p.section, p.rows.length, p.total, p.nextCursor])).toEqual([
            ['overdue', 1, 1, null], ['today', 1, 1, null], ['soon', 1, 4, `2026-11-28_${uid(3)}`],
        ])
    })
    it('a tab the first rows have not reached loads itself; a truly empty one is filled as empty', () => {
        const pages = tabPages([row(1, '2026-11-01')], { ...zero, overdue: 500, soon: 2 }, TODAY)
        expect(pages.map(p => p.section)).toEqual(['overdue', 'today'])
        expect(pages[1]).toMatchObject({ rows: [], total: 0, nextCursor: null })
    })
})

describe('applySave', () => {
    const before = row(2, '2026-11-20')

    it('moves a case later and fixes the counts', () => {
        const after = { ...before, follow_up_date: '2027-01-05' }
        const now = applySave(NOW_KEY, page([row(1, '2026-11-10'), before], { meta: { counts } }), before, after, TODAY)
        expect(idsOf(now)).toEqual([uid(1)])
        expect(now!.total).toBe(1)
        expect(countsOf(now)).toEqual({ ...counts, overdue: 1, later: 6 })
        const later = applySave(sectionKey('later'), page([row(5, '2026-12-25'), row(6, '2027-02-01')]), before, after, TODAY)
        expect(idsOf(later)).toEqual([uid(5), uid(2), uid(6)])
        expect(later!.total).toBe(3)
    })
    it('a case past the last loaded row waits for its own page but is counted', () => {
        const after = { ...before, follow_up_date: '2028-01-05' }
        const later = applySave(sectionKey('later'), page([row(5, '2026-12-25')], { nextCursor: 'c', total: 40 }), before, after, TODAY)
        expect(later!.rows).toHaveLength(1)
        expect(later!.total).toBe(41)
    })
    it('setting a first date leaves "needs a date"', () => {
        const none = row(3, null)
        const after = { ...none, follow_up_date: TODAY }
        expect(applySave(MISSING_KEY, page([none]), none, after, TODAY)).toMatchObject({ rows: [], total: 0 })
        const now = applySave(NOW_KEY, page([], { meta: { counts } }), none, after, TODAY)
        expect(countsOf(now)).toEqual({ ...counts, missing: 0, today: 1 })
    })
    it('"Don’t follow up" leaves every list', () => {
        const lost = row(4, '2026-11-01', { stage: 'Closed Lost' })
        const after = { ...lost, follow_up_date: null, no_follow_up: true } as unknown as ActionRow
        expect(applySave(MISSING_KEY, page([]), lost, after, TODAY)!.total).toBe(0)
        expect(countsOf(applySave(NOW_KEY, page([lost], { meta: { counts } }), lost, after, TODAY))).toEqual({ ...counts, overdue: 1 })
    })
    it('drops calendar months so they reload', () => {
        expect(applySave(`${CALENDAR_PREFIX}&month=2026-11`, page([]), before, before, TODAY)).toBeNull()
    })
})
