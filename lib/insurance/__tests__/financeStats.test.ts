import { describe, expect, it } from 'vitest'
import {
    agentRanking, agentOutstanding, bankState, breakdown, cashHeld, compare, forAgent, groupByAgent, monthRangeOf, moved,
    owedByBank, refiByYear, splitQueue, toCsv, trend, type ClosedAgg, type FinanceOverview, type QueueRow,
} from '../financeStats'

const c = (month: string, tlc: number, extra: Partial<ClosedAgg> = {}): ClosedAgg => ({
    month, agent: 'a', bank: 'DBS', source: 'referral', type: 'Purchase', cases: 1, volume: tlc * 10 / 0.0015, gross: tlc * 10, agent_share: tlc * 9, tlc, fees: 0, ...extra,
})
const q = (p: Partial<QueueRow>): QueueRow => ({
    id: '1', agent_id: 'a', agent_name: 'A', client_name: 'X', case_type: 'Purchase', bank: 'DBS', closed_on: '2026-01-01',
    loan: 1_500_000, gross: 2250, agent_share: 2025, tlc_share: 225, fee: 0, paid: 0, received: 0, tracked: true, has_lo: true, ...p,
})
const base: FinanceOverview = { agents: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], closed: [], payouts: [], receipts: [], agent_owed: [], bank_owed: [], pipeline: [], leads: [], refi: [] }

describe('compare', () => {
    const rows = [c('2026-03', 200), c('2025-03', 100), c('2025-12', 900)]
    it('uses the same months while the year is in progress', () => {
        const r = compare(rows, '2026', '2026-11')
        expect(r.now.tlc).toBe(200)
        expect(r.before.tlc).toBe(100)
        expect(r.growthPct).toBe(100)
    })
    it('uses the full year once it is over', () => expect(compare(rows, '2025', '2026-11').now.tlc).toBe(1000))
    it('compares a month with the same month last year', () => expect(compare(rows, '2026-03', '2026-11').before.tlc).toBe(100))
    it('has no growth with nothing to compare', () => expect(compare(rows, '2025', '2026-11').growthPct).toBeNull())
})

describe('breakdowns', () => {
    it('fills 12 months', () => {
        const t = trend([c('2026-03', 200)], 2026, 'tlc')
        expect(t).toHaveLength(12)
        expect(t[2]).toBe(200)
    })
    it('ranks by TLC revenue in the period', () => expect(breakdown([c('2026-01', 5), c('2026-02', 9, { bank: 'UOB' }), c('2025-02', 99)], 'bank', '2026').map(b => b.key)).toEqual(['UOB', 'DBS']))
    it('lists every agent, with conversion from the cohort', () => {
        const r = agentRanking({ ...base, closed: [c('2026-01', 5)], leads: [{ month: '2026-01', agent: 'a', activated: 4, won: 1, lost: 1 }] }, '2026')
        expect(r.map(x => x.name)).toEqual(['A', 'B'])
        expect(r[0].conversionPct).toBe(25)
        expect(r[1].conversionPct).toBeNull()
    })
    it('scopes to one agent', () => expect(forAgent({ ...base, closed: [c('2026-01', 5), c('2026-01', 5, { agent: 'b' })] }, 'b').closed).toHaveLength(1))
    it('groups bank debt', () => expect(owedByBank([
        { agent: 'a', bank: 'DBS', cases: 1, amount: 5, d30: 5, d60: 0, older: 0 },
        { agent: 'b', bank: 'DBS', cases: 2, amount: 7, d30: 0, d60: 7, older: 0 },
    ])[0]).toMatchObject({ bank: 'DBS', amount: 12, cases: 3 }))
    it('puts passed lock-ins first', () => expect(refiByYear([
        { month: '2028-01', agent: 'a', cases: 1, volume: 1, tlc: 1 }, { month: '2026-01', agent: 'a', cases: 1, volume: 1, tlc: 1 },
    ], '2026-11').map(r => r.key)).toEqual(['past', '2028']))
})

describe('cash', () => {
    it('leaves untracked payouts out of cash held', () => {
        const d = {
            receipts: [{ month: '2026-01', agent: 'a', bank: 'DBS', amount: 2250 }],
            payouts: [{ month: '2026-01', agent: 'a', tracked: true, amount: 2025 }, { month: '2025-01', agent: 'a', tracked: false, amount: 999 }],
        }
        expect(cashHeld(d)).toBe(225)
        expect(moved(d.payouts, '2025')).toBe(999)
    })
})

describe('payout queue', () => {
    it('reads the bank state', () => {
        expect(bankState(q({}))).toBe('waiting')
        expect(bankState(q({ received: 2000 }))).toBe('part')
        expect(bankState(q({ received: 2250 }))).toBe('received')
        expect(bankState(q({ received: 2300 }))).toBe('over')
        expect(bankState(q({ tracked: false }))).toBe('untracked')
    })
    it('splits ready from waiting', () => {
        const s = splitQueue([q({ id: 'w' }), q({ id: 'r', received: 2250 }), q({ id: 'o', received: 2250, paid: 2100 }), q({ id: 'p', paid: 2025 })])
        expect(s.ready.map(r => r.id)).toEqual(['r'])
        expect(s.waiting.map(r => r.id)).toEqual(['w'])
        expect(s.bankOpen.map(r => r.id)).toEqual(['w', 'p'])
        expect(s.overpaid.map(r => r.id)).toEqual(['o'])
    })
    it('totals outstanding to the cent', () => {
        expect(agentOutstanding(q({ agent_share: 0.3, paid: 0.1 }))).toBe(0.2)
        expect(groupByAgent([q({}), q({ paid: 25 })])[0].total).toBe(4025)
    })
})

it('month ranges', () => {
    expect(monthRangeOf('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(monthRangeOf('2026')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(monthRangeOf('2026-13')).toBeNull()
})
it('csv defuses formulas and quotes', () => expect(toCsv([['=1+1', 'a"b', -5]])).toBe('﻿"\'=1+1","a""b",-5'))
