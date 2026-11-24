'use client'

import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Info, Landmark, CheckCircle2, Calculator, TrendingUp, TrendingDown } from 'lucide-react'
import Skeleton from '@/components/shared/Skeleton'
import MonthPicker, { YearPicker, compact } from '@/components/insurance/shared/MonthPicker'
import { todaySgt } from '@/lib/insurance/promotions'
import {
    performance, monthPerformance, monthlyTrend, sourceBreakdown, laterClosingsLabel, cohort, lostReasons, comingDue,
    type DashboardData, type TrendMetric,
} from '@/lib/insurance/dashboardStats'

/**
 * Dashboard — "how is my business doing?" Analysis only: no case lists (Cases),
 * no commission (Earnings), no to-dos (Action Centre). Four sections, one year
 * picker for the whole page:
 *
 *   1. Business performance — loans closed, cases, average loan, YoY (same months)
 *   2. Production trend     — monthly bars, Quantum / Cases, last year as ghost bars.
 *                             LINKED: tapping a month's bar switches section 1 to
 *                             that month (vs the same month last year); "Show all
 *                             of <year>" goes back. No second month control.
 *   3. Lead sources         — one ranked list of the year's leads: bar = won (blue =
 *                             closed that year, red = closed later), with leads /
 *                             won / open / conversion beside it.
 *                             Replaces the concept's pie + table: 8 slices can't be
 *                             compared or told apart (colour-blind agents), a
 *                             ranked bar per source can.
 *   4. Conversion           — leads by the month they were first activated
 *                             (month tiles, same picker as Closed Won / Earnings),
 *                             won / lost / still open; provisional while open.
 *
 *   5. Why deals are lost   — Closed Lost reasons, ranked (all time or the page's year)
 *   6. Business coming due  — past clients' loans by lock-in end month, next 12 months
 *                             (always from today, so it ignores the year picker)
 *
 * All maths: lib/insurance/dashboardStats.ts (tested). Data: GET /api/insurance/dashboard.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Chart colours (validated: won/lost pass the colour-blind check; "open" is a
// neutral remainder). Every segment is also labelled, so colour is never alone.
const C = {
    thisYear: '#03a9e7',     // brand cyan
    lastYear: '#cbd5e1',     // recessive ghost
    later: '#e34948',        // this year's leads closed in a later year
    won: '#1baf7a',
    lost: '#eb6834',
    open: '#cbd5e1',
}

const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`)

export default function DashboardPage() {
    const currentMonth = todaySgt().slice(0, 7)
    const thisYear = Number(currentMonth.slice(0, 4))

    const [data, setData] = useState<DashboardData | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [year, setYear] = useState(thisYear)
    const [metric, setMetric] = useState<TrendMetric>('quantum')
    // Month picked on the trend chart (0–11) → Business performance shows that month.
    const [month, setMonth] = useState<number | null>(null)
    // Conversion: a cohort month ('YYYY-MM'), the whole year ('YYYY') or 'all'.
    const [cohortScope, setCohortScope] = useState(String(thisYear))

    useEffect(() => {
        let alive = true
        fetch('/api/insurance/dashboard')
            .then(r => (r.ok ? r.json() : Promise.reject(new Error('load'))))
            .then(d => { if (alive) setData({ won_by_year: d.won_by_year ?? [], closed: d.closed ?? [], leads: d.leads ?? [], lost: d.lost ?? [], coming_due: d.coming_due ?? [] }) })
            .catch(() => { if (alive) setError('Could not load your dashboard. Please refresh.') })
        return () => { alive = false }
    }, [])

    const years = useMemo(() => {
        const ys = new Set<number>([thisYear])
        for (const r of [...(data?.closed ?? []), ...(data?.leads ?? [])]) ys.add(Number(r.month.slice(0, 4)))
        return [...ys].filter(y => y <= thisYear).sort((a, b) => b - a)
    }, [data, thisYear])

    const pickYear = (y: number) => { setYear(y); setCohortScope(String(y)); setMonth(null) }

    return (
        <div className="max-w-[1200px] mx-auto flex flex-col gap-5">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="ios-page-title flex items-center gap-2"><BarChart3 size={24} /> Dashboard</h1>
                    <p className="page-subtitle">How your business is doing, and what&apos;s coming.</p>
                </div>
                <div className="card px-2 py-1"><YearPicker year={year} years={years} maxYear={thisYear} onChange={pickYear} /></div>
            </div>

            {error ? (
                <div className="card p-6 text-sm text-red-600">{error}</div>
            ) : !data ? (
                <div className="flex flex-col gap-5">
                    <Skeleton height={160} radius={14} /><Skeleton height={260} radius={14} /><Skeleton height={260} radius={14} />
                </div>
            ) : (
                <>
                    <Performance data={data} year={year} month={month} currentMonth={currentMonth} onClearMonth={() => setMonth(null)} />
                    <Trend data={data} year={year} currentMonth={currentMonth} metric={metric} onMetric={setMetric}
                        selected={month} onSelect={i => setMonth(m => (m === i ? null : i))} />
                    <Sources data={data} year={year} />
                    <Conversion data={data} year={year} currentMonth={currentMonth} years={years}
                        scope={cohortScope} onScope={s => { setCohortScope(s); if (s !== 'all') setYear(Number(s.slice(0, 4))) }} />
                    <Lost data={data} year={year} />
                    <ComingDue data={data} currentMonth={currentMonth} />
                </>
            )}
        </div>
    )
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

function Section({ title, subtitle, action, children }: { title: string; subtitle: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="card p-4 sm:p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-base font-bold text-[#052d4a]">{title}</h2>
                    <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
                </div>
                {action}
            </div>
            {children}
        </section>
    )
}

function Stat({ icon: Icon, label, value, sub, tone }: { icon: React.ElementType; label: string; value: string; sub?: React.ReactNode; tone?: 'up' | 'down' }) {
    return (
        <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3.5">
            <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5"><Icon size={14} className="text-slate-400" /> {label}</p>
            <p className={`text-2xl sm:text-[28px] font-extrabold mt-1.5 leading-none tracking-tight ${
                tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-red-600' : 'text-[#052d4a]'
            }`}>{value}</p>
            {sub && <p className="text-[11px] text-slate-500 mt-1.5">{sub}</p>}
        </div>
    )
}

// ─── 1. Business performance ─────────────────────────────────────────────────

function Performance({ data, year, month, currentMonth, onClearMonth }: {
    data: DashboardData; year: number; month: number | null; currentMonth: string; onClearMonth: () => void
}) {
    const ym = month != null ? `${year}-${String(month + 1).padStart(2, '0')}` : null
    const p = ym ? monthPerformance(data.closed, ym) : performance(data.closed, year, currentMonth)
    const period = month != null ? `${MONTHS_LONG[month]} ${year}` : String(year)
    const prevPeriod = month != null ? `${MONTHS_LONG[month]} ${year - 1}` : String(year - 1)
    const span = month != null ? `vs ${prevPeriod}`
        : p.monthsCompared === 12 ? `${year} vs ${year - 1}` : `Jan–${MONTHS[p.monthsCompared - 1]} ${year} vs same months ${year - 1}`
    const g = p.yoyGrowthPct
    return (
        <Section title={`Business performance · ${period}`}
            subtitle={month != null ? 'Cases marked Closed Won in the month. Tap another month on the chart below, or go back to the year.' : 'Based on cases marked Closed Won in the year. Tap a month on the chart below for that month.'}
            action={month != null ? (
                <button type="button" onClick={onClearMonth}
                    className="h-9 px-3.5 rounded-full border border-[#03a9e7] text-sm font-semibold text-[#0369a1] hover:bg-sky-50">
                    Show all of {year}
                </button>
            ) : undefined}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat icon={Landmark} label="Loans closed" value={p.loanVolume > 0 ? compact(p.loanVolume) : '$0'} />
                <Stat icon={CheckCircle2} label="Cases closed" value={String(p.cases)} />
                <Stat icon={Calculator} label="Average loan" value={p.averageLoan != null ? compact(p.averageLoan) : '—'} />
                <Stat icon={g != null && g < 0 ? TrendingDown : TrendingUp} label="Year-on-year growth"
                    value={g == null ? '—' : `${g >= 0 ? '+' : ''}${g.toFixed(1)}%`}
                    tone={g == null ? undefined : g >= 0 ? 'up' : 'down'}
                    sub={g == null ? `No closings in ${prevPeriod} to compare` : span} />
            </div>
        </Section>
    )
}

// ─── 2. Production trend ─────────────────────────────────────────────────────

function Trend({ data, year, currentMonth, metric, onMetric, selected, onSelect }: {
    data: DashboardData; year: number; currentMonth: string; metric: TrendMetric; onMetric: (m: TrendMetric) => void
    selected: number | null; onSelect: (i: number) => void
}) {
    const { thisYear, lastYear } = monthlyTrend(data.closed, year, metric)
    const [hover, setHover] = useState<number | null>(null)
    const max = Math.max(1, ...thisYear, ...lastYear)
    const fmt = (v: number) => (metric === 'quantum' ? (v > 0 ? compact(v) : '$0') : String(v))
    const lastIdx = year === Number(currentMonth.slice(0, 4)) ? Number(currentMonth.slice(5)) - 1 : 11
    const hasLastYear = lastYear.some(v => v > 0)

    // Geometry (SVG units; scales to the card's width). Thin bars, 4px rounded tops.
    const W = 720, H = 200, top = 24, base = H - 22, slot = W / 12
    const barW = Math.min(22, slot * 0.32)
    const y = (v: number) => base - (v / max) * (base - top)

    return (
        <Section title="Production trend" subtitle={`Monthly ${metric === 'quantum' ? 'loan quantum' : 'cases'} closed in ${year}${hasLastYear ? `, with ${year - 1} behind it` : ''}. Tap a month to see it above.`}
            action={
                <div className="flex gap-1 p-1 rounded-xl bg-slate-100" role="tablist" aria-label="Measure">
                    {(['quantum', 'cases'] as TrendMetric[]).map(m => (
                        <button key={m} type="button" onClick={() => onMetric(m)} aria-pressed={metric === m}
                            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${metric === m ? 'bg-white text-[#052d4a] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                            {m === 'quantum' ? 'Quantum' : 'Cases'}
                        </button>
                    ))}
                </div>
            }>
            <div className="relative">
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
                    aria-label={`Monthly ${metric} for ${year}`} onMouseLeave={() => setHover(null)}>
                    {/* recessive baseline */}
                    <line x1={0} x2={W} y1={base} y2={base} stroke="#e2e8f0" strokeWidth={1} />
                    {MONTHS.map((m, i) => {
                        const cx = slot * i + slot / 2
                        const future = i > lastIdx
                        return (
                            <g key={m} onMouseEnter={() => setHover(i)}
                                onClick={() => { if (!future) onSelect(i) }}
                                style={{ cursor: future ? 'default' : 'pointer' }}
                                role="button" aria-pressed={selected === i} aria-label={`${MONTHS_LONG[i]} ${year}`}>
                                {/* hit target wider than the marks; the selected month stays highlighted */}
                                <rect x={slot * i + 2} y={0} width={slot - 4} height={H} rx={8}
                                    fill={selected === i ? '#e0f2fe' : hover === i && !future ? '#f1f5f9' : 'transparent'} />
                                {hasLastYear && lastYear[i] > 0 && (
                                    <path d={bar(cx - barW - 1, y(lastYear[i]), barW, base - y(lastYear[i]))} fill={C.lastYear} />
                                )}
                                {!future && thisYear[i] > 0 && (
                                    <path d={bar(hasLastYear ? cx + 1 : cx - barW / 2, y(thisYear[i]), barW, base - y(thisYear[i]))} fill={C.thisYear} />
                                )}
                                {/* direct label on the selected month, else the latest */}
                                {i === (selected ?? lastIdx) && thisYear[i] > 0 && (
                                    <text x={hasLastYear ? cx + 1 + barW / 2 : cx} y={y(thisYear[i]) - 6} textAnchor="middle" fontSize={12} fontWeight={700} fill="#052d4a">{fmt(thisYear[i])}</text>
                                )}
                                <text x={cx} y={H - 6} textAnchor="middle" fontSize={11}
                                    fontWeight={selected === i ? 700 : 400}
                                    fill={future ? '#cbd5e1' : selected === i ? '#0369a1' : '#64748b'}>{m}</text>
                            </g>
                        )
                    })}
                </svg>
                {hover != null && (
                    <div className="absolute top-0 pointer-events-none rounded-lg bg-[#052d4a] text-white text-xs px-3 py-2 shadow-lg"
                        style={{ left: `clamp(0px, calc(${((hover + 0.5) / 12) * 100}% - 70px), calc(100% - 140px))`, width: 140 }}>
                        <p className="font-bold">{MONTHS_LONG[hover]}</p>
                        <p className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: C.thisYear }} /> {year}: <b>{fmt(thisYear[hover])}</b></p>
                        {hasLastYear && <p className="flex items-center gap-1.5 text-white/75"><span className="w-2 h-2 rounded-sm" style={{ background: C.lastYear }} /> {year - 1}: {fmt(lastYear[hover])}</p>}
                    </div>
                )}
            </div>
            {hasLastYear && (
                <div className="flex gap-4 text-xs text-slate-600">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: C.thisYear }} /> {year}</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: C.lastYear }} /> {year - 1}</span>
                </div>
            )}
        </Section>
    )
}

