import { describe, it, expect } from 'vitest'
import { computePartialRepayment } from '@/lib/insurance/partialRepaymentCalc'
import type { RateScheduleEntry } from '@/lib/types/rates'

// Figures from the year-based calculator this replaced (1M, 30 yrs, 2% fixed
// for years 1–2): "after month 12" must equal the old "after year 1".
const schedule: RateScheduleEntry[] = [
    { year: 1, type: 'fixed', rate: 2 },
    { year: 2, type: 'fixed', rate: 2 },
    { thereafter: true, type: 'fixed', rate: 2.37 } as RateScheduleEntry,
]

describe('computePartialRepayment (monthly)', () => {
    it('reproduces the year-based figures when lump sums land on year boundaries', () => {
        const { rows } = computePartialRepayment(1_000_000, 30, schedule, null, [
            { afterMonth: 12, amount: 200_000 },
            { afterMonth: 24, amount: 200_000 },
        ])
        expect(rows).toHaveLength(360)
        expect(rows[0].instalment).toBeCloseTo(3696.19, 2)
        expect(rows[11].balance).toBeCloseTo(975_421.17, 2)
        expect(rows[12].prepayment).toBe(200_000)
        expect(rows[12].instalment).toBeCloseTo(2938.33, 2)
        expect(rows[23].balance).toBeCloseTo(755_487.59, 2)
        const yr1Interest = rows.slice(0, 12).reduce((s, r) => s + (r.interest ?? 0), 0)
        expect(yr1Interest).toBeCloseTo(19_775.51, 2)
    })

    it('applies a mid-year lump sum entering the following month and re-amortises', () => {
        const { rows, interestSaved } = computePartialRepayment(1_000_000, 30, schedule, null, [
            { afterMonth: 15, amount: 100_000 },
        ])
        expect(rows[15].prepayment).toBe(100_000)   // month 16
        expect(rows[15].instalment!).toBeLessThan(rows[14].instalment!)
        expect(interestSaved!).toBeGreaterThan(0)
    })
})
