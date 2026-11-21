/**
 * Dashboard analytics — the ONE place the Dashboard's numbers are worked out.
 * Pure (no React, no network); pinned by __tests__/dashboardStats.test.ts.
 *
 * Input is dashboard_analytics() (migration 20261201000000), aggregated by month
 * and lead source:
 *   closed: Closed Won by the month it was MARKED Closed Won (SGT)
 *   leads:  leads by the month they were FIRST ACTIVATED (SGT; permanent)
 *
 * Rules (agreed 2026-11-21):
 *   - Production (quantum, cases, trend) counts by closing month — same as
 *     Cases → Closed Won and Earnings.
 *   - Year-on-year compares the SAME months: Jan–Nov this year vs Jan–Nov last
 *     year while the year is in progress — never part of a year vs a full one.
 *   - Conversion is by activation cohort: a lead activated in October and won
 *     in November counts toward October. A cohort with open leads is
 *     PROVISIONAL (its rate can still rise).
 *   - Source conversion compares leads and wins from the SAME cohort.
 */

import { LEAD_SOURCES, NOT_SET, NOT_SET_LABEL } from '@/lib/insurance/leadSources'

export interface ClosedRow { month: string; source: string; cases: number; loan_volume: number }
export interface LeadRow { month: string; source: string; activated: number; won: number; lost: number; open: number }
export interface DashboardData { closed: ClosedRow[]; leads: LeadRow[] }

const inYear = (month: string, year: number) => month.startsWith(`${year}-`)
const monthNum = (month: string) => Number(month.slice(5, 7))

// ─── 1. Business performance ────────────────────────────────────────────────

export interface Performance {
    loanVolume: number
    cases: number
    averageLoan: number | null
    /** Same months last year (see header); null when last year had nothing to compare. */
    yoyGrowthPct: number | null
    /** Months compared, e.g. 11 = Jan–Nov. */
    monthsCompared: number
    lastYearLoanVolume: number
}

/** `currentMonth` = 'YYYY-MM' (SGT today). Past years compare all 12 months. */
export function performance(closed: ClosedRow[], year: number, currentMonth: string): Performance {
    const thisYear = Number(currentMonth.slice(0, 4))
    const monthsCompared = year === thisYear ? monthNum(currentMonth) : 12
    const sum = (y: number, upTo: number) => closed
        .filter(r => inYear(r.month, y) && monthNum(r.month) <= upTo)
        .reduce((a, r) => ({ vol: a.vol + Number(r.loan_volume), n: a.n + Number(r.cases) }), { vol: 0, n: 0 })

    const now = sum(year, 12)
    const cmpNow = sum(year, monthsCompared)
    const before = sum(year - 1, monthsCompared)
    return {
        loanVolume: now.vol,
        cases: now.n,
        averageLoan: now.n > 0 ? now.vol / now.n : null,
        yoyGrowthPct: before.vol > 0 ? ((cmpNow.vol - before.vol) / before.vol) * 100 : null,
        monthsCompared,
        lastYearLoanVolume: before.vol,
    }
}

/**
 * One month's performance (the Dashboard's linked view: tap a month on the
 * trend chart). `month` = 'YYYY-MM'. Growth compares the SAME month last year.
 */
export function monthPerformance(closed: ClosedRow[], month: string): Performance {
    const sum = (ym: string) => closed.filter(r => r.month === ym)
        .reduce((a, r) => ({ vol: a.vol + Number(r.loan_volume), n: a.n + Number(r.cases) }), { vol: 0, n: 0 })
    const now = sum(month)
    const before = sum(`${Number(month.slice(0, 4)) - 1}${month.slice(4)}`)
    return {
        loanVolume: now.vol,
        cases: now.n,
        averageLoan: now.n > 0 ? now.vol / now.n : null,
        yoyGrowthPct: before.vol > 0 ? ((now.vol - before.vol) / before.vol) * 100 : null,
        monthsCompared: 1,
        lastYearLoanVolume: before.vol,
    }
}

// ─── 2. Production trend ────────────────────────────────────────────────────

export type TrendMetric = 'quantum' | 'cases'

/** 12 values (Jan–Dec) for `year` and the year before, by closing month. */
export function monthlyTrend(closed: ClosedRow[], year: number, metric: TrendMetric): { thisYear: number[]; lastYear: number[] } {
    const series = (y: number) => Array.from({ length: 12 }, (_, i) => closed
        .filter(r => inYear(r.month, y) && monthNum(r.month) === i + 1)
        .reduce((s, r) => s + Number(metric === 'quantum' ? r.loan_volume : r.cases), 0))
    return { thisYear: series(year), lastYear: series(year - 1) }
}

// ─── 3. Lead sources ────────────────────────────────────────────────────────

export interface SourceRow {
    source: string
    label: string
    /** Production: cases CLOSED in the year from this source (and their quantum). */
    closedCases: number
    closedVolume: number
    /** Cohort: leads ACTIVATED in the year from this source, and how they ended up. */
    leads: number
    won: number
    open: number
    /** won / leads, same cohort. null when no leads. */
    conversionPct: number | null
}

/** One row per source that has any activity in the year, most closings first. "Not set" always last. */
export function sourceBreakdown(data: DashboardData, year: number): SourceRow[] {
    const order = [...LEAD_SOURCES.map(s => s.value as string), NOT_SET]
    const rows = order.map(source => {
        const closed = data.closed.filter(r => r.source === source && inYear(r.month, year))
        const leads = data.leads.filter(r => r.source === source && inYear(r.month, year))
        const n = leads.reduce((s, r) => s + Number(r.activated), 0)
        const won = leads.reduce((s, r) => s + Number(r.won), 0)
        return {
            source,
            label: LEAD_SOURCES.find(s => s.value === source)?.label ?? NOT_SET_LABEL,
            closedCases: closed.reduce((s, r) => s + Number(r.cases), 0),
            closedVolume: closed.reduce((s, r) => s + Number(r.loan_volume), 0),
            leads: n,
            won,
            open: leads.reduce((s, r) => s + Number(r.open), 0),
            conversionPct: n > 0 ? (won / n) * 100 : null,
        }
    }).filter(r => r.closedCases > 0 || r.leads > 0)

    return rows.sort((a, b) =>
        (a.source === NOT_SET ? 1 : 0) - (b.source === NOT_SET ? 1 : 0)
        || b.closedCases - a.closedCases
        || b.leads - a.leads)
}

// ─── 4. Conversion by activation cohort ─────────────────────────────────────

export interface Cohort {
    activated: number
    won: number
    lost: number
    open: number
    /** won / activated. null when nobody was activated. */
    conversionPct: number | null
    /** Some leads still open — the rate can still change. */
    provisional: boolean
}

/** `scope`: 'YYYY-MM' (one month's cohort), 'YYYY' (all that year's cohorts) or 'all'. */
export function cohort(leads: LeadRow[], scope: string): Cohort {
    const rows = scope === 'all' ? leads : leads.filter(r => r.month.startsWith(scope))
    const t = rows.reduce((a, r) => ({
        activated: a.activated + Number(r.activated),
        won: a.won + Number(r.won),
        lost: a.lost + Number(r.lost),
        open: a.open + Number(r.open),
    }), { activated: 0, won: 0, lost: 0, open: 0 })
    return {
        ...t,
        conversionPct: t.activated > 0 ? (t.won / t.activated) * 100 : null,
        provisional: t.open > 0,
    }
}