/** A bar with 4px rounded top corners, square at the baseline. */
function bar(x: number, yTop: number, w: number, h: number): string {
    if (h <= 0) return ''
    const r = Math.min(4, w / 2, h)
    return `M${x},${yTop + h} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yTop + h} Z`
}

// ─── 3. Lead sources ─────────────────────────────────────────────────────────

function Sources({ data, year }: { data: DashboardData; year: number }) {
    const rows = sourceBreakdown(data, year)
    const maxWon = Math.max(1, ...rows.map(r => r.closedCases + r.laterCases))
    const laterLabel = laterClosingsLabel(data, year)
    const notSet = rows.find(r => r.source === 'not_set')

    return (
        <Section title={`Lead sources · ${year}`} subtitle="Which channels bring you business, and how well each one converts.">
            {rows.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">No leads in {year} yet.</p>
            ) : (
                <div>
                    <div className="hidden md:grid grid-cols-[1.3fr_2fr_70px_70px_60px_90px] gap-3 px-1 pb-2 text-[11px] font-bold text-slate-500 uppercase tracking-wide border-b border-slate-100">
                        <span>Source</span><span className="flex gap-4">
                            <span className="text-[#0369a1]">Closed in {year}</span>
                            <span className="text-red-600">{laterLabel}</span>
                        </span><span className="text-right">Leads</span><span className="text-right">Won</span><span className="text-right">Open</span><span className="text-right">Conversion</span>
                    </div>
                    <p className="md:hidden flex gap-4 pb-1 text-xs font-bold">
                        <span className="text-[#0369a1]">Closed in {year}</span>
                        <span className="text-red-600">{laterLabel}</span>
                    </p>
                    {rows.map(r => (
                        <div key={r.source} className="grid grid-cols-[1fr_auto] md:grid-cols-[1.3fr_2fr_70px_70px_60px_90px] gap-x-3 gap-y-1.5 items-center px-1 py-3 border-b border-slate-50 last:border-b-0">
                            <p className={`text-sm font-semibold ${r.source === 'not_set' ? 'text-slate-400' : 'text-slate-800'}`}>{r.label}</p>
                            {/* conversion sits top-right on narrow screens */}
                            <p className="md:hidden text-right text-sm font-bold text-[#052d4a]">{pct(r.conversionPct)}</p>
                            <div className="col-span-2 md:col-span-1 flex items-center gap-2">
                                <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden flex gap-[2px]">
                                    {r.closedCases > 0 && <div className="h-full" title={`Closed in ${year}: ${r.closedCases}`} style={{ width: `${(r.closedCases / maxWon) * 100}%`, background: r.source === 'not_set' ? '#94a3b8' : C.thisYear }} />}
                                    {r.laterCases > 0 && <div className="h-full" title={`${laterLabel}: ${r.laterCases}`} style={{ width: `${(r.laterCases / maxWon) * 100}%`, background: C.later }} />}
                                </div>
                                <span className="text-xs w-[92px] text-right tabular-nums">
                                    <span className="block text-slate-600">{r.closedCases} · {r.closedVolume > 0 ? compact(r.closedVolume) : '$0'}</span>
                                    {r.laterCases > 0 && <span className="block text-red-600">{r.laterCases} · {compact(r.laterVolume)}</span>}
                                </span>
                            </div>
                            <p className="md:hidden col-span-2 text-xs text-slate-500">{r.leads} leads · {r.won} won · {r.open} still open</p>
                            <span className="hidden md:block text-right text-sm tabular-nums text-slate-700">{r.leads}</span>
                            <span className="hidden md:block text-right text-sm tabular-nums text-slate-700">{r.won}</span>
                            <span className="hidden md:block text-right text-sm tabular-nums text-slate-400">{r.open}</span>
                            <span className="hidden md:block text-right text-sm font-bold tabular-nums text-[#052d4a]">{pct(r.conversionPct)}</span>
                        </div>
                    ))}
                    <div className="mt-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[11px] text-slate-600 leading-relaxed flex gap-2">
                        <Info size={13} className="shrink-0 mt-0.5 text-slate-400" />
                        <span>
                            All figures follow leads first activated in {year}. <b className="text-[#0369a1]">Blue</b>: closed in {year}.{' '}
                            <b className="text-red-600">Red</b>: closed in a later year, still counted towards {year}&apos;s conversion.
                            {notSet && <> &ldquo;Not set&rdquo; are cases without a lead source; add one on the case page to sharpen these figures.</>}
                        </span>
                    </div>
                </div>
            )}
        </Section>
    )
}

