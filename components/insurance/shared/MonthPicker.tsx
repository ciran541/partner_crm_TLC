'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'

/**
 * The ONE month/year picker used wherever HUB shows "by month" figures
 * (Cases → Closed Won, Earnings). Same look and taps everywhere:
 *
 *   ‹ [2026 ▾] ›                       [ Whole year ]  [ All time ]
 *   ┌ Jan ┐┌ Feb ┐┌ Mar ┐┌ Apr ┐┌ May ┐┌ Jun ┐   ← 3 across on phone, 6 on
 *   │$1.2k││  —  ││$3.4k││ …   ││     ││     │     iPad (2 rows), 12 on laptop;
 *   │2 cases                                  │     never scrolls sideways
 *
 * `scope` is 'YYYY-MM' (a month) | 'YYYY' (whole year) | 'all'. Each page
 * supplies what a tile shows (`tile`) and what the two summary buttons show.
 * Tiles are shaded by `weight` within the year on screen.
 */

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Compact money for tiles: $950, $1.8k, $12k, $1.2m */
export function compact(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
    return `$${Math.round(n)}`
}

export interface TileContent {
    /** Drives the shading (0 = empty month). */
    weight: number
    /** Big figure, e.g. "$1.8k". Empty months show "—". */
    main: string
    /** Small line under it, e.g. "$1.2m closed" or "2 cases". */
    sub?: string
}

/**
 * The year selector on its own — ‹ [2026 ▾] › — for pages whose whole view
 * follows one year (the Dashboard). Same look as the one inside MonthPicker.
 */
export function YearPicker({ year, years, maxYear, onChange }: {
    year: number
    /** Newest first. */
    years: number[]
    maxYear: number
    onChange: (year: number) => void
}) {
    const nav = 'w-9 h-10 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 disabled:opacity-25'
    const oldest = years[years.length - 1] ?? maxYear
    return (
        <div className="flex items-center gap-1">
            <button type="button" onClick={() => onChange(year - 1)} disabled={year <= oldest} aria-label="Previous year" className={nav}>
                <ChevronLeft size={18} />
            </button>
            {/* Native select: a big, reliable picker on iPad. */}
            <select value={String(year)} onChange={e => onChange(Number(e.target.value))} aria-label="Year"
                className="h-10 pl-3 pr-8 text-lg font-extrabold rounded-lg border border-slate-200 bg-white text-[#052d4a] outline-none focus:border-[#03a9e7] cursor-pointer">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button type="button" onClick={() => onChange(year + 1)} disabled={year >= maxYear} aria-label="Next year" className={nav}>
                <ChevronRight size={18} />
            </button>
        </div>
    )
}

export default function MonthPicker({
    scope, currentMonth, years, onScope, tile, yearSummary, allTimeSummary, yearControl = true,
}: {
    scope: string
    currentMonth: string
    /** Years to offer, newest first. */
    years: number[]
    onScope: (scope: string) => void
    tile: (month: string) => TileContent
    /** Optional figures shown on the two summary buttons. */
    yearSummary?: ReactNode
    allTimeSummary?: ReactNode
    /** false when the page already has its own YearPicker driving `scope`'s year. */
    yearControl?: boolean
}) {
    const thisYear = Number(currentMonth.slice(0, 4))
    const allTime = scope === 'all'
    const wholeYear = scope.length === 4
    // In "All time" the tiles keep showing the year last picked.
    const [lastYear, setLastYear] = useState(() => (allTime ? thisYear : Number(scope.slice(0, 4))))
    const viewYear = allTime ? lastYear : Number(scope.slice(0, 4))
    const go = (next: string) => {
        if (next !== 'all') setLastYear(Number(next.slice(0, 4)))
        onScope(next)
    }

    const months = MONTH_SHORT.map((_, i) => `${viewYear}-${String(i + 1).padStart(2, '0')}`)
    const tiles = months.map(tile)
    const max = Math.max(1, ...tiles.map(t => t.weight))
    const shade = (w: number) => `rgba(3, 169, 231, ${(0.1 + 0.45 * (w / max)).toFixed(2)})`

    return (
        <div className="space-y-3">
            <div className={`flex items-stretch gap-3 flex-wrap ${yearControl ? 'justify-between' : 'justify-end'}`}>
                {yearControl && <YearPicker year={viewYear} years={years} maxYear={thisYear} onChange={y => go(String(y))} />}
                <div className="flex gap-2 flex-wrap">
                    <SummaryButton label={`${viewYear}`} hint="Whole year" active={wholeYear} onClick={() => go(String(viewYear))}>
                        {yearSummary}
                    </SummaryButton>
                    <SummaryButton label="All time" active={allTime} dark onClick={() => go('all')}>
                        {allTimeSummary}
                    </SummaryButton>
                </div>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 xl:grid-cols-12 gap-2">
                {months.map((key, i) => {
                    const t = tiles[i]
                    const future = key > currentMonth
                    const selected = scope === key
                    const inYear = wholeYear && !future
                    return (
                        <button key={key} type="button" disabled={future} onClick={() => go(key)}
                            aria-label={`${MONTH_SHORT[i]} ${viewYear}: ${t.main}${t.sub ? `, ${t.sub}` : ''}`}
                            className={`rounded-xl px-2 py-2 text-center transition-colors border ${
                                future ? 'bg-slate-50 border-transparent cursor-default'
                                    : selected ? 'bg-[#03a9e7] border-[#03a9e7] text-white shadow-sm'
                                        : `border-transparent hover:border-[#03a9e7] ${inYear ? 'ring-1 ring-[#03a9e7]/40' : ''}`
                            }`}
                            style={selected || future ? undefined : { background: t.weight > 0 ? shade(t.weight) : '#f8fafc' }}>
                            <span className={`block text-[11px] font-semibold ${selected ? 'text-white/85' : future ? 'text-slate-300' : 'text-slate-500'}`}>
                                {MONTH_SHORT[i]}
                            </span>
                            <span className={`block text-sm font-extrabold leading-tight mt-0.5 ${selected ? 'text-white' : t.weight > 0 ? 'text-[#052d4a]' : 'text-slate-300'}`}>
                                {future ? '' : t.weight > 0 ? t.main : '—'}
                            </span>
                            <span className={`block text-[10px] font-medium leading-tight min-h-[13px] ${selected ? 'text-white/85' : 'text-slate-500'}`}>
                                {t.weight > 0 ? t.sub ?? '' : ''}
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

function SummaryButton({ label, hint, active, dark, onClick, children }: {
    label: string; hint?: string; active: boolean; dark?: boolean; onClick: () => void; children?: ReactNode
}) {
    const on = dark ? 'bg-[#052d4a] border-[#052d4a] text-white' : 'bg-[#03a9e7] border-[#03a9e7] text-white'
    return (
        <button type="button" onClick={onClick} aria-pressed={active}
            className={`min-w-[120px] rounded-xl border px-3.5 py-2 text-left transition-colors ${
                active ? on : 'bg-white border-slate-200 hover:border-[#03a9e7]'
            }`}>
            <span className={`block text-[11px] font-bold uppercase tracking-wide ${active ? 'text-white/80' : 'text-slate-500'}`}>
                {label}{hint && label !== hint ? <span className="normal-case font-semibold"> · {hint}</span> : null}
            </span>
            {children && <span className={`block ${active ? '[&_*]:!text-white' : ''}`}>{children}</span>}
        </button>
    )
}
