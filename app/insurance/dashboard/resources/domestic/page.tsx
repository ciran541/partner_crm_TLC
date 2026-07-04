'use client'

import { useState } from 'react'
import { Download, Search } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import { FIELD_CONFIG, FieldConfig } from '@/lib/insurance/domesticRates'

// ── Types ─────────────────────────────────────────────────────────────────────
type Row = Record<string, number | string | null>

const CURRENT_YEAR = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1   // 1-based
const YEARS = Array.from({ length: CURRENT_YEAR - 2004 }, (_, i) => CURRENT_YEAR - i)
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Default selections: the SORA rates most relevant to mortgage agents
const DEFAULT_KEYS = new Set(['comp_sora_1m', 'comp_sora_3m'])

function fmtDate(d: string) {
    const [y, m] = d.split('-')
    return `${MONTH_LABELS[parseInt(m, 10) - 1]} ${d.slice(8, 10)}, ${y}`
}

function fmtVal(val: number | string | null, unit: FieldConfig['unit']) {
    if (val == null) return '—'
    if (unit === 'pct')   return `${Number(val).toFixed(3)}%`
    if (unit === 'index') return Number(val).toFixed(4)
    if (unit === 'bil')   return `S$${Number(val).toFixed(2)}B`
    return String(val)
}

