import { describe, it, expect } from 'vitest'
import { performance, monthPerformance, monthlyTrend, sourceBreakdown, cohort, type DashboardData } from '../dashboardStats'

const data: DashboardData = {
    closed: [
        { month: '2025-03', source: 'referral', cases: 2, loan_volume: 1_000_000 },
        { month: '2025-12', source: 'referral', cases: 1, loan_volume: 4_000_000 },   // after Nov — outside YTD comparison
        { month: '2026-02', source: 'referral', cases: 1, loan_volume: 600_000 },
        { month: '2026-11', source: 'social_media', cases: 2, loan_volume: 900_000 },
        { month: '2026-11', source: 'not_set', cases: 1, loan_volume: 500_000 },
    ],
    leads: [
        { month: '2026-10', source: 'social_media', activated: 10, won: 2, lost: 3, open: 5 },
        { month: '2026-10', source: 'referral', activated: 4, won: 2, lost: 2, open: 0 },
        { month: '2026-11', source: 'social_media', activated: 6, won: 0, lost: 0, open: 6 },
        { month: '2025-10', source: 'referral', activated: 5, won: 3, lost: 2, open: 0 },
    ],
}

describe('performance', () => {
    it('totals the year by closing month', () => {
        const p = performance(data.closed, 2026, '2026-11')
        expect(p.loanVolume).toBe(2_000_000)
        expect(p.cases).toBe(4)
        expect(p.averageLoan).toBe(500_000)
    })
    it('YoY compares the same months (Jan–Nov), not part of a year vs a full one', () => {
        const p = performance(data.closed, 2026, '2026-11')
        expect(p.monthsCompared).toBe(11)
        expect(p.lastYearLoanVolume).toBe(1_000_000)          // Dec 2025's $4m excluded
        expect(p.yoyGrowthPct).toBeCloseTo(100)               // $2m vs $1m
    })
    it('a finished year compares all 12 months; no history → no growth figure', () => {
        expect(performance(data.closed, 2025, '2026-11').monthsCompared).toBe(12)
        expect(performance(data.closed, 2025, '2026-11').yoyGrowthPct).toBeNull()
    })
})

describe('monthlyTrend', () => {
    it('returns Jan–Dec for this and last year, by quantum or cases', () => {
        const q = monthlyTrend(data.closed, 2026, 'quantum')
        expect(q.thisYear[1]).toBe(600_000)
        expect(q.thisYear[10]).toBe(1_400_000)
        expect(q.lastYear[2]).toBe(1_000_000)
        expect(monthlyTrend(data.closed, 2026, 'cases').thisYear[10]).toBe(3)
    })
})

describe('sourceBreakdown', () => {
    it('closings by closing year; conversion from the SAME activation cohort', () => {
        const rows = sourceBreakdown(data, 2026)
        const social = rows.find(r => r.source === 'social_media')!
        expect(social.closedCases).toBe(2)
        expect(social.leads).toBe(16)
        expect(social.won).toBe(2)
        expect(social.conversionPct).toBeCloseTo(12.5)
        const referral = rows.find(r => r.source === 'referral')!
        expect(referral.closedCases).toBe(1)          // the 2025 closings don't count in 2026
        expect(referral.conversionPct).toBe(50)       // 2 of the 4 leads activated in 2026
    })
    it('"Not set" is shown, and always last', () => {
        const rows = sourceBreakdown(data, 2026)
        expect(rows[rows.length - 1].source).toBe('not_set')
        expect(rows[0].source).toBe('social_media')   // most closings first
    })
})

describe('cohort', () => {
    it('a lead counts toward the month it was activated; open leads make it provisional', () => {
        const oct = cohort(data.leads, '2026-10')
        expect(oct).toMatchObject({ activated: 14, won: 4, lost: 5, open: 5, provisional: true })
        expect(oct.conversionPct).toBeCloseTo(28.57, 1)
        expect(cohort(data.leads, '2025-10')).toMatchObject({ conversionPct: 60, provisional: false })
    })
    it('whole year and all time aggregate the cohorts; empty → null rate', () => {
        expect(cohort(data.leads, '2026').activated).toBe(20)
        expect(cohort(data.leads, 'all').activated).toBe(25)
        expect(cohort(data.leads, '2024-01').conversionPct).toBeNull()
    })
})

describe('monthPerformance (tap a month on the trend chart)', () => {
    it('totals one month and compares the same month last year', () => {
        const closed = [
            { month: '2026-06', source: 'referral', cases: 3, loan_volume: 1_200_000 },
            { month: '2025-06', source: 'referral', cases: 2, loan_volume: 1_000_000 },
            { month: '2026-05', source: 'referral', cases: 9, loan_volume: 9_000_000 },
        ]
        const p = monthPerformance(closed, '2026-06')
        expect(p).toMatchObject({ loanVolume: 1_200_000, cases: 3, averageLoan: 400_000 })
        expect(p.yoyGrowthPct).toBeCloseTo(20)
        expect(monthPerformance(closed, '2026-05').yoyGrowthPct).toBeNull()   // nothing in May 2025
    })
})
