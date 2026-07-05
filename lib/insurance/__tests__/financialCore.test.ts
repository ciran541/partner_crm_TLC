/**
 * Tests for the consolidated financial core — the pure functions that compute
 * regulated, client-facing numbers (BSD/ABSD tiers, IWAA, annuity math).
 *
 * These values change by government decree (IRAS/MAS); when a tier changes,
 * update lib/insurance/stampDuty.ts and these expectations together. The
 * wrapper tests (refiCalc / purchaseCalc / decoupleCalc) pin the per-engine
 * rounding and fallback semantics so a future refactor can't silently change
 * a workflow's computed tenure.
 */

import { describe, it, expect } from 'vitest'
import {
    calculateBSD,
    computeBsdBreakdown,
    absdRate,
    worstResidency,
} from '@/lib/insurance/stampDuty'
import {
    incomeWeightedAge,
    monthlyInstallment,
    effectiveMonthlyIncome,
    tdsrAvailable,
    TDSR_LIMIT,
    CANCELLATION_FEE_RATE,
    MIN_TENURE,
    DEFAULT_REFERENCE_RATE,
} from '@/lib/insurance/loanCalc'
import { iwaa, averageAge } from '@/lib/insurance/refiCalc'
import { weightedAge } from '@/lib/insurance/purchaseCalc'
import { decoupleWeightedAge, calculateABSD as decoupleABSD } from '@/lib/insurance/decoupleCalc'
import { effectiveRate } from '@/lib/insurance/rateRecommend'
import { isSoraStale, soraAgeDays } from '@/lib/insurance/rateSchedule'
import type { SoraRates } from '@/lib/insurance/sora'

// ── BSD ───────────────────────────────────────────────────────────────────────

describe('calculateBSD', () => {
    it.each([
        [100_000, 1_000],        // 1% band
        [180_000, 1_800],        // top of 1% band
        [360_000, 5_400],        // 1800 + 3600
        [1_000_000, 24_600],     // + 640k @ 3%
        [1_500_000, 44_600],     // + 500k @ 4%
        [2_000_000, 69_600],     // + 500k @ 5%
        [3_000_000, 119_600],    // top of 5% band
        [4_000_000, 179_600],    // + 1M @ 6%
    ])('price %d → BSD %d', (price, expected) => {
        expect(calculateBSD(price)).toBeCloseTo(expected, 6)
    })

    it('returns 0 for zero and negative prices', () => {
        expect(calculateBSD(0)).toBe(0)
        expect(calculateBSD(-500_000)).toBe(0)
    })

    it('breakdown tiers sum to the total', () => {
        const { total, tiers } = computeBsdBreakdown(2_345_678)
        const sum = tiers.reduce((s, t) => s + t.amount, 0)
        expect(sum).toBeCloseTo(total, 6)
        expect(total).toBeCloseTo(calculateBSD(2_345_678), 6)
    })
})

// ── ABSD ──────────────────────────────────────────────────────────────────────

describe('absdRate', () => {
    it('foreigner pays 60% regardless of count', () => {
        expect(absdRate('foreigner', 1)).toBe(0.60)
        expect(absdRate('foreigner', 3)).toBe(0.60)
    })
    it('PR ladder: 5% / 30% / 35%', () => {
        expect(absdRate('pr', 1)).toBe(0.05)
        expect(absdRate('pr', 2)).toBe(0.30)
        expect(absdRate('pr', 3)).toBe(0.35)
    })
    it('citizen ladder: 0% / 20% / 30%', () => {
        expect(absdRate('singaporean', 1)).toBe(0)
        expect(absdRate('singaporean', 2)).toBe(0.20)
        expect(absdRate('singaporean', 3)).toBe(0.30)
    })
})

describe('worstResidency', () => {
    it('foreigner > pr > citizen', () => {
        expect(worstResidency(['singaporean', 'foreigner'])).toBe('foreigner')
        expect(worstResidency(['singaporean', 'pr'])).toBe('pr')
        expect(worstResidency(['singaporean', undefined])).toBe('singaporean')
        expect(worstResidency([])).toBe('singaporean')
    })
})