function toCSV(rows: Row[], fields: FieldConfig[]) {
    const header = ['Date', ...fields.map(f => f.label)].join(',')
    const lines  = rows.map(r => [
        r.end_of_day,
        ...fields.map(f => {
            const v = r[f.key]
            return v == null ? '' : String(v)
        }),
    ].join(','))
    return [header, ...lines].join('\n')
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function DomesticRatesPage() {
    const [startYear,  setStartYear]  = useState(CURRENT_YEAR)
    const [startMonth, setStartMonth] = useState(1)
    const [endYear,    setEndYear]    = useState(CURRENT_YEAR)
    const [endMonth,   setEndMonth]   = useState(CURRENT_MONTH)

    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set(DEFAULT_KEYS))
    const [availableKeys, setAvailableKeys] = useState<string[]>([])

    const [rows,    setRows]    = useState<Row[]>([])
    const [loading, setLoading] = useState(false)
    const [error,   setError]   = useState<string | null>(null)
    const [fetched, setFetched] = useState(false)

    const pad = (n: number) => String(n).padStart(2, '0')

    async function handleDisplay() {
        setLoading(true)
        setError(null)
        const start = `${startYear}-${pad(startMonth)}-01`
        // end = last day of end month
        const endDate = new Date(endYear, endMonth, 0)
        const end = `${endYear}-${pad(endMonth)}-${pad(endDate.getDate())}`
        try {
            const res = await fetch(`/api/insurance/resources/domestic-rates?start=${start}&end=${end}`)
            if (!res.ok) throw new Error('Failed to load')
            const d = await res.json()
            setRows(d.rows ?? [])
            setAvailableKeys(d.availableKeys ?? [])
            // Only keep selected keys that exist in available keys
            setSelectedKeys(prev => {
                const valid = new Set(d.availableKeys as string[])
                const next = new Set([...prev].filter(k => valid.has(k)))
                // If nothing selected yet, apply defaults
                if (next.size === 0) {
                    DEFAULT_KEYS.forEach(k => { if (valid.has(k)) next.add(k) })
                }
                return next
            })
            setFetched(true)
        } catch {
            setError('Could not load data. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    function handleDownload() {
        const fields = activeFields
        const csv = toCSV(rows, fields)
        const blob = new Blob([csv], { type: 'text/csv' })
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href     = url
        a.download = `MAS_Domestic_Rates_${startYear}${pad(startMonth)}_${endYear}${pad(endMonth)}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    function toggleKey(key: string) {
        setSelectedKeys(prev => {
            const next = new Set(prev)
            next.has(key) ? next.delete(key) : next.add(key)
            return next
        })
    }

    // Fields available in the API response, with config (label / unit)
    const configuredFields = availableKeys.length
        ? FIELD_CONFIG.filter(f => availableKeys.includes(f.key))
        : FIELD_CONFIG   // before first fetch: show all (for checkbox display purposes)

    const activeFields = configuredFields.filter(f => selectedKeys.has(f.key))

    const selectAll  = () => setSelectedKeys(new Set(configuredFields.map(f => f.key)))
    const clearAll   = () => setSelectedKeys(new Set())

    return (
        <div>
            {/* Filter panel */}
            <div className="card !p-5 mb-6">
                <p className="font-semibold text-sm text-[#052d4a] mb-4">Date Range</p>

                <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-5 max-w-sm">
                    <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Start Year</label>
                        <select
                            value={startYear}
                            onChange={e => setStartYear(+e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm text-[#052d4a] focus:outline-none focus:ring-2 focus:ring-[#03a9e7]"
                        >
                            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Start Month</label>
                        <select
                            value={startMonth}
                            onChange={e => setStartMonth(+e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm text-[#052d4a] focus:outline-none focus:ring-2 focus:ring-[#03a9e7]"
                        >
                            {MONTH_LABELS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">End Year</label>
                        <select
                            value={endYear}
                            onChange={e => setEndYear(+e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm text-[#052d4a] focus:outline-none focus:ring-2 focus:ring-[#03a9e7]"
                        >
                            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">End Month</label>
                        <select
                            value={endMonth}
                            onChange={e => setEndMonth(+e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm text-[#052d4a] focus:outline-none focus:ring-2 focus:ring-[#03a9e7]"
                        >
                            {MONTH_LABELS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                        </select>
                    </div>
                </div>

                {/* Field selector */}
                <div className="mb-5">
                    <div className="flex items-center gap-3 mb-2">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Select Fields</p>
                        <button onClick={selectAll} className="text-xs text-[#03a9e7] hover:underline">Select All</button>
                        <span className="text-slate-300">|</span>
                        <button onClick={clearAll}  className="text-xs text-[#03a9e7] hover:underline">Clear All</button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
                        {configuredFields.map(f => (
                            <label key={f.key} className="flex items-start gap-2 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    checked={selectedKeys.has(f.key)}
                                    onChange={() => toggleKey(f.key)}
                                    className="mt-0.5 shrink-0 accent-[#03a9e7]"
                                />
                                <span className="text-xs text-slate-600 group-hover:text-slate-800 leading-snug">
                                    {f.label}
                                </span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Buttons */}
                <div className="flex gap-3">
                    <button
                        onClick={handleDisplay}
                        disabled={loading}
                        className="btn-primary flex items-center gap-2 disabled:opacity-60"
                    >
                        <Search size={14} />
                        {loading ? 'Loading…' : 'Display'}
                    </button>
                    {fetched && rows.length > 0 && activeFields.length > 0 && (
                        <button
                            onClick={handleDownload}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                        >
                            <Download size={14} />
                            Download CSV
                        </button>
                    )}
                </div>
            </div>

            {/* Results */}
            {error && (
                <div className="text-sm text-red-500 text-center py-4">{error}</div>
            )}

            {loading && (
                <div className="flex justify-center py-16"><Spinner /></div>
            )}

            {!loading && fetched && rows.length === 0 && (
                <div className="card text-center py-12 text-sm text-slate-500">
                    No data found for the selected date range.
                </div>
            )}

            {!loading && fetched && rows.length > 0 && activeFields.length > 0 && (
                <div className="card !p-0 overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                        <p className="text-sm font-semibold text-[#052d4a]">
                            {rows.length.toLocaleString()} records &nbsp;·&nbsp;
                            <span className="text-slate-400 font-normal">most recent first</span>
                        </p>
                        <p className="text-xs text-slate-400">Source: MAS Domestic Interest Rates – Daily</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-100">
                                    <th className="text-left px-4 py-3 font-semibold text-slate-500 whitespace-nowrap sticky left-0 bg-slate-50 z-10">
                                        Date
                                    </th>
                                    {activeFields.map(f => (
                                        <th key={f.key} className="text-right px-4 py-3 font-semibold text-slate-500 whitespace-nowrap">
                                            {f.label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, i) => (
                                    <tr
                                        key={String(row.end_of_day)}
                                        className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors ${
                                            i % 2 === 0 ? '' : 'bg-slate-50/30'
                                        }`}
                                    >
                                        <td className="px-4 py-2.5 font-medium text-[#052d4a] whitespace-nowrap sticky left-0 bg-white">
                                            {fmtDate(String(row.end_of_day))}
                                        </td>
                                        {activeFields.map(f => (
                                            <td key={f.key} className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                                                {fmtVal(row[f.key] ?? null, f.unit)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {!loading && !fetched && (
                <div className="card text-center py-16 text-slate-400">
                    <Search size={36} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">Select a date range and fields, then click Display</p>
                </div>
            )}

            <p className="text-xs text-slate-400 mt-4 text-center">
                Source: Monetary Authority of Singapore (MAS) — Domestic Interest Rates, Daily
            </p>
        </div>
    )
}
