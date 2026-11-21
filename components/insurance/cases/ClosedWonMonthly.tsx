'use client'

import { useEffect, useMemo, useState } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import MonthPicker, { compact } from '@/components/insurance/shared/MonthPicker'
import { formatCurrency } from '@/lib/utils/formatCurrency'

/**
 * Closed Won tab header — closed revenue AND loans closed, by month.
 *
 *   ‹ [2026 ▾] ›                       [ 2026 total  ]  [ All time   ]
 *                                      [ $6.4k       ]  [ $75k       ]
 *                                      [ $4.3m closed]  [ $50m closed]
 *   ┌ Jan ┐┌ Feb ┐┌ Mar ┐┌ Apr ┐┌ May ┐┌ Jun ┐      ← 6 across on iPad/phone,
 *   │$1.2k││  —  ││$3.4k││ …   ││     ││     │        12 across on a laptop;
 *   │$0.8m││     ││$2.3m││     ││     ││     │        never scrolls sideways
 *   └─────┘└─────┘└─────┘└─────┘└─────┘└─────┘
 *   November 2026   $1,800 closed revenue   $1,200,000 loans closed · 1 case
 *
 * Pick a year (arrows or dropdown) → its whole year is listed; tap a month →
 * that month; "All time" → every closed case. In 2029, Nov 2026 is three taps.
 * Tiles are shaded by revenue within the year on screen.
 *
 * `scope` is 'YYYY-MM' | 'YYYY' | 'all'; the page sends it to the list query
 * (search_cases p_closed_month; 'all' = no filter) and passes that query's totals
 * back in, so the headline and the rows below can't disagree. A case counts in
 * the month it was marked Closed Won, Singapore time. Revenue = 0.15% of loan.
 */

export const CLOSED_REVENUE_RATE = 0.0015
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface MonthTotal { month: string; cases: number; loan_volume: number }

