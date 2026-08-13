'use client'

import { useEffect, useState, useMemo } from 'react'
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer,
} from 'recharts'
import Spinner from '@/components/shared/Spinner'

// Premium-tier feature — property-branded port of
// app/insurance/dashboard/resources/rates/page.tsx ("SORA / FFR Trend").
// Chart series colors are a data-viz palette, not app branding, so nothing
// here needed retheming — reused near-verbatim.

// ── Types ────────────────────────────────────────────────────────────────────
interface ChartPoint {
    date: string
    sora: number | null
    comp_1m: number | null
    comp_3m: number | null
    fedRate: number | null
}
interface LatestSora {
    value_date: string
    sora: number | null
    comp_sora_1m: number | null
    comp_sora_3m: number | null
}
interface LatestFed { date: string; rate: number }

type Range = '1Y' | '5Y' | '10Y' | 'ALL'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function pct(v: number | null | undefined, d = 3) {
    return v != null ? `${Number(v).toFixed(d)}%` : '—'
}

// ── Series ───────────────────────────────────────────────────────────────────
const SERIES = [
    { key: 'sora',    label: 'SORA',             color: '#3b82f6' },
    { key: 'comp_1m', label: 'Compounded 1M',    color: '#f43f5e' },
    { key: 'comp_3m', label: 'Compounded 3M',    color: '#f59e0b' },
    { key: 'fedRate', label: 'US Fed Rate',       color: '#10b981' },
]

// ── Tooltip ──────────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: {
    active?: boolean
    payload?: { dataKey: string; value: number | null }[]
    label?: string
}) {
    if (!active || !payload?.length || !label) return null
    const parts = label.split('-')
    const [y, m] = [parts[0], parts[1]]
    const vals = Object.fromEntries((payload ?? []).map(p => [p.dataKey, p.value]))
    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs min-w-[200px]">
            <p className="font-bold text-slate-700 mb-2">{MONTHS[parseInt(m, 10) - 1]} {y}</p>
            {SERIES.map(s => vals[s.key] != null && (
                <div key={s.key} className="flex items-center justify-between gap-4 py-[3px]">
                    <span className="flex items-center gap-1.5 text-slate-500">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                        {s.label}
                    </span>
                    <span className="font-semibold tabular-nums text-slate-800">
                        {pct(vals[s.key] as number)}
                    </span>
                </div>
            ))}
        </div>
    )
}

function ChartLegend() {
    return (
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-1.5 pt-4">
            {SERIES.map(s => (
                <span key={s.key} className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="w-5 h-[2px] rounded-full inline-block" style={{ background: s.color }} />
                    {s.label}
                </span>
            ))}
        </div>
    )
}