// ─── 4. Conversion by activation cohort ──────────────────────────────────────

function Conversion({ data, year, currentMonth, years, scope, onScope }: {
    data: DashboardData; year: number; currentMonth: string; years: number[]; scope: string; onScope: (s: string) => void
}) {
    const c = cohort(data.leads, scope)
    const label = scope === 'all' ? 'All time'
        : scope.length === 4 ? `All of ${scope}`
            : `${MONTHS_LONG[Number(scope.slice(5)) - 1]} ${scope.slice(0, 4)}`
    const seg = (n: number) => (c.activated > 0 ? (n / c.activated) * 100 : 0)

    return (
        <Section title="Conversion" subtitle="Leads grouped by the month they were first activated, and how they turned out.">
            <MonthPicker
                scope={scope === 'all' ? 'all' : scope.length === 4 ? String(year) : scope}
                currentMonth={currentMonth}
                years={years}
                onScope={onScope}
                yearControl={false}
                tile={m => {
                    const t = cohort(data.leads, m)
                    return { weight: t.activated, main: pct(t.conversionPct), sub: t.activated ? `${t.activated} lead${t.activated === 1 ? '' : 's'}` : '' }
                }}
            />

            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                <div className="flex items-end justify-between gap-4 flex-wrap">
                    <div className="flex gap-8 flex-wrap">
                        <div>
                            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{label} · Activated leads</p>
                            <p className="text-3xl font-extrabold text-[#052d4a] leading-tight">{c.activated}</p>
                        </div>
                        <div>
                            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Conversion to Closed Won</p>
                            <p className="text-3xl font-extrabold text-emerald-600 leading-tight">{pct(c.conversionPct)}</p>
                        </div>
                    </div>
                    {c.provisional && (
                        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                            Provisional: {c.open} still open
                        </span>
                    )}
                </div>

                {c.activated > 0 && (
                    <>
                        {/* Won / Lost / Still open — 2px gaps between segments, each labelled below */}
                        <div className="flex h-3 rounded-full overflow-hidden gap-[2px] bg-white">
                            {c.won > 0 && <div style={{ width: `${seg(c.won)}%`, background: C.won }} title={`Won ${c.won}`} />}
                            {c.lost > 0 && <div style={{ width: `${seg(c.lost)}%`, background: C.lost }} title={`Lost ${c.lost}`} />}
                            {c.open > 0 && <div style={{ width: `${seg(c.open)}%`, background: C.open }} title={`Still open ${c.open}`} />}
                        </div>
                        <div className="flex gap-4 flex-wrap text-xs text-slate-700">
                            <Legend color={C.won} text={`Won ${c.won}`} />
                            <Legend color={C.lost} text={`Lost ${c.lost}`} />
                            <Legend color={C.open} text={`Still open ${c.open}`} />
                        </div>
                    </>
                )}

                <p className="text-[11px] text-slate-500 leading-relaxed flex gap-2">
                    <Info size={13} className="shrink-0 mt-0.5 text-slate-400" />
                    <span>
                        {c.activated > 0
                            ? <>Of the {c.activated} lead{c.activated === 1 ? '' : 's'} first activated {scope === 'all' ? 'so far' : `in ${label.replace('All of ', '')}`}, {c.won} {c.won === 1 ? 'has' : 'have'} closed so far. A lead closed in a later month still counts towards the month it was activated.</>
                            : <>No leads were first activated in this period.</>}
                        {c.provisional && <> The rate is <b>provisional</b> while leads are still open, and can still go up.</>}
                    </span>
                </p>
            </div>
        </Section>
    )
}