describe('decoupleCalc.calculateABSD (buyer takes over as first property)', () => {
    it('matches the shared first-property ladder', () => {
        expect(decoupleABSD(1_000_000, 'pr')).toEqual({ amount: 50_000, ratePct: 5 })
        expect(decoupleABSD(1_000_000, 'foreigner')).toEqual({ amount: 600_000, ratePct: 60 })
        expect(decoupleABSD(1_000_000, 'singaporean')).toEqual({ amount: 0, ratePct: 0 })
        expect(decoupleABSD(1_000_000, undefined)).toEqual({ amount: 0, ratePct: 0 })
    })
})

// ── IWAA (shared engine + per-engine wrapper semantics) ───────────────────────

describe('incomeWeightedAge', () => {
    it('weights ages by income', () => {
        // 40yo @ 8k, 30yo @ 2k → (40·8000 + 30·2000) / 10000 = 38
        expect(incomeWeightedAge([
            { age: 40, monthlyIncome: 8_000 },
            { age: 30, monthlyIncome: 2_000 },
        ])).toBeCloseTo(38, 10)
    })

    it('excludes borrowers without an age (income does NOT drag the average down)', () => {
        // Regression: the TDSR calculator's local copy counted an ageless
        // borrower as age 0, halving the IWAA.
        expect(incomeWeightedAge([
            { age: 40, monthlyIncome: 5_000 },
            { age: undefined, monthlyIncome: 5_000 },
        ])).toBeCloseTo(40, 10)
    })

    it('returns null when nobody has an age', () => {
        expect(incomeWeightedAge([{ monthlyIncome: 5_000 }])).toBeNull()
        expect(incomeWeightedAge([])).toBeNull()
    })

    it('zeroIncomeFallback: null vs simple-average', () => {
        const entries = [
            { age: 40, monthlyIncome: 0 },
            { age: 31, monthlyIncome: 0 },
        ]
        expect(incomeWeightedAge(entries, { zeroIncomeFallback: 'null' })).toBeNull()
        expect(incomeWeightedAge(entries, { zeroIncomeFallback: 'simple-average' })).toBeCloseTo(35.5, 10)
        expect(incomeWeightedAge(entries, { zeroIncomeFallback: 'simple-average', roundUp: true })).toBe(36)
    })

    it('roundUp ceils the weighted result', () => {
        const entries = [
            { age: 40, monthlyIncome: 6_000 },
            { age: 30, monthlyIncome: 4_000 },
        ]
        // raw = 36
        expect(incomeWeightedAge(entries, { roundUp: true })).toBe(36)
        const entries2 = [
            { age: 41, monthlyIncome: 6_000 },
            { age: 30, monthlyIncome: 4_000 },
        ]
        // raw = 36.6 → 37
        expect(incomeWeightedAge(entries2, { roundUp: true })).toBe(37)
    })
})

describe('per-engine IWAA wrappers keep their semantics', () => {
    const twoBorrowers = [
        { age: 40, employment: 'employed' as const, basicSalary: 8_000, annualVariable: 0 },
        { age: 30, employment: 'employed' as const, basicSalary: 2_000, annualVariable: 0 },
    ]

    it('refiCalc.iwaa: raw value, null on zero income', () => {
        expect(iwaa(twoBorrowers)).toBeCloseTo(38, 10)
        expect(iwaa([{ age: 40 }, { age: 31 }])).toBeNull()           // no income → null
        expect(averageAge([40, 31])).toBeCloseTo(35.5, 10)            // caller-level fallback
    })

    it('purchaseCalc.weightedAge: ceiled, simple-average fallback', () => {
        expect(weightedAge([
            { age: 41, employment: 'employed', basicSalary: 6_000 },
            { age: 30, employment: 'employed', basicSalary: 4_000 },
        ])).toBe(37)                                                   // 36.6 → 37
        expect(weightedAge([{ age: 40 }, { age: 31 }])).toBe(36)       // no income → ceil(35.5)
        expect(weightedAge([{ age: 40 }])).toBe(40)                    // single borrower
    })

    it('decoupleCalc.decoupleWeightedAge: same semantics as purchase (snake_case input)', () => {
        expect(decoupleWeightedAge([
            { age: 41, employment: 'employed', basic_salary: 6_000 },
            { age: 30, employment: 'employed', basic_salary: 4_000 },
        ])).toBe(37)
        expect(decoupleWeightedAge([{ age: 40 }, { age: 31 }])).toBe(36)
    })
})

