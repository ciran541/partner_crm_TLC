import { describe, it, expect } from 'vitest'
import { aiCostUsd } from '@/lib/ai/pricing'
import { groupBy, inScope, modelLabel, monthDays, projectMonth, totals, usd, type SpendRow } from '@/lib/ai/spendStats'

const row = (o: Partial<SpendRow>): SpendRow => ({
    day: '2026-11-10', feature: 'news-classify', model: 'claude-haiku-5-5', environment: 'production',
    calls: 1, failed: 0, input: 0, output: 0, cost: 0, unpriced: 0, ...o,
})

describe('AI cost', () => {
    it('prices each model', () => {
        expect(aiCostUsd('claude-haiku-5-5', 8000, 1000)).toBeCloseTo(0.0013, 8)
        expect(aiCostUsd('claude-sonnet-5-5', 8000, 1000)).toBeCloseTo(0.026, 8)
    })
    it('moves the whole Haiku call to the higher price only above 100K', () => {
        expect(aiCostUsd('claude-haiku-5-5', 100_000, 1000)).toBeCloseTo(0.0105, 8)
        expect(aiCostUsd('claude-haiku-5-5', 100_001, 1000)).toBeCloseTo(0.0525005, 8)
    })
    it('says unknown rather than free', () => expect(aiCostUsd('other', 1, 1)).toBeNull())
})

describe('AI spend page maths', () => {
    it('adds up and ranks by cost', () => {
        const rows = [row({ cost: 0.1 }), row({ feature: 'askKnowledge', cost: 0.5 }), row({ cost: 0.2 })]
        expect(totals(rows).cost).toBeCloseTo(0.8)
        expect(groupBy(rows, r => r.feature).map(g => [g.key, g.calls])).toEqual([['askKnowledge', 1], ['news-classify', 2]])
    })
    it('lays out a month and scopes by one day', () => {
        const nov = monthDays('2026-11')
        expect([nov.blanks, nov.days.length, nov.days[0], nov.days[29]]).toEqual([6, 30, '2026-11-01', '2026-11-30'])
        expect([monthDays('2028-02').days.length, monthDays('2026-06').blanks]).toEqual([29, 0])
        expect([inScope('2026-11-10', '2026-11-10'), inScope('2026-11-11', '2026-11-10')]).toEqual([true, false])
    })
    it('scopes by month, year or all', () => {
        expect(['2026-11', '2026', 'all', '2026-12'].map(s => inScope('2026-11-10', s))).toEqual([true, true, true, false])
    })
    it('projects from the first recorded day, not the 1st', () => {
        expect(projectMonth([row({ day: '2026-11-24', cost: 1 }), row({ day: '2026-11-26', cost: 2 })], '2026-11-26')).toBeCloseTo(7)
        expect(projectMonth([row({ day: '2026-11-25', cost: 1 })], '2026-11-26')).toBeNull()
        expect(projectMonth([row({ day: '2026-10-01', cost: 1 })], '2026-11-26')).toBeNull()
    })
    it('formats tiny sums and model names', () => {
        expect([usd(0), usd(0.0004), usd(0.043), usd(12.4)]).toEqual(['$0.00', 'under $0.001', '$0.043', '$12.40'])
        expect(modelLabel('claude-haiku-5-5')).toBe('Haiku 5.5')
    })
})