function Legend({ color, text }: { color: string; text: string }) {
    return <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} /> {text}</span>
}

// ─── 5. Why deals are lost ───────────────────────────────────────────────────

function Lost({ data, year }: { data: DashboardData; year: number }) {
    const [allTime, setAllTime] = useState(true)
    const lost = data.lost ?? []
    const rows = lostReasons(lost, allTime ? null : year)
    const total = rows.reduce((s, r) => s + r.cases, 0)
    const quantum = rows.reduce((s, r) => s + r.loanVolume, 0)
    const undated = lost.filter(r => !r.month).reduce((s, r) => s + Number(r.cases), 0)
    return (
        <Section title="Why deals are lost" subtitle={`${total} case${total === 1 ? '' : 's'} marked Closed Lost${allTime ? '' : ` in ${year}`}, by reason · Total quantum ${quantum > 0 ? compact(quantum) : '$0'}`}
            action={
                <div className="flex gap-1 p-1 rounded-xl bg-slate-100">
                    {[true, false].map(v => (
                        <button key={String(v)} type="button" onClick={() => setAllTime(v)} aria-pressed={allTime === v}
                            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${allTime === v ? 'bg-white text-[#052d4a] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                            {v ? 'All time' : year}
                        </button>
                    ))}
                </div>
            }>
            {rows.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">No lost deals{allTime ? '' : ` recorded in ${year}`}.</p>
            ) : rows.map(r => (
                <div key={r.reason} className="grid grid-cols-[1fr_auto] md:grid-cols-[1.4fr_2fr_150px] gap-x-3 gap-y-1.5 items-center">
                    <p className="text-sm font-semibold text-slate-800">{r.reason}</p>
                    <p className="text-sm text-right tabular-nums text-slate-700 md:order-3"><b className="text-[#052d4a]">{r.cases}</b> ({r.pct.toFixed(0)}%) · {compact(r.loanVolume)}</p>
                    <div className="col-span-2 md:col-span-1 md:order-2 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(r.cases / rows[0].cases) * 100}%`, background: C.lost }} />
                    </div>
                </div>
            ))}
            {!allTime && undated > 0 && (
                <p className="text-[11px] text-slate-500 flex gap-2"><Info size={13} className="shrink-0 mt-0.5 text-slate-400" />{undated} case{undated === 1 ? ' was' : 's were'} lost before HUB recorded the date, so {undated === 1 ? 'it shows' : 'they show'} under All time only.</p>
            )}
        </Section>
    )
}

