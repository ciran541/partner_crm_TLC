'use client'

import { useEffect, useState, useMemo } from 'react'
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer,
} from 'recharts'
import { BarChart2, RefreshCw } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'

// ── Types ────────────────────────────────────────────────────────────────────
interface ChartPoint {
    date: string            // "YYYY-MM"
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

type Range = '1Y' | '3Y' | '5Y' | 'ALL'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function pct(v: number | null | undefined, d = 3) {
    return v != null ? `${Number(v).toFixed(d)}%` : '—'
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
const SERIES = [
    { key: 'sora',    label: 'SORA',               color: '#3b82f6' },
    { key: 'comp_1m', label: 'Compounded SORA 1M',  color: '#f43f5e' },
    { key: 'comp_3m', label: 'Compounded SORA 3M',  color: '#f59e0b' },
    { key: 'fedRate', label: 'Fed Rate',             color: '#10b981' },
]

function ChartTooltip({ active, payload, label }: {
    active?: boolean
    payload?: { dataKey: string; value: number | null; color: string }[]
    label?: string
}) {
    if (!active || !payload?.length || !label) return null
    const [y, m] = label.split('-')
    const values = Object.fromEntries((payload ?? []).map(p => [p.dataKey, p.value]))
    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs min-w-[200px]">
            <p className="font-bold text-slate-700 mb-2">{MONTHS[parseInt(m, 10) - 1]} {y}</p>
            {SERIES.map(s => values[s.key] != null && (
                <div key={s.key} className="flex items-center justify-between gap-4 py-[3px]">
                    <span className="flex items-center gap-1.5 text-slate-500">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                        {s.label}
                    </span>
                    <span className="font-semibold tabular-nums text-slate-800">
                        {pct(values[s.key] as number)}
                    </span>
                </div>
            ))}
        </div>
    )
}

// ── Chart legend ──────────────────────────────────────────────────────────────
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

// ── Stat card ─────────────────────────────────────────────────────────────────
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
export default function ResourcesPage() {
    const [chartData, setChartData]     = useState<ChartPoint[]>([])
    const [latestSora, setLatestSora]   = useState<LatestSora | null>(null)
    const [latestFed,  setLatestFed]    = useState<LatestFed | null>(null)
    const [adminUser,  setAdminUser]    = useState(false)
    const [loading,    setLoading]      = useState(true)
    const [backfilling,setBackfilling]  = useState(false)
    const [backfillErr,setBackfillErr]  = useState<string | null>(null)
    const [fetchErr,   setFetchErr]     = useState<string | null>(null)
    const [range,      setRange]        = useState<Range>('ALL')

    async function loadData() {
        setLoading(true)
        setFetchErr(null)
        try {
            const res = await fetch('/api/insurance/resources/chart-data')
            if (!res.ok) throw new Error('Failed to load')
            const d = await res.json()
            setChartData(d.chartData ?? [])
            setLatestSora(d.latestSora ?? null)
            setLatestFed(d.latestFed ?? null)
            setAdminUser(d.isAdmin ?? false)
        } catch {
            setFetchErr('Could not load market data. Please refresh.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { loadData() }, [])

    async function handleBackfill() {
        setBackfilling(true)
        setBackfillErr(null)
        try {
            const res = await fetch('/api/admin/resources/backfill-sora', { method: 'POST' })
            const d = await res.json()
            if (!res.ok) throw new Error(d.error ?? 'Backfill failed')
            await loadData()
        } catch (e) {
            setBackfillErr(e instanceof Error ? e.message : 'Backfill failed')
        } finally {
            setBackfilling(false)
        }
    }

    // Filter by selected range (monthly data — cut by YYYY-MM prefix)
    const filtered = useMemo(() => {
        if (range === 'ALL') return chartData
        const monthsBack = range === '1Y' ? 12 : range === '3Y' ? 36 : 60
        const cutoff = new Date()
        cutoff.setMonth(cutoff.getMonth() - monthsBack)
        const cutoffYM = cutoff.toISOString().substring(0, 7)    // "YYYY-MM"
        return chartData.filter(r => r.date >= cutoffYM)
    }, [chartData, range])

    // X-axis ticks: yearly for ALL/5Y, quarterly for 3Y, monthly for 1Y
    const xTicks = useMemo(() => {
        const seen = new Set<string>()
        const ticks: string[] = []
        for (const r of filtered) {
            const [y, m] = r.date.split('-')
            const mo = parseInt(m, 10)
            let key: string
            if      (range === '1Y') key = r.date
            else if (range === '3Y') key = `${y}-Q${Math.floor((mo - 1) / 3)}`
            else                     key = y
            if (!seen.has(key)) { seen.add(key); ticks.push(r.date) }
        }
        return ticks
    }, [filtered, range])

    const tickFmt = (ym: string) => {
        const [y, m] = ym.split('-')
        const mo = parseInt(m, 10)
        if (range === '1Y') return MONTHS[mo - 1]
        if (range === '3Y') return `${MONTHS[mo - 1]} '${y.slice(2)}`
        return y
    }

    // Y-axis: tight ceiling — 15% above actual data max
    const yMax = useMemo(() => {
        let max = 0
        for (const r of filtered) {
            if (r.sora    != null && r.sora    > max) max = r.sora
            if (r.comp_1m != null && r.comp_1m > max) max = r.comp_1m
            if (r.comp_3m != null && r.comp_3m > max) max = r.comp_3m
            if (r.fedRate != null && r.fedRate > max) max = r.fedRate
        }
        return parseFloat((max * 1.15).toFixed(1)) || 6
    }, [filtered])

    const isEmpty = !loading && !fetchErr && chartData.length === 0

    return (
        <div>
            {/* Header */}
            <div className="mb-6">
                <div className="flex items-center gap-2.5 mb-1">
                    <BarChart2 size={22} className="text-[#03a9e7]" />
                    <h1 className="text-2xl font-bold text-[#052d4a]">Market Data</h1>
                </div>
                <p className="text-sm text-slate-500 ml-[30px]">
                    Historical SORA benchmark rates and US Federal Funds Rate
                </p>
            </div>

            {loading ? (
                <div className="flex justify-center py-24"><Spinner /></div>
            ) : fetchErr ? (
                <div className="card text-center py-12 text-sm text-red-500">{fetchErr}</div>
            ) : isEmpty ? (
                <div className="card text-center py-20">
                    <BarChart2 size={44} className="mx-auto mb-4 text-slate-200" />
                    <p className="font-semibold text-slate-600 mb-1">No historical data loaded yet</p>
                    <p className="text-sm text-slate-400 mb-7 max-w-xs mx-auto">
                        SORA history needs to be fetched from MAS once to populate the chart.
                    </p>
                    {adminUser && (
                        <>
                            <button
                                onClick={handleBackfill}
                                disabled={backfilling}
                                className="btn-primary inline-flex items-center gap-2"
                            >
                                <RefreshCw size={14} className={backfilling ? 'animate-spin' : ''} />
                                {backfilling ? 'Loading SORA history…' : 'Load SORA History'}
                            </button>
                            {backfillErr && <p className="text-xs text-red-500 mt-3">{backfillErr}</p>}
                        </>
                    )}
                </div>
            ) : (
                <>
                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-4 mb-6">
                        <StatCard
                            label="Compounded SORA 1M"
                            value={pct(latestSora?.comp_sora_1m)}
                            sub={latestSora?.value_date}
                            color="#f43f5e"
                        />
                        <StatCard
                            label="Compounded SORA 3M"
                            value={pct(latestSora?.comp_sora_3m)}
                            sub={latestSora?.value_date}
                            color="#f59e0b"
                        />
                        <StatCard
                            label="US Fed Funds Rate"
                            value={pct(latestFed?.rate, 2)}
                            sub={latestFed ? `${MONTHS[parseInt(latestFed.date.substring(5, 7), 10) - 1]} ${latestFed.date.substring(0, 4)}` : undefined}
                            color="#10b981"
                        />
                    </div>

                    {/* Chart */}
                    <div className="card !p-5">
                        <div className="flex items-center justify-between mb-5">
                            <p className="font-semibold text-sm text-[#052d4a]">
                                SORA &amp; Fed Rate — Historical (monthly)
                            </p>
                            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
                                {(['1Y', '3Y', '5Y', 'ALL'] as Range[]).map(r => (
                                    <button
                                        key={r}
                                        onClick={() => setRange(r)}
                                        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                                            range === r
                                                ? 'bg-white text-[#052d4a] shadow-sm'
                                                : 'text-slate-400 hover:text-slate-600'
                                        }`}
                                    >
                                        {r}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <ResponsiveContainer width="100%" height={380}>
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
                                    width={38}
                                    domain={[0, yMax]}
                                />
                                <Tooltip
                                    content={<ChartTooltip />}
                                    cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '3 3' }}
                                />
                                <Line type="monotone"  dataKey="sora"    name="SORA"               stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                                <Line type="monotone"  dataKey="comp_1m" name="Compounded SORA 1M" stroke="#f43f5e" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                                <Line type="monotone"  dataKey="comp_3m" name="Compounded SORA 3M" stroke="#f59e0b" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                                <Line type="stepAfter" dataKey="fedRate" name="Fed Rate"            stroke="#10b981" strokeWidth={2}   dot={false} isAnimationActive={false} connectNulls />
                            </LineChart>
                        </ResponsiveContainer>

                        <ChartLegend />
                    </div>

                    <p className="text-xs text-slate-400 mt-4 text-center">
                        SORA: Monetary Authority of Singapore (MAS) &nbsp;·&nbsp; Fed Rate: US Federal Reserve via FRED
                    </p>
                </>
            )}
        </div>
    )
}
