'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, Calculator, Lock } from 'lucide-react'
import { monthlyInstallment } from '@/lib/insurance/loanCalc'
import { effectiveRate } from '@/lib/insurance/rateRecommend'
import { type RateScheduleEntry } from '@/lib/types/rates'

// FD Rate replaced with Custom: agent enters the bank's own base rate + spread
const AMORT_RATE_REFS = ['3M SORA', '1M SORA', 'Custom'] as const
import type { SoraRates } from '@/lib/insurance/sora'

// ── Amortization engine ───────────────────────────────────────────────────────

function resolveEntry(entry: RateScheduleEntry, sora: SoraRates | null): number | null {
    if (entry.type === 'floating' && (entry.reference ?? '').toLowerCase() === 'custom') {
        if (entry.rate == null) return null
        return entry.rate + (entry.spread ?? 0)
    }
    return effectiveRate(entry, sora).rate ?? null
}

function getEffectiveRate(
    year: number,
    schedule: RateScheduleEntry[],
    sora: SoraRates | null
): number | null {
    const yearEntry = schedule.find(e => e.year === year)
    if (yearEntry) return resolveEntry(yearEntry, sora)
    const thereafter = schedule.find(e => e.thereafter)
    if (thereafter) return resolveEntry(thereafter, sora)
    return null
}

interface AmortRow {
    year: number
    rate: number | null
    instalment: number | null
    monthPrincipal: number | null
    monthInterest: number | null
    yearPrincipal: number | null
    yearInterest: number | null
    balance: number | null
    cumulativeInterest: number | null
}

