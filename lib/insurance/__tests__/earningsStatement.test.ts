import { describe, it, expect } from 'vitest'
import { isPeriod, periodLabel, periodRange, statementHtml, statementTotals } from '../earningsStatement'

const base = {
    agentName: 'Agent <A>', period: '2026-11', preparedOn: '2026-11-24',
    cases: [
        { client: 'Tan & Co', caseType: 'Refinancing', closedOn: '2026-11-18', loan: 850000, gross: 1275, fee: 50, share: 1097.5, paid: 500 },
        { client: 'Lim', caseType: 'Purchase', closedOn: '2026-11-19', loan: 1200000, gross: 1800, fee: 0, share: 1620, paid: 1620 },
    ],
    payouts: [
        { client: 'Lim', paidOn: '2026-11-20', amount: 1620, reference: 'TT1', reversal: false },
        { client: 'Old case', paidOn: '2026-11-21', amount: -100, reference: null, reversal: true },
    ],
}

describe('earnings statement', () => {
    it('keeps earned (closed in period) apart from received (paid in period)', () => {
        expect(statementTotals(base)).toEqual({ earned: 2717.5, received: 1520, awaiting: 597.5 })
    })
    it('periods', () => {
        expect(periodLabel('2026-11')).toBe('November 2026')
        expect(periodRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
        expect(periodRange('2026')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
        expect(['2026', '2026-01', '2026-13', 'all', '26'].map(isPeriod)).toEqual([true, true, false, false, false])
    })
    it('escapes names and marks reversals', () => {
        const h = statementHtml(base)
        expect(h).toContain('Agent &lt;A&gt;')
        expect(h).toContain('Tan &amp; Co')
        expect(h).toContain('Old case (reversal)')
        expect(h).toContain('-$100.00')
        expect(statementHtml({ ...base, cases: [], payouts: [] })).toContain('No payouts in this period.')
    })
})