// ── Core loan math ────────────────────────────────────────────────────────────

describe('monthlyInstallment', () => {
    it('standard annuity: $500k @ 2.5% over 25y ≈ $2,243.08/mo', () => {
        expect(monthlyInstallment(500_000, 2.5, 25)).toBeCloseTo(2_243.08, 1)
    })
    it('zero rate degrades to straight-line', () => {
        expect(monthlyInstallment(120_000, 0, 10)).toBeCloseTo(1_000, 6)
    })
})

describe('effectiveMonthlyIncome / tdsrAvailable', () => {
    it('haircuts variable income to 70%', () => {
        expect(effectiveMonthlyIncome({ basicMonthlySalary: 5_000, annualVariableIncome: 12_000 }))
            .toBeCloseTo(5_000 + 700, 6)
    })
    it('self-employed income is all-variable', () => {
        expect(effectiveMonthlyIncome({ basicMonthlySalary: 5_000, annualVariableIncome: 120_000, isSelfEmployed: true }))
            .toBeCloseTo(7_000, 6)
    })
    it('TDSR: 55% of gross minus debts, floored at 0', () => {
        expect(tdsrAvailable(10_000, 2_000)).toBeCloseTo(10_000 * TDSR_LIMIT - 2_000, 6)
        expect(tdsrAvailable(1_000, 5_000)).toBe(0)
    })
})

describe('shared constants exist once', () => {
    it('values', () => {
        expect(CANCELLATION_FEE_RATE).toBe(0.0075)
        expect(MIN_TENURE).toBe(5)
        expect(DEFAULT_REFERENCE_RATE).toBe(2.5)
    })
})

// ── Step 4 effective rate ─────────────────────────────────────────────────────

const sora: SoraRates = {
    value_date: '2026-07-01',
    sora: 1.5,
    sora_index: null,
    comp_sora_1m: 1.6,
    comp_sora_3m: 1.8,
    comp_sora_6m: 2.0,
    published_date: '2026-07-02',
    benchmarks: { FHR6: 0.8 },
}

describe('effectiveRate', () => {
    it('fixed → its own rate', () => {
        expect(effectiveRate({ year: 1, type: 'fixed', rate: 2.35 }, sora).rate).toBe(2.35)
    })
    it('3M SORA + spread', () => {
        expect(effectiveRate({ year: 1, type: 'floating', reference: '3M SORA', spread: 0.5 }, sora).rate)
            .toBeCloseTo(2.3, 10)
    })
    it('1M/3M SORA uses the LOWER benchmark', () => {
        expect(effectiveRate({ year: 1, type: 'floating', reference: '1M/3M SORA', spread: 0.5 }, sora).rate)
            .toBeCloseTo(1.6 + 0.5, 10)
    })
    it('bank benchmark (FHR6) resolves from admin-set values', () => {
        expect(effectiveRate({ year: 1, type: 'floating', reference: 'FHR6', spread: 1.0 }, sora).rate)
            .toBeCloseTo(1.8, 10)
    })
    it('unknown benchmark → not auto-priced (null), never a guess', () => {
        expect(effectiveRate({ year: 1, type: 'floating', reference: 'FD Rate', spread: 1.0 }, { ...sora, benchmarks: {} }).rate)
            .toBeNull()
        expect(effectiveRate({ year: 1, type: 'floating', reference: '3M SORA', spread: 0.5 }, null).rate)
            .toBeNull()
    })
})

// ── SORA freshness ────────────────────────────────────────────────────────────

describe('SORA staleness', () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

    it('fresh within 5 days, stale after', () => {
        expect(isSoraStale(daysAgo(1))).toBe(false)
        expect(isSoraStale(daysAgo(4))).toBe(false)
        expect(isSoraStale(daysAgo(8))).toBe(true)
    })
    it('absent/garbage dates are not flagged (the "no SORA" banner covers that)', () => {
        expect(isSoraStale(null)).toBe(false)
        expect(isSoraStale('not-a-date')).toBe(false)
        expect(soraAgeDays(undefined)).toBeNull()
    })
})