function computeAmortization(
    loanAmount: number,
    tenure: number,
    schedule: RateScheduleEntry[],
    sora: SoraRates | null
): AmortRow[] {
    if (!loanAmount || loanAmount <= 0 || !tenure || tenure <= 0) return []
    const rows: AmortRow[] = []
    let balance = loanAmount
    let cumulativeInterest = 0

    for (let year = 1; year <= tenure; year++) {
        const rate = getEffectiveRate(year, schedule, sora)

        if (rate === null || balance <= 0) {
            rows.push({
                year, rate: null, instalment: null,
                monthPrincipal: null, monthInterest: null,
                yearPrincipal: null, yearInterest: null,
                balance: null, cumulativeInterest: null,
            })
            continue
        }

        const remainingTenure = tenure - year + 1
        const inst = monthlyInstallment(balance, rate, remainingTenure)
        const r = rate / 100 / 12

        let yearPrincipal = 0
        let yearInterest = 0
        let lastPrincipal = 0
        let lastInterest = 0

        for (let m = 1; m <= 12; m++) {
            const interest = balance * r
            const principal = Math.min(inst - interest, balance)
            yearPrincipal += principal
            yearInterest += interest
            balance = Math.max(balance - principal, 0)
            if (m === 12) { lastPrincipal = principal; lastInterest = interest }
        }

        cumulativeInterest += yearInterest
        rows.push({
            year, rate, instalment: inst,
            monthPrincipal: lastPrincipal,
            monthInterest: lastInterest,
            yearPrincipal,
            yearInterest,
            balance: Math.max(balance, 0),
            cumulativeInterest,
        })
    }
    return rows
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null): string {
    if (n == null) return '—'
    return n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const inp = 'px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/10 bg-white transition-colors'

// ── Component ─────────────────────────────────────────────────────────────────

const DEFAULT_SCHEDULE: RateScheduleEntry[] = [
    { year: 1, type: 'fixed', rate: undefined },
    { thereafter: true, type: 'floating', reference: '3M SORA', spread: 1.00 },
]

export default function AmortizationPage() {
    const [loanAmount, setLoanAmount] = useState('300000')
    const [tenure, setTenure] = useState('25')
    const [lockInInput, setLockInInput] = useState('')
    const [compareTenure, setCompareTenure] = useState('')
    const [schedule, setSchedule] = useState<RateScheduleEntry[]>(DEFAULT_SCHEDULE)
    const [sora, setSora] = useState<SoraRates | null>(null)

    useEffect(() => {
        fetch('/api/insurance/rates')
            .then(r => r.json())
            .then(d => { if (d.sora) setSora(d.sora) })
            .catch(() => {})
    }, [])

    const loan = parseFloat(loanAmount.replace(/,/g, '')) || 0
    const tenRaw = parseInt(tenure)
    const ten = isNaN(tenRaw) ? 0 : Math.min(Math.max(tenRaw, 5), 35)
    const compareTenRaw = parseInt(compareTenure)
    const compareTen = isNaN(compareTenRaw) ? 0 : Math.min(Math.max(compareTenRaw, 5), 35)

    const rows = useMemo(
        () => computeAmortization(loan, ten, schedule, sora),
        [loan, ten, schedule, sora]
    )
    const compareRows = useMemo(
        () => compareTen > 0 && compareTen !== ten ? computeAmortization(loan, compareTen, schedule, sora) : [],
        [loan, compareTen, ten, schedule, sora]
    )

    const lockInRaw = parseInt(lockInInput)
    const lockInYears = isNaN(lockInRaw) || lockInRaw < 0 ? 0 : lockInRaw
    const lockInCards = Array.from({ length: lockInYears }, (_, i) => {
        const yr = i + 1
        return { year: yr, value: rows.find(r => r.year === yr)?.cumulativeInterest ?? null }
    })
    const validRows = rows.filter(r => r.cumulativeInterest != null)
    const totalPrincipal = validRows.reduce((s, r) => s + (r.yearPrincipal ?? 0), 0)
    const totalInterest = validRows.at(-1)?.cumulativeInterest ?? null
    const compareTotalInterest = compareRows.filter(r => r.cumulativeInterest != null).at(-1)?.cumulativeInterest ?? null

    // Tenure comparison values
    const primaryInstalment = rows[0]?.instalment ?? null
    const primaryLockInInterest = lockInYears > 0 ? (rows.find(r => r.year === lockInYears)?.cumulativeInterest ?? null) : null
    const compareInstalment = compareRows[0]?.instalment ?? null
    const compareLockInInterest = lockInYears > 0 ? (compareRows.find(r => r.year === lockInYears)?.cumulativeInterest ?? null) : null
    const primaryTotalInstalment = primaryInstalment != null && lockInYears > 0 ? primaryInstalment * lockInYears * 12 : null
    const compareTotalInstalment = compareInstalment != null && lockInYears > 0 ? compareInstalment * lockInYears * 12 : null
    const primaryOutstanding = lockInYears > 0 ? (rows.find(r => r.year === lockInYears)?.balance ?? null) : null
    const compareOutstanding = lockInYears > 0 ? (compareRows.find(r => r.year === lockInYears)?.balance ?? null) : null
    const showComparison = compareTen > 0 && compareTen !== ten && compareRows.length > 0

    function updateRow(idx: number, patch: Partial<RateScheduleEntry>) {
        setSchedule(s => s.map((e, i) => i === idx ? { ...e, ...patch } : e))
    }

    function addYear() {
        setSchedule(s => {
            const maxYear = Math.max(0, ...s.filter(e => e.year != null).map(e => e.year!))
            const thereafterIdx = s.findIndex(e => e.thereafter)
            const newEntry: RateScheduleEntry = { year: maxYear + 1, type: 'fixed' }
            if (thereafterIdx >= 0) {
                const next = [...s]
                next.splice(thereafterIdx, 0, newEntry)
                return next
            }
            return [...s, newEntry]
        })
    }

    function addThereafter() {
        if (schedule.some(e => e.thereafter)) return
        setSchedule(s => [...s, { thereafter: true, type: 'floating' }])
    }

    function removeRow(idx: number) {
        setSchedule(s => s.length > 1 ? s.filter((_, i) => i !== idx) : s)
    }

    const hasThereafter = schedule.some(e => e.thereafter)
    const comp3m = sora?.comp_sora_3m
    const comp1m = sora?.comp_sora_1m

    return (
        <div className="max-w-6xl mx-auto space-y-6">

            {/* ── Header ── */}
            <div>
                <Link
                    href="/insurance/dashboard/calculators"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-600 mb-3 transition-colors"
                >
                    <ArrowLeft size={13} /> Calculators
                </Link>
                <h1 className="ios-page-title flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-sky-100 flex items-center justify-center shrink-0">
                        <Calculator size={18} className="text-[#03a9e7]" />
                    </span>
                    Amortization Calculator
                </h1>
                <p className="page-subtitle mt-1">Year-by-year breakdown with variable rates per period.</p>
            </div>

            {/* ── Top section: 3-col grid ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

                {/* ── Inputs (span 2) ── */}
                <div className="lg:col-span-2 card overflow-hidden">

                    {/* Card header */}
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4 flex-wrap">
                        <h3 className="section-label mb-0">Loan Details</h3>
                        {(comp3m != null || comp1m != null) && (
                            <div className="flex items-center gap-3">
                                {comp3m != null && (
                                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-3.5 py-2 rounded-xl">
                                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                                        <div>
                                            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider leading-none mb-0.5">3M SORA</p>
                                            <p className="text-base font-black text-emerald-700 leading-none">{comp3m.toFixed(4)}%</p>
                                        </div>
                                    </div>
                                )}
                                {comp1m != null && (
                                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-3.5 py-2 rounded-xl">
                                        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                                        <div>
                                            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider leading-none mb-0.5">1M SORA</p>
                                            <p className="text-base font-black text-emerald-700 leading-none">{comp1m.toFixed(4)}%</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="p-6 space-y-6">
                        {/* Row 1: Loan amount + Tenure + Compare */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                    Loan Amount
                                </label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">$</span>
                                    <input
                                        type="text"
                                        value={loanAmount}
                                        onChange={e => setLoanAmount(e.target.value)}
                                        className={`${inp} pl-7 w-full`}
                                        placeholder="300,000"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                        Tenure (Yrs)
                                    </label>
                                    <input
                                        type="number"
                                        value={tenure}
                                        onChange={e => setTenure(e.target.value)}
                                        onBlur={e => {
                                            const v = parseInt(e.target.value)
                                            if (isNaN(v) || v < 5) setTenure('5')
                                            else if (v > 35) setTenure('35')
                                        }}
                                        className={`${inp} w-full`}
                                        placeholder="25"
                                        min={5}
                                        max={35}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                                        Compare (Yrs)
                                    </label>
                                    <input
                                        type="number"
                                        value={compareTenure}
                                        onChange={e => setCompareTenure(e.target.value)}
                                        onBlur={e => {
                                            const v = parseInt(e.target.value)
                                            if (!isNaN(v)) {
                                                if (v < 5) setCompareTenure('5')
                                                else if (v > 35) setCompareTenure('35')
                                            }
                                        }}
                                        className={`${inp} w-full border-dashed`}
                                        placeholder="15"
                                        min={5}
                                        max={35}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Row 2: Lock-in */}
                        <div className="max-w-xs">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                Lock-in Period (Yrs)
                            </label>
                            <input
                                type="number"
                                value={lockInInput}
                                onChange={e => setLockInInput(e.target.value)}
                                onBlur={e => {
                                    const v = parseInt(e.target.value)
                                    if (!isNaN(v) && v < 0) setLockInInput('0')
                                }}
                                className={`${inp} w-full`}
                                placeholder="e.g. 3"
                                min={0}
                            />
                        </div>

                        {/* Rate schedule */}
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    Interest Rates (p.a.)
                                </span>
                                {lockInYears > 0 && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#03a9e7] bg-sky-50 border border-sky-100 px-2 py-0.5 rounded-full">
                                        <Lock size={9} /> {lockInYears}-yr lock-in
                                    </span>
                                )}
                            </div>

                            <div className="rounded-xl border border-slate-100 overflow-hidden">
                                {/* Lock-in rows */}
                                {schedule.filter(e => !e.thereafter).map((entry, idx) => (
                                    <RateRow
                                        key={idx}
                                        entry={entry}
                                        label={`Year ${entry.year}`}
                                        isLockin
                                        onChange={patch => updateRow(schedule.indexOf(entry), patch)}
                                        onRemove={() => removeRow(schedule.indexOf(entry))}
                                        canRemove={schedule.length > 1}
                                        soraRefs={AMORT_RATE_REFS}
                                        refId={`refs-${idx}`}
                                        inp={inp}
                                    />
                                ))}

                                {/* Separator before thereafter */}
                                {hasThereafter && (
                                    <div className="flex items-center gap-3 px-4 py-1.5 bg-slate-50 border-t border-b border-slate-100">
                                        <div className="flex-1 h-px bg-slate-200" />
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Out of lock-in</span>
                                        <div className="flex-1 h-px bg-slate-200" />
                                    </div>
                                )}

                                {/* Thereafter row */}
                                {schedule.filter(e => e.thereafter).map((entry, idx) => (
                                    <RateRow
                                        key={`thereafter-${idx}`}
                                        entry={entry}
                                        label="Thereafter"
                                        isLockin={false}
                                        onChange={patch => updateRow(schedule.indexOf(entry), patch)}
                                        onRemove={() => removeRow(schedule.indexOf(entry))}
                                        canRemove={schedule.length > 1}
                                        soraRefs={AMORT_RATE_REFS}
                                        refId={`refs-thereafter-${idx}`}
                                        inp={inp}
                                    />
                                ))}
                            </div>

                            <div className="flex gap-2 mt-3">
                                <button
                                    type="button"
                                    onClick={addYear}
                                    className="flex items-center gap-1.5 text-xs font-semibold text-[#03a9e7] hover:bg-sky-50 px-3 py-1.5 rounded-lg transition-colors"
                                >
                                    <Plus size={13} /> Add Year
                                </button>
                                {!hasThereafter && (
                                    <button
                                        type="button"
                                        onClick={addThereafter}
                                        className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-colors"
                                    >
                                        <Plus size={13} /> Add Thereafter
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Summary cards (span 1) ── */}
                <div className="flex flex-col gap-3">
                    {lockInCards.length === 0 && (
                        <div className="card p-5 text-center">
                            <p className="text-xs text-slate-400">Enter rates to see interest summary.</p>
                        </div>
                    )}

                    {lockInCards.map(({ year, value }, i) => {
                        const isLast = i === lockInCards.length - 1
                        if (isLast) {
                            return (
                                <div
                                    key={year}
                                    className="card overflow-hidden"
                                    style={{
                                        background: 'linear-gradient(135deg, #052d4a 0%, #0a4a7a 100%)',
                                        border: 'none',
                                    }}
                                >
                                    <div className="p-5">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <p className="text-[11px] font-semibold text-sky-300 uppercase tracking-wider">
                                                    Total Interest · Year {year}
                                                </p>
                                                <p className="text-3xl font-black text-white mt-1.5 tracking-tight">
                                                    {value != null ? `$${fmt(value)}` : '—'}
                                                </p>
                                            </div>
                                            <span className="text-[10px] font-bold text-white/60 bg-white/10 px-2 py-0.5 rounded-full mt-0.5">
                                                Lock-in end
                                            </span>
                                        </div>
                                        <p className="text-xs text-sky-200/70 mt-3">
                                            Cumulative interest paid over {year} year{year > 1 ? 's' : ''}
                                        </p>
                                    </div>
                                </div>
                            )
                        }
                        return (
                            <div key={year} className="card p-4 flex items-center justify-between">
                                <div>
                                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                                        Interest · Year {year}
                                    </p>
                                    <p className={`text-xl font-bold mt-0.5 ${value != null ? 'text-[#052d4a]' : 'text-slate-200'}`}>
                                        {value != null ? `$${fmt(value)}` : '—'}
                                    </p>
                                </div>
                                <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center shrink-0">
                                    <span className="text-xs font-bold text-[#03a9e7]">Y{year}</span>
                                </div>
                            </div>
                        )
                    })}

                    {totalInterest != null && (
                        <div className="card p-4 border-dashed">
                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                                Total Interest · Full Tenure
                            </p>
                            <p className="text-xl font-bold text-slate-600 mt-0.5">${fmt(totalInterest)}</p>
                            <p className="text-[11px] text-slate-400 mt-1">Over {ten} years</p>
                        </div>
                    )}
                    {showComparison && compareTotalInterest != null && (
                        <div className="card p-4 border-dashed border-slate-300">
                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                                Total Interest · Full Tenure
                            </p>
                            <p className="text-xl font-bold text-slate-600 mt-0.5">${fmt(compareTotalInterest)}</p>
                            <p className="text-[11px] text-slate-400 mt-1">Over {compareTen} years</p>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Tenure comparison ── */}
            {showComparison && (() => {
                const dc = (diff: number) => diff > 0 ? 'text-red-500' : diff < 0 ? 'text-emerald-600' : 'text-slate-400'
                const ds = (diff: number) => diff > 0 ? '+' : '−'
                return (
                    <div className="card overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100">
                            <h3 className="section-label mb-0">Tenure Comparison</h3>
                            {lockInYears === 0 && (
                                <p className="text-xs text-slate-400 mt-1">Add lock-in years to compare interest over the lock-in period.</p>
                            )}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200">
                                        <th className="px-6 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Tenure (Years)</th>
                                        <th className="px-6 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">Monthly Instalment</th>
                                        {lockInYears > 0 && (<>
                                            <th className="px-6 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                                Total Instalment<br />
                                                <span className="text-slate-400 font-normal normal-case tracking-normal">Paid over {lockInYears} yr{lockInYears > 1 ? 's' : ''}</span>
                                            </th>
                                            <th className="px-6 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                                Outstanding Loan<br />
                                                <span className="text-slate-400 font-normal normal-case tracking-normal">After {lockInYears} yr{lockInYears > 1 ? 's' : ''}</span>
                                            </th>
                                            <th className="px-6 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                                Total Interest<br />
                                                <span className="text-slate-400 font-normal normal-case tracking-normal">Paid over {lockInYears} yr{lockInYears > 1 ? 's' : ''}</span>
                                            </th>
                                        </>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {/* Primary tenure row */}
                                    <tr className="border-b border-slate-100 bg-sky-50/30">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <span className="w-1.5 h-5 rounded-full bg-[#03a9e7] shrink-0" />
                                                <span className="font-bold text-[#052d4a]">{ten}</span>
                                                <span className="text-xs text-slate-400 font-medium">yrs</span>
                                                <span className="text-[10px] font-bold text-[#03a9e7] bg-sky-100 px-1.5 py-0.5 rounded-full">Primary</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right font-bold text-[#052d4a] text-base">
                                            {primaryInstalment != null ? `$${fmt(primaryInstalment)}` : '—'}
                                        </td>
                                        {lockInYears > 0 && (<>
                                            <td className="px-6 py-4 text-right font-bold text-[#052d4a] text-base">
                                                {primaryTotalInstalment != null ? `$${fmt(primaryTotalInstalment)}` : '—'}
                                            </td>
                                            <td className="px-6 py-4 text-right font-bold text-[#052d4a] text-base">
                                                {primaryOutstanding != null ? `$${fmt(primaryOutstanding)}` : '—'}
                                            </td>
                                            <td className="px-6 py-4 text-right font-bold text-[#052d4a] text-base">
                                                {primaryLockInInterest != null ? `$${fmt(primaryLockInInterest)}` : '—'}
                                            </td>
                                        </>)}
                                    </tr>

                                    {/* Comparison tenure row */}
                                    <tr className="border-b border-slate-100">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <span className="w-1.5 h-5 rounded-full bg-slate-300 shrink-0" />
                                                <span className="font-bold text-slate-700">{compareTen}</span>
                                                <span className="text-xs text-slate-400 font-medium">yrs</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right font-semibold text-slate-700 text-base">
                                            {compareInstalment != null ? `$${fmt(compareInstalment)}` : '—'}
                                        </td>
                                        {lockInYears > 0 && (<>
                                            <td className="px-6 py-4 text-right font-semibold text-slate-700 text-base">
                                                {compareTotalInstalment != null ? `$${fmt(compareTotalInstalment)}` : '—'}
                                            </td>
                                            <td className="px-6 py-4 text-right font-semibold text-slate-700 text-base">
                                                {compareOutstanding != null ? `$${fmt(compareOutstanding)}` : '—'}
                                            </td>
                                            <td className="px-6 py-4 text-right font-semibold text-slate-700 text-base">
                                                {compareLockInInterest != null ? `$${fmt(compareLockInInterest)}` : '—'}
                                            </td>
                                        </>)}
                                    </tr>

                                    {/* Difference row */}
                                    {primaryInstalment != null && compareInstalment != null && (
                                        <tr className="bg-slate-50/60 border-t-2 border-slate-200">
                                            <td className="px-6 py-3">
                                                <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Difference</span>
                                            </td>
                                            <td className="px-6 py-3 text-right">
                                                {(() => {
                                                    const diff = compareInstalment - primaryInstalment
                                                    return (
                                                        <span className={`font-bold ${dc(diff)}`}>
                                                            {ds(diff)}${fmt(Math.abs(diff))}<span className="text-[11px] font-medium ml-1">/mth</span>
                                                        </span>
                                                    )
                                                })()}
                                            </td>
                                            {lockInYears > 0 && (<>
                                                <td className="px-6 py-3 text-right">
                                                    {primaryTotalInstalment != null && compareTotalInstalment != null && (() => {
                                                        const diff = compareTotalInstalment - primaryTotalInstalment
                                                        return (
                                                            <span className={`font-bold ${dc(diff)}`}>
                                                                {ds(diff)}${fmt(Math.abs(diff))}
                                                            </span>
                                                        )
                                                    })()}
                                                </td>
                                                <td className="px-6 py-3 text-right">
                                                    {primaryOutstanding != null && compareOutstanding != null && (() => {
                                                        const diff = compareOutstanding - primaryOutstanding
                                                        return (
                                                            <span className={`font-bold ${dc(diff)}`}>
                                                                {ds(diff)}${fmt(Math.abs(diff))}
                                                            </span>
                                                        )
                                                    })()}
                                                </td>
                                                <td className="px-6 py-3 text-right">
                                                    {primaryLockInInterest != null && compareLockInInterest != null && (() => {
                                                        const diff = compareLockInInterest - primaryLockInInterest
                                                        return (
                                                            <span className={`font-bold ${dc(diff)}`}>
                                                                {ds(diff)}${fmt(Math.abs(diff))}
                                                            </span>
                                                        )
                                                    })()}
                                                </td>
                                            </>)}
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            })()}

            {/* ── Amortization table ── */}
            {rows.length > 0 && (
                <div className="card overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="section-label mb-0">Year-by-Year Breakdown</h3>
                        <span className="text-[11px] text-slate-400">
                            Figures show last month of each year
                        </span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider w-14">Yr</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Rate</th>
                                    <th className="px-4 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">Mthly Instalment</th>
                                    <th className="px-4 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">Principal /mth</th>
                                    <th className="px-4 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">Interest /mth</th>
                                    <th className="px-4 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">Principal (yr)</th>
                                    <th className="px-4 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">Interest (yr)</th>
                                    <th className="px-4 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, i) => {
                                    const hasData = row.instalment != null
                                    const isLockinRow = row.year <= lockInYears
                                    const isLastLockin = row.year === lockInYears && lockInYears > 0
                                    const isFirstOol = row.year === lockInYears + 1 && lockInYears > 0

                                    return [
                                        isFirstOol && (
                                            <tr key={`sep-${row.year}`}>
                                                <td colSpan={8} className="px-4 py-1.5 bg-slate-50 border-t border-b border-slate-100">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex-1 h-px bg-slate-200" />
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                                            Out of lock-in
                                                        </span>
                                                        <div className="flex-1 h-px bg-slate-200" />
                                                    </div>
                                                </td>
                                            </tr>
                                        ),
                                        <tr
                                            key={row.year}
                                            className={`border-b transition-colors ${
                                                isLockinRow
                                                    ? 'border-sky-50 bg-sky-50/30 hover:bg-sky-50/60'
                                                    : i % 2 === 0
                                                        ? 'border-slate-50 hover:bg-slate-50/60'
                                                        : 'border-slate-50 bg-slate-50/40 hover:bg-slate-50/80'
                                            }`}
                                        >
                                            <td className="py-3 pl-0 pr-4">
                                                <div className={`flex items-center gap-0 h-full`}>
                                                    <div className={`w-1 self-stretch rounded-r mr-3 ${isLockinRow ? 'bg-[#03a9e7]' : 'bg-transparent'}`} />
                                                    <span className={`font-bold ${isLockinRow ? 'text-[#03a9e7]' : 'text-slate-400'}`}>
                                                        {row.year}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                {hasData ? (
                                                    <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${
                                                        isLockinRow
                                                            ? 'bg-sky-100 text-[#03a9e7]'
                                                            : 'bg-slate-100 text-slate-500'
                                                    }`}>
                                                        {row.rate!.toFixed(2)}%
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-200 text-xs">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right font-semibold text-slate-700">
                                                {hasData ? `$${fmt(row.instalment)}` : <span className="text-slate-200 text-xs">—</span>}
                                            </td>
                                            <td className="px-4 py-3 text-right text-slate-600">
                                                {hasData ? `$${fmt(row.monthPrincipal)}` : <span className="text-slate-200 text-xs">—</span>}
                                            </td>
                                            <td className="px-4 py-3 text-right text-slate-600">
                                                {hasData ? `$${fmt(row.monthInterest)}` : <span className="text-slate-200 text-xs">—</span>}
                                            </td>
                                            <td className="px-4 py-3 text-right text-slate-600">
                                                {hasData ? `$${fmt(row.yearPrincipal)}` : <span className="text-slate-200 text-xs">—</span>}
                                            </td>
                                            <td className="px-4 py-3 text-right text-slate-600">
                                                {hasData ? `$${fmt(row.yearInterest)}` : <span className="text-slate-200 text-xs">—</span>}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {hasData ? (
                                                    isLastLockin ? (
                                                        <span className="inline-block font-black text-[#052d4a] bg-sky-100 border border-sky-200 px-2.5 py-0.5 rounded-full text-sm">
                                                            ${fmt(row.balance)}
                                                        </span>
                                                    ) : (
                                                        <span className="font-semibold text-slate-700">${fmt(row.balance)}</span>
                                                    )
                                                ) : <span className="text-slate-200 text-xs">—</span>}
                                            </td>
                                        </tr>,
                                    ]
                                })}

                                {/* Totals row */}
                                <tr className="bg-slate-50 border-t-2 border-slate-200">
                                    <td className="px-4 py-3 text-xs font-black text-slate-600 uppercase tracking-wider" colSpan={2}>
                                        Total
                                    </td>
                                    <td className="px-4 py-3" />
                                    <td className="px-4 py-3" />
                                    <td className="px-4 py-3" />
                                    <td className="px-4 py-3 text-right font-bold text-slate-700">
                                        {totalPrincipal > 0 ? `$${fmt(totalPrincipal)}` : ''}
                                    </td>
                                    <td className="px-4 py-3 text-right font-bold text-slate-700">
                                        {totalInterest != null ? `$${fmt(totalInterest)}` : ''}
                                    </td>
                                    <td className="px-4 py-3" />
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}

// ── Rate row sub-component ────────────────────────────────────────────────────

function RateRow({
    entry, label, isLockin, onChange, onRemove, canRemove, soraRefs, refId, inp,
}: {
    entry: RateScheduleEntry
    label: string
    isLockin: boolean
    onChange: (patch: Partial<RateScheduleEntry>) => void
    onRemove: () => void
    canRemove: boolean
    soraRefs: readonly string[]
    refId: string
    inp: string
}) {
    return (
        <div className={`flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0 ${
            isLockin ? 'bg-white' : 'bg-slate-50/60'
        }`}>
            {/* Left border indicator */}
            <div className={`w-1 h-8 rounded-full shrink-0 ${isLockin ? 'bg-[#03a9e7]' : 'bg-slate-200'}`} />

            {/* Year label */}
            <span className={`w-20 shrink-0 text-xs font-bold ${isLockin ? 'text-[#052d4a]' : 'text-slate-400'}`}>
                {label}
            </span>

            {/* Fixed / Floating toggle — lock-in rows only; thereafter is always floating */}
            {isLockin && (
                <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs shrink-0">
                    {(['fixed', 'floating'] as const).map(t => (
                        <button
                            key={t}
                            type="button"
                            onClick={() => onChange(
                                t === 'floating'
                                    ? { type: 'floating', reference: '3M SORA', spread: entry.spread ?? 1.00 }
                                    : { type: 'fixed' }
                            )}
                            className={`px-3 py-1.5 font-semibold capitalize transition-colors ${
                                entry.type === t
                                    ? 'bg-[#052d4a] text-white'
                                    : 'bg-white text-slate-500 hover:bg-slate-50'
                            }`}
                        >
                            {t}
                        </button>
                    ))}
                </div>
            )}

            {/* Rate input */}
            {isLockin && entry.type === 'fixed' ? (
                <div className="flex items-center gap-1.5 flex-1">
                    <input
                        type="number"
                        step="0.01"
                        value={entry.rate ?? ''}
                        onChange={e => onChange({ rate: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                        placeholder="2.00"
                        className={`${inp} w-24`}
                    />
                    <span className="text-xs font-medium text-slate-400">%</span>
                </div>
            ) : (
                <div className="flex items-center gap-1.5 flex-1 flex-wrap">
                    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs shrink-0">
                        {soraRefs.map(r => (
                            <button key={r} type="button"
                                onClick={() => onChange(r !== 'Custom' ? { reference: r, rate: undefined } : { reference: r })}
                                className={`px-2.5 py-1.5 font-semibold transition-colors ${(entry.reference ?? '3M SORA') === r ? 'bg-[#052d4a] text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                                {r}
                            </button>
                        ))}
                    </div>
                    {entry.reference === 'Custom' && (
                        <>
                            <input
                                type="number"
                                step="0.01"
                                value={entry.rate ?? ''}
                                onChange={e => onChange({ rate: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                                placeholder="0.50"
                                className={`${inp} w-20`}
                            />
                            <span className="text-xs font-medium text-slate-400">%</span>
                        </>
                    )}
                    <span className="text-xs font-medium text-slate-400">+</span>
                    <input
                        type="number"
                        step="0.01"
                        value={entry.spread ?? ''}
                        onChange={e => onChange({ spread: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                        placeholder="1.00"
                        className={`${inp} w-20`}
                    />
                    <span className="text-xs font-medium text-slate-400">%</span>
                </div>
            )}

            {/* Delete */}
            {canRemove && (
                <button
                    type="button"
                    onClick={onRemove}
                    className="ml-auto p-1.5 text-slate-300 hover:text-red-400 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                >
                    <Trash2 size={13} />
                </button>
            )}
        </div>
    )
}
