'use client'

import { useEffect, useMemo, useState } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { formatCurrency } from '@/lib/utils/formatCurrency'

/**
 * Closed Won tab header: every month of every year in one grid.
 *
 *            Jan    Feb   …   Nov    Dec │ Year
 *   2026    $1.2k    —    …  [$1.8k]     │ $6.4k
 *   2025      —    $0.9k  …    —   $1.5k │ $4.5k
 *
 *   November 2026 · Closed revenue $1,800 · 1 case   ▲ $600 vs October
 *
 * Built for the three questions agents ask here: how much this month, how much
 * in <any month/year> (one tap, no switching), and how am I trending (cells
 * are shaded by amount). Tap a cell → list that month; tap a year or its
 * total → list the whole year.
 *
 * `scope` is 'YYYY-MM' or 'YYYY'; the page sends it to the list query (search_cases
 * p_closed_month) and passes that query's totals back in, so the headline and
 * the rows below can't disagree. A case counts in the month it was marked
 * Closed Won, Singapore time. Revenue = 0.15% of loan, like Potential Revenue.
 */

export const CLOSED_REVENUE_RATE = 0.0015
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface MonthTotal { month: string; cases: number; loan_volume: number }

const money = (n: number) => (n > 0 ? formatCurrency(Math.round(n)) : '$0')
/** Cell label: $950, $1.8k, $12k, $1.2m */
function compact(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
    return `$${Math.round(n)}`
}
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

    // Newest year first; every year from the first closing to now (gaps show as gaps).
    const years = useMemo(() => {
        const first = totals.length ? Math.min(...totals.map(t => Number(t.month.slice(0, 4)))) : thisYear
        return Array.from({ length: thisYear - Math.min(first, thisYear) + 1 }, (_, i) => thisYear - i)
    }, [totals, thisYear])

    const max = Math.max(1, ...totals.map(t => t.loan_volume * CLOSED_REVENUE_RATE))
    const shade = (v: number) => (v > 0 ? `rgba(3, 169, 231, ${(0.1 + 0.45 * (v / max)).toFixed(2)})` : 'transparent')

    // Headline comparison: vs previous month, or vs previous year.
    const current = loanVolume * CLOSED_REVENUE_RATE
    const compareKey = wholeYear ? String(Number(scope) - 1) : prevMonth(scope)
    const compareRev = wholeYear ? yearRev(Number(scope) - 1) : rev(compareKey)
    const delta = current - compareRev
    const compareLabel = wholeYear
        ? compareKey
        : new Date(Number(compareKey.slice(0, 4)), Number(compareKey.slice(5)) - 1, 1).toLocaleDateString('en-SG', { month: 'long' })
    const scopeLabel = wholeYear
        ? `All of ${scope}`
        : new Date(Number(scope.slice(0, 4)), Number(scope.slice(5)) - 1, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })

    const cellBase = 'h-10 w-full rounded-lg text-[11px] sm:text-xs font-semibold transition-colors'

    return (
        <div className="card p-4 sm:p-5 space-y-4">
            {/* Year × month grid. Scrolls sideways on narrow screens; fits an iPad. */}
            <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-full min-w-[680px] border-separate" style={{ borderSpacing: '4px' }}>
                    <thead>
                        <tr>
                            <th className="w-14" />
                            {MONTHS.map(m => (
                                <th key={m} className="text-[11px] font-semibold text-slate-400 pb-1">{m}</th>
                            ))}
                            <th className="text-[11px] font-bold text-slate-500 pb-1 pl-2">Year</th>
                        </tr>
                    </thead>
                    <tbody>
                        {years.map(y => {
                            const yearSelected = wholeYear && scope === String(y)
                            const yr = yearRev(y)
                            return (
                                <tr key={y}>
                                    <td>
                                        <button type="button" onClick={() => onScope(String(y))}
                                            className={`${cellBase} text-sm font-bold ${yearSelected ? 'text-[#03a9e7]' : 'text-[#052d4a] hover:bg-slate-100'}`}>
                                            {y}
                                        </button>
                                    </td>
                                    {MONTHS.map((_, i) => {
                                        const key = `${y}-${String(i + 1).padStart(2, '0')}`
                                        const v = rev(key)
                                        const future = key > currentMonth
                                        const selected = scope === key
                                        if (future) return <td key={key}><div className={`${cellBase} bg-slate-50`} /></td>
                                        return (
                                            <td key={key}>
                                                <button type="button" onClick={() => onScope(key)}
                                                    title={`${MONTHS[i]} ${y}: ${money(v)}`}
                                                    className={`${cellBase} ${
                                                        selected ? 'bg-[#03a9e7] text-white ring-2 ring-[#03a9e7] ring-offset-1'
                                                            : yearSelected ? 'ring-1 ring-[#03a9e7]/40 text-[#052d4a]'
                                                                : v > 0 ? 'text-[#052d4a] hover:ring-1 hover:ring-[#03a9e7]' : 'text-slate-300 hover:bg-slate-50'
                                                    }`}
                                                    style={selected ? undefined : { background: shade(v) }}>
                                                    {v > 0 ? compact(v) : '—'}
                                                </button>
                                            </td>
                                        )
                                    })}
                                    <td className="pl-2">
                                        <button type="button" onClick={() => onScope(String(y))}
                                            className={`${cellBase} px-2 text-sm font-extrabold ${
                                                yearSelected ? 'bg-[#03a9e7] text-white' : 'bg-slate-100 text-[#052d4a] hover:bg-slate-200'
                                            }`}>
                                            {yr > 0 ? compact(yr) : '$0'}
                                        </button>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>

            {/* What the list below shows */}
            <div className={`flex items-end justify-between gap-3 flex-wrap pt-4 border-t border-slate-100 ${loading ? 'opacity-50' : ''}`}>
                <div>
                    <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">{scopeLabel} · Closed revenue</p>
                    <p className="text-3xl font-extrabold text-[#052d4a] leading-tight">{money(current)}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                        {cases} case{cases === 1 ? '' : 's'} closed · 0.15% of {money(loanVolume)} loan volume
                    </p>
                </div>
                {(current > 0 || compareRev > 0) && delta !== 0 && (
                    <p className={`text-sm font-semibold flex items-center gap-1 ${delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {delta > 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                        {delta > 0 ? '+' : '−'}{money(Math.abs(delta))} vs {compareLabel}
                    </p>
                )}
            </div>
        </div>
    )
}