const money = (n: number) => (n > 0 ? formatCurrency(Math.round(n)) : '$0')
function prevMonth(ym: string): string {
    const [y, m] = ym.split('-').map(Number)
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

export default function ClosedWonMonthly({ scope, currentMonth, onScope, loanVolume, cases, loading, agent }: {
    scope: string
    currentMonth: string
    onScope: (scope: string) => void
    loanVolume: number
    cases: number
    loading: boolean
    agent?: string
}) {
    const thisYear = Number(currentMonth.slice(0, 4))
    // scope: 'YYYY-MM' (a month) | 'YYYY' (whole year) | 'all' (every year combined)
    const allTime = scope === 'all'
    const wholeYear = scope.length === 4

    // One small row per month that has a closing; fetched once.
    const [totals, setTotals] = useState<MonthTotal[]>([])
    useEffect(() => {
        let alive = true
        fetch(`/api/insurance/cases/closed-by-month${agent ? `?agent=${agent}` : ''}`)
            .then(r => (r.ok ? r.json() : { months: [] }))
            .then(d => { if (alive) setTotals(d.months ?? []) })
            .catch(() => {})
        return () => { alive = false }
    }, [agent])

    const revenue = useMemo(() => {
        const map = new Map<string, number>()
        for (const t of totals) map.set(t.month, t.loan_volume * CLOSED_REVENUE_RATE)
        return map
    }, [totals])
    const rev = (key: string) => revenue.get(key) ?? 0
    const yearRev = (y: number) => MONTHS.reduce((s, _, i) => s + rev(`${y}-${String(i + 1).padStart(2, '0')}`), 0)
    // Loan amount closed (what agents quote: "I closed $50m this year").
    const loan = (key: string) => (revenue.get(key) ?? 0) / CLOSED_REVENUE_RATE
    const yearLoan = (y: number) => yearRev(y) / CLOSED_REVENUE_RATE

    // Every year from the first closing to now, newest first (the year picker).
    const years = useMemo(() => {
        const first = totals.length ? Math.min(...totals.map(t => Number(t.month.slice(0, 4)))) : thisYear
        return Array.from({ length: thisYear - Math.min(first, thisYear) + 1 }, (_, i) => thisYear - i)
    }, [totals, thisYear])

    // One year on screen at a time. Picking a year lists the whole year; then a
    // month narrows it. Stays one row however many years of history there are.
    // The year on screen; "All time" keeps showing the last year picked.
    const [lastYear, setLastYear] = useState(() => (allTime ? Number(currentMonth.slice(0, 4)) : Number(scope.slice(0, 4))))
    const viewYear = allTime ? lastYear : Number(scope.slice(0, 4))
    const go = (next: string) => {
        if (next !== 'all') setLastYear(Number(next.slice(0, 4)))
        onScope(next)
    }
    const lifetimeRev = totals.reduce((sum, t) => sum + t.loan_volume * CLOSED_REVENUE_RATE, 0)
    const lifetimeLoan = totals.reduce((sum, t) => sum + t.loan_volume, 0)

    // Headline comparison: vs previous month, or vs previous year.
    const current = loanVolume * CLOSED_REVENUE_RATE
    const compareKey = allTime ? '' : wholeYear ? String(Number(scope) - 1) : prevMonth(scope)
    const compareRev = allTime ? 0 : wholeYear ? yearRev(Number(scope) - 1) : rev(compareKey)
    const delta = current - compareRev
    const compareLabel = allTime ? '' : wholeYear
        ? compareKey
        : new Date(Number(compareKey.slice(0, 4)), Number(compareKey.slice(5)) - 1, 1).toLocaleDateString('en-SG', { month: 'long' })
    const scopeLabel = allTime ? 'All time' : wholeYear
        ? `All of ${scope}`
        : new Date(Number(scope.slice(0, 4)), Number(scope.slice(5)) - 1, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })

    return (
        <div className="card p-4 sm:p-5 space-y-4">
            {/* Shared picker (same as Earnings): year · whole year · all time · month tiles */}
            <MonthPicker
                scope={scope}
                currentMonth={currentMonth}
                years={years}
                onScope={go}
                tile={m => {
                    const v = rev(m)
                    return { weight: v, main: compact(v), sub: `${compact(loan(m))} closed` }
                }}
                yearSummary={<Totals revenue={yearRev(viewYear)} loans={yearLoan(viewYear)} />}
                allTimeSummary={<Totals revenue={lifetimeRev} loans={lifetimeLoan} />}
            />

            {/* ── What the list below shows ───────────────────────────────────── */}
            <div className={`flex items-end justify-between gap-4 flex-wrap pt-4 border-t border-slate-100 ${loading ? 'opacity-50' : ''}`}>
                <div>
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{scopeLabel}</p>
                    <div className="flex gap-8 flex-wrap mt-1">
                        <div>
                            <p className="text-3xl font-extrabold text-emerald-600 leading-tight">{money(current)}</p>
                            <p className="text-xs text-slate-500">Closed revenue</p>
                        </div>
                        <div>
                            <p className="text-3xl font-extrabold text-[#052d4a] leading-tight">{money(loanVolume)}</p>
                            <p className="text-xs text-slate-500">Loans closed · {cases} case{cases === 1 ? '' : 's'}</p>
                        </div>
                    </div>
                </div>
                {!allTime && (current > 0 || compareRev > 0) && delta !== 0 && (
                    <p className={`text-sm font-semibold flex items-center gap-1 ${delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {delta > 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                        {delta > 0 ? '+' : '−'}{money(Math.abs(delta))} vs {compareLabel}
                    </p>
                )}
            </div>
        </div>
    )
}

/** Figures inside the picker's Year / All-time buttons. */
function Totals({ revenue, loans }: { revenue: number; loans: number }) {
    return (
        <>
            <span className="block text-lg font-extrabold leading-tight text-[#052d4a]">{revenue > 0 ? compact(revenue) : '$0'}</span>
            <span className="block text-[11px] font-semibold text-slate-500">{compact(loans)} closed</span>
        </>
    )
}