// ─── 6. Business coming due ──────────────────────────────────────────────────

function ComingDue({ data, currentMonth }: { data: DashboardData; currentMonth: string }) {
    const rows = comingDue(data.coming_due ?? [], currentMonth)
    const total = rows.reduce((s, r) => s + r.loan_volume, 0)
    const cases = rows.reduce((s, r) => s + r.cases, 0)
    const max = Math.max(1, ...rows.map(r => r.loan_volume))
    return (
        <Section title="Business coming due" subtitle="Past clients (Closed Won and Inactive) by the month their lock-in ends, next 12 months.">
            {cases === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">No lock-ins ending in the next 12 months.</p>
            ) : (
                <>
                    <p className="text-sm text-slate-600"><b className="text-2xl font-extrabold text-[#052d4a] mr-1.5">{compact(total)}</b>across {cases} client{cases === 1 ? '' : 's'}</p>
                    <div className="space-y-2">
                        {rows.map(r => (
                            <div key={r.month} className="grid grid-cols-[72px_1fr_118px] gap-3 items-center">
                                <p className={`text-sm ${r.cases ? 'font-semibold text-slate-800' : 'text-slate-400'}`}>{MONTHS[Number(r.month.slice(5)) - 1]} {r.month.slice(0, 4)}</p>
                                <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${(r.loan_volume / max) * 100}%`, background: C.thisYear }} />
                                </div>
                                <p className={`text-sm text-right tabular-nums ${r.cases ? 'text-slate-700' : 'text-slate-300'}`}>{r.cases ? <><b className="text-[#052d4a]">{compact(r.loan_volume)}</b> · {r.cases} client{r.cases === 1 ? '' : 's'}</> : '—'}</p>
                            </div>
                        ))}
                    </div>
                    <p className="text-[11px] text-slate-500 flex gap-2"><Info size={13} className="shrink-0 mt-0.5 text-slate-400" />Closed Won clients use the projected balance at lock-in end. Live cases and clients already revisited aren&apos;t counted.</p>
                </>
            )}
        </Section>
    )
}
