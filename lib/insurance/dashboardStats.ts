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
/** month = when it was lost; null before HUB recorded stage changes (Nov 2026). */
export interface LostRow { month: string | null; reason: string; cases: number; loan_volume: number }
/** Past clients by the month their lock-in ends. */
export interface DueRow { month: string; cases: number; loan_volume: number }
/** Won leads by the year first activated and the year closed. */
export interface WonByYearRow { year: number; closed_year: number; source: string; cases: number; loan_volume: number }
export interface DashboardData { won_by_year?: WonByYearRow[]; closed: ClosedRow[]; leads: LeadRow[]; lost?: LostRow[]; coming_due?: DueRow[] }

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
    /** This year's leads that closed in the same year, and in a later one. Together = won. */
    closedCases: number
    closedVolume: number
    laterCases: number
    laterVolume: number
    /** Cohort: leads ACTIVATED in the year from this source, and how they ended up. */
    leads: number
    won: number
    open: number
    /** won / leads, same cohort. null when no leads. */
    conversionPct: number | null
}

/**
 * One row per source with leads in the year, most won first. "Not set" always last.
 * Everything follows the year's LEADS (agreed 2026-11-24): a Dec 2026 lead won in
 * Feb 2027 stays in 2026, as "closed later". A closing dated before its lead
 * (backdated) counts as closed the same year.
 */
export function sourceBreakdown(data: DashboardData, year: number): SourceRow[] {
    const order = [...LEAD_SOURCES.map(s => s.value as string), NOT_SET]
    const rows = order.map(source => {
        const wonRows = (data.won_by_year ?? []).filter(r => r.source === source && r.year === year)
        const sum = (rs: WonByYearRow[]) => ({
            cases: rs.reduce((s, r) => s + Number(r.cases), 0),
            volume: rs.reduce((s, r) => s + Number(r.loan_volume), 0),
        })
        const same = sum(wonRows.filter(r => r.closed_year <= year))
        const later = sum(wonRows.filter(r => r.closed_year > year))
        const leads = data.leads.filter(r => r.source === source && inYear(r.month, year))
        const n = leads.reduce((s, r) => s + Number(r.activated), 0)
        const won = leads.reduce((s, r) => s + Number(r.won), 0)
        return {
            source,
            label: LEAD_SOURCES.find(s => s.value === source)?.label ?? NOT_SET_LABEL,
            closedCases: same.cases,
            closedVolume: same.volume,
            laterCases: later.cases,
            laterVolume: later.volume,
            leads: n,
            won,
            open: leads.reduce((s, r) => s + Number(r.open), 0),
            conversionPct: n > 0 ? (won / n) * 100 : null,
        }
    }).filter(r => r.leads > 0)

    return rows.sort((a, b) =>
        (a.source === NOT_SET ? 1 : 0) - (b.source === NOT_SET ? 1 : 0)
        || b.won - a.won
        || b.leads - a.leads)
}

/** Heading for the later closings of `year`'s leads; null when there are none yet. */
export function laterClosingsLabel(data: DashboardData, year: number): string | null {
    const ys = (data.won_by_year ?? []).filter(r => r.year === year && r.closed_year > year).map(r => r.closed_year)
    if (ys.length === 0) return null
    const first = Math.min(...ys)
    return first === Math.max(...ys) ? `Closed in ${first}` : `Closed in ${first} onwards`
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

// ─── 5. Why deals are lost ──────────────────────────────────────────────────

export interface LostReason { reason: string; cases: number; loanVolume: number; pct: number }

/** `year` = lost in that year; null = all time (includes cases lost before dates were recorded). */
export function lostReasons(lost: LostRow[], year: number | null): LostReason[] {
    const by = new Map<string, { cases: number; loanVolume: number }>()
    for (const r of lost) {
        if (year != null && !(r.month && inYear(r.month, year))) continue
        const t = by.get(r.reason) ?? { cases: 0, loanVolume: 0 }
        by.set(r.reason, { cases: t.cases + Number(r.cases), loanVolume: t.loanVolume + Number(r.loan_volume) })
    }
    const total = [...by.values()].reduce((s, r) => s + r.cases, 0)
    return [...by.entries()]
        .map(([reason, r]) => ({ reason, ...r, pct: total > 0 ? (r.cases / total) * 100 : 0 }))
        .sort((a, b) => b.cases - a.cases || b.loanVolume - a.loanVolume)
}

// ─── 6. Business coming due ─────────────────────────────────────────────────

/** 12 months from `currentMonth`, empty months included. */
export function comingDue(rows: DueRow[], currentMonth: string): DueRow[] {
    const [y, m] = currentMonth.split('-').map(Number)
    return Array.from({ length: 12 }, (_, i) => {
        const t = y * 12 + (m - 1) + i
        const month = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
        const r = rows.find(x => x.month === month)
        return { month, cases: Number(r?.cases ?? 0), loan_volume: Number(r?.loan_volume ?? 0) }
    })
}
