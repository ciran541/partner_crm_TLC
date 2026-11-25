import { describe, expect, it } from 'vitest'
import { applyMove, earningsKey, ownCasesKey, parseOwnCursor, trackColumnKey, trackFilterOf, trackKey } from '../ownCases'
import type { CaseListRow } from '../caseQuery'
import type { ListPage } from '@/lib/shared/listStore'

const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const row = (n: number, stage: string, date: string | null, over: Partial<CaseListRow> = {}) => ({
    id: uid(n), stage, client_name: `Client ${n}`, client_mobile: '9123', client_email: null, follow_up_date: date,
    referred_bankers: [], loan_value: 100, ...over,
}) as unknown as CaseListRow
const page = (rows: CaseListRow[], over: Partial<ListPage> = {}): ListPage => ({ rows, nextCursor: null, total: rows.length, meta: { loanVolume: rows.length * 100 }, fetchedAt: 1, ...over })
const ids = (p: ListPage) => p.rows.map(r => (r as CaseListRow).id)

describe('keys', () => {
    it('ignore a one-letter search', () => {
        expect(ownCasesKey({ stage: 'Inactive', search: ' a ' })).toBe(ownCasesKey({ stage: 'Inactive' }))
        expect(ownCasesKey({ stage: 'Inactive', search: 'an' })).toContain('search=an')
    })
    it('a track request fills the columns the board reads', () => {
        const f = { search: 'tan', followUpTo: '2026-11-24', bankerName: 'Ann & Co', bankerBank: '' }
        expect(trackColumnKey('Pending Docs', trackFilterOf(trackKey(f)))).toBe(trackColumnKey('Pending Docs', f))
        expect(trackColumnKey('Pending Docs', trackFilterOf(trackKey({})))).toBe(trackColumnKey('Pending Docs', { search: '' }))
    })
    it('earnings: all time and all tabs send nothing', () => {
        expect(earningsKey('all', 'all')).toBe('/api/insurance/my-earnings')
        expect(earningsKey('2026', 'closed_paid', 'x')).toBe('/api/insurance/my-earnings?scope=2026&tab=closed_paid&agent=x')
    })
})

describe('cursor', () => {
    it('accepts what the database writes', () => {
        for (const k of ['2026-11-25', 'infinity', '-infinity', '2026-11-25 10:07:39.245123+00', '1970-01-01 00:00:00+00', '2026-11-25 18:07:39+05:30'])
            expect(parseOwnCursor(`${k}_${uid(1)}`)).toEqual({ key: k, id: uid(1) })
    })
    it('rejects anything else', () => {
        for (const bad of ['x', `drop table_${uid(1)}`, '2026-11-25_1', `_${uid(1)}`]) expect(parseOwnCursor(bad)).toBeNull()
    })
})

describe('applyMove', () => {
    const before = row(2, 'Touched Base', '2026-11-30')
    const after = { ...before, stage: 'Pending Docs', follow_up_date: '2026-12-05' } as CaseListRow
    const from = trackColumnKey('Touched Base', {})
    const to = trackColumnKey('Pending Docs', {})

    it('leaves one column and joins the other, in order, with counts and volume', () => {
        const a = applyMove(from, page([row(1, 'Touched Base', '2026-11-28'), before]), before, after)
        expect(ids(a)).toEqual([uid(1)])
        expect([a.total, a.meta]).toEqual([1, { loanVolume: 100 }])
        const b = applyMove(to, page([row(3, 'Pending Docs', '2026-12-01'), row(4, 'Pending Docs', null)]), before, after)
        expect(ids(b)).toEqual([uid(3), uid(2), uid(4)])   // undated last
        expect([b.total, b.meta]).toEqual([3, { loanVolume: 300 }])
    })
    it('a card past the last loaded one is counted but waits for its page', () => {
        const b = applyMove(to, page([row(3, 'Pending Docs', '2026-12-01')], { nextCursor: 'c', total: 40 }), before, after)
        expect(ids(b)).toEqual([uid(3)])
        expect(b.total).toBe(41)
    })
    it('respects the board filters', () => {
        const banker = trackColumnKey('Pending Docs', { bankerName: 'Ann', bankerBank: 'DBS' })
        expect(applyMove(banker, page([]), before, after).total).toBe(0)
        const withAnn = { ...after, referred_bankers: [{ name: 'Ann', bank: 'DBS' }] } as CaseListRow
        expect(applyMove(banker, page([]), before, withAnn).total).toBe(1)
        expect(applyMove(trackColumnKey('Pending Docs', { followUpTo: '2026-11-24' }), page([]), before, after).total).toBe(0)
    })
    it('never touches other lists', () => {
        const p = page([before])
        expect(applyMove(ownCasesKey({ stage: 'Touched Base' }), p, before, after)).toBe(p)
        expect(applyMove('/api/insurance/dashboard', p, before, after)).toBe(p)
    })
})