function StatCard({ label, value, sub, color }: {
    label: string; value: string; sub?: string; color: string
}) {
    return (
        <div className="card !p-4 relative overflow-hidden">
            <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r" style={{ background: color }} />
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 pl-3">{label}</p>
            <p className="text-[22px] font-bold text-[#052d4a] tabular-nums pl-3 leading-tight">{value}</p>
            {sub && <p className="text-xs text-slate-400 mt-1 pl-3">{sub}</p>}
        </div>
    )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PropertySoraTrendPage() {
    const [chartData, setChartData]   = useState<ChartPoint[]>([])
    const [latestSora, setLatestSora] = useState<LatestSora | null>(null)
    const [latestFed,  setLatestFed]  = useState<LatestFed | null>(null)
    const [loading,    setLoading]    = useState(true)
    const [fetchErr,   setFetchErr]   = useState<string | null>(null)
    const [range,      setRange]      = useState<Range>('ALL')

    useEffect(() => {
        setLoading(true)
        fetch('/api/insurance/resources/chart-data')
            .then(r => r.ok ? r.json() : Promise.reject('Failed'))
            .then(d => {
                setChartData(d.chartData ?? [])
                setLatestSora(d.latestSora ?? null)
                setLatestFed(d.latestFed ?? null)
            })
            .catch(() => setFetchErr('Could not load market data. Please refresh.'))
            .finally(() => setLoading(false))
    }, [])

    const filtered = useMemo(() => {
        if (range === 'ALL') return chartData
        const mo = range === '1Y' ? 12 : range === '5Y' ? 60 : 120
        const cutoff = new Date()
        cutoff.setMonth(cutoff.getMonth() - mo)
        const cutoffYM = cutoff.toISOString().substring(0, 7)
        return chartData.filter(r => r.date >= cutoffYM)
    }, [chartData, range])

    const xTicks = useMemo(() => {
        const seen = new Set<string>()
        const ticks: string[] = []
        for (const r of filtered) {
            const [y, m] = r.date.split('-')
            const mo = parseInt(m, 10)
            let key: string
            if      (range === '1Y') key = r.date
            else if (range === '5Y') key = `${y}-Q${Math.ceil(mo / 3)}`
            else                     key = y
            if (!seen.has(key)) { seen.add(key); ticks.push(r.date) }
        }
        return ticks
    }, [filtered, range])

    const tickFmt = (ym: string) => {
        const [y, m] = ym.split('-')
        const mo = parseInt(m, 10)
        if (range === '1Y')  return MONTHS[mo - 1]
        if (range === '5Y')  return mo === 1 ? y : `${MONTHS[mo - 1]} '${y.slice(2)}`
        return y
    }

    const yMax = useMemo(() => {
        let max = 0
        for (const r of filtered) {
            for (const k of ['sora','comp_1m','comp_3m','fedRate'] as const) {
                const v = r[k]; if (v != null && v > max) max = v
            }
        }
        return Math.ceil(max * 1.15 * 2) / 2 || 6
    }, [filtered])

    const fedSub = latestFed
        ? `${MONTHS[parseInt(latestFed.date.substring(5, 7), 10) - 1]} ${latestFed.date.substring(0, 4)}`
        : undefined

    if (loading) return <div className="flex justify-center py-24"><Spinner /></div>
    if (fetchErr) return <div className="card text-center py-12 text-sm text-red-500">{fetchErr}</div>
    if (!chartData.length) return (
        <div className="card text-center py-16 text-sm text-slate-500">
            No data available. Check that MAS_API_KEY is configured.
        </div>
    )

    return (
        <>
            <div className="grid grid-cols-3 gap-4 mb-6">
                <StatCard label="Compounded SORA 1M" value={pct(latestSora?.comp_sora_1m)} sub={latestSora?.value_date} color="#f43f5e" />
                <StatCard label="Compounded SORA 3M" value={pct(latestSora?.comp_sora_3m)} sub={latestSora?.value_date} color="#f59e0b" />
                <StatCard label="US Fed Funds Rate"   value={pct(latestFed?.rate, 2)}       sub={fedSub}                color="#10b981" />
            </div>

            <div className="card !p-5">
                <div className="flex items-center justify-between mb-5">
                    <p className="font-semibold text-sm text-[#052d4a]">SORA &amp; Fed Rate — Monthly averages</p>
                    <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
                        {(['1Y','5Y','10Y','ALL'] as Range[]).map(r => (
                            <button
                                key={r}
                                onClick={() => setRange(r)}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                                    range === r ? 'bg-white text-[#052d4a] shadow-sm' : 'text-slate-400 hover:text-slate-600'
                                }`}
                            >
                                {r}
                            </button>
                        ))}
                    </div>
                </div>

                <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={filtered} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="4 4" stroke="#f1f5f9" vertical={false} />
                        <XAxis
                            dataKey="date"
                            ticks={xTicks}
                            interval={0}
                            tickFormatter={tickFmt}
                            tick={{ fontSize: 11, fill: '#94a3b8' }}
                            axisLine={{ stroke: '#e2e8f0' }}
                            tickLine={false}
                            dy={6}
                        />
                        <YAxis
                            tickFormatter={v => `${v}%`}
                            tick={{ fontSize: 11, fill: '#94a3b8' }}
                            axisLine={false}
                            tickLine={false}
                            width={40}
                            domain={[0, yMax]}
                        />
                        <Tooltip
                            content={<ChartTooltip />}
                            cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '3 3' }}
                        />
                        <Line type="monotone"  dataKey="sora"    stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                        <Line type="monotone"  dataKey="comp_1m" stroke="#f43f5e" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                        <Line type="monotone"  dataKey="comp_3m" stroke="#f59e0b" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                        <Line type="stepAfter" dataKey="fedRate" stroke="#10b981" strokeWidth={2}   dot={false} isAnimationActive={false} connectNulls />
                    </LineChart>
                </ResponsiveContainer>
                <ChartLegend />
            </div>

            <p className="text-xs text-slate-400 mt-4 text-center">
                SORA: Monetary Authority of Singapore (MAS)&nbsp;·&nbsp;Fed Rate: US Federal Reserve (FRED)
            </p>
        </>
    )
}
