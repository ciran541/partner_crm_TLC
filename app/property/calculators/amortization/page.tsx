'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, Calculator, Lock, Copy, X } from 'lucide-react'
import { formatMoneyInput } from '@/lib/utils/formatCurrency'
import { type RateScheduleEntry } from '@/lib/types/rates'
import type { SoraRates } from '@/lib/insurance/sora'
import { computeAmortization, type AmortRow } from '@/lib/insurance/amortCalc'
import PropertyPremiumGate from '@/components/property/PropertyPremiumGate'

// Premium-tier feature — property-branded port of
// app/insurance/dashboard/calculators/amortization/page.tsx. The two pages are
// kept identical apart from branding, the back link and this gate; the shared
// amortization math lives in lib/insurance/amortCalc.ts, which both import.

// FD Rate replaced with Custom: agent enters the bank's own base rate + spread
const AMORT_RATE_REFS = ['3M SORA', '1M SORA', 'Custom'] as const

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null): string {
    if (n == null) return '—'
    return n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const inp = 'px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#059669] focus:ring-2 focus:ring-[#059669]/10 bg-white transition-colors'

// ── Packages ──────────────────────────────────────────────────────────────────

/**
 * A package = one bank's offer: its own tenure, lock-in and year-by-year rates.
 * The loan amount is shared — it is the same loan being quoted either way.
 */
interface PackageConfig {
    id: string
    name: string
    tenure: string
    lockIn: string
    schedule: RateScheduleEntry[]
    /**
     * Optional second tenure for the SAME rates and lock-in - the same offer
     * quoted over, say, 12 and 25 years. It belongs to the package rather than
     * being a package of its own: agents compare tenures far more often than
     * they have three genuinely different bank offers open, and spending a
     * package slot on "Package A (copy)" made the comparison table read as
     * four banks when it was really two.
     */
    altTenure?: string
}

const MAX_PACKAGES = 3

/** Full literal class strings — Tailwind cannot see dynamically built names. */
const ACCENTS = [
    {
        dot: 'bg-[#059669]', text: 'text-[#059669]', chip: 'bg-emerald-100 text-[#059669]',
        tabOn: 'bg-[#052d4a] text-white border-[#052d4a]',
        rowBg: 'bg-emerald-50/30 hover:bg-emerald-50/60 border-emerald-50',
        pill: 'bg-emerald-100 text-[#059669]',
        balancePill: 'text-[#052d4a] bg-emerald-100 border-emerald-200',
        gradient: 'linear-gradient(135deg, #052d4a 0%, #0a4a7a 100%)',
        gradLabel: 'text-emerald-300', gradSub: 'text-emerald-200/70',
    },
    {
        dot: 'bg-violet-500', text: 'text-violet-600', chip: 'bg-violet-100 text-violet-600',
        tabOn: 'bg-violet-600 text-white border-violet-600',
        rowBg: 'bg-violet-50/30 hover:bg-violet-50/60 border-violet-50',
        pill: 'bg-violet-100 text-violet-600',
        balancePill: 'text-violet-800 bg-violet-100 border-violet-200',
        gradient: 'linear-gradient(135deg, #3b1a78 0%, #6d33c4 100%)',
        gradLabel: 'text-violet-200', gradSub: 'text-violet-100/70',
    },
    {
        dot: 'bg-amber-500', text: 'text-amber-600', chip: 'bg-amber-100 text-amber-700',
        tabOn: 'bg-amber-500 text-white border-amber-500',
        rowBg: 'bg-amber-50/30 hover:bg-amber-50/60 border-amber-50',
        pill: 'bg-amber-100 text-amber-700',
        balancePill: 'text-amber-800 bg-amber-100 border-amber-200',
        gradient: 'linear-gradient(135deg, #7a4106 0%, #c9750d 100%)',
        gradLabel: 'text-amber-200', gradSub: 'text-amber-100/70',
    },
]

const newSchedule = (): RateScheduleEntry[] => ([
    { year: 1, type: 'fixed', rate: undefined },
    { thereafter: true, type: 'floating', reference: '3M SORA', spread: 1.00 },
])

const letterFor = (i: number) => String.fromCharCode(65 + i) // A, B, C

/** A blank alt tenure means "not comparing tenures", not "a 0-year loan". */
const hasAlt = (p: PackageConfig) => (p.altTenure ?? '').trim() !== ''
const variantKey = (id: string, isAlt: boolean) => `${id}:${isAlt ? 'alt' : 'main'}`

let pkgSeq = 1
const nextPkgId = () => `pkg-${++pkgSeq}`

/** Everything derived from one package config at one of its tenures. */
interface PackageResult {
    key: string                     // unique per row: package + which tenure
    cfg: PackageConfig
    pkgIdx: number                  // colour and letter follow the package, not the row
    isAlt: boolean                  // this is the package's second tenure
    ten: number
    lockIn: number
    rows: AmortRow[]
    instalment: number | null       // year 1 monthly instalment
    lockInInterest: number | null   // cumulative interest to end of lock-in
    outstanding: number | null      // balance at end of lock-in
    totalInstalment: number | null  // instalments actually paid during lock-in
    totalInterest: number | null    // over full tenure
    totalPrincipal: number
}

function buildResult(
    cfg: PackageConfig,
    pkgIdx: number,
    isAlt: boolean,
    loan: number,
    sora: SoraRates | null,
): PackageResult {
    const tRaw = parseInt(isAlt ? (cfg.altTenure ?? '') : cfg.tenure)
    const ten = isNaN(tRaw) ? 0 : Math.min(Math.max(tRaw, 5), 35)
    const lRaw = parseInt(cfg.lockIn)
    const lockIn = isNaN(lRaw) || lRaw < 0 ? 0 : Math.min(lRaw, ten)

    const rows = computeAmortization(loan, ten, cfg.schedule, sora)
    const valid = rows.filter(r => r.cumulativeInterest != null)

    const lockRow = lockIn > 0 ? rows.find(r => r.year === lockIn) ?? null : null
    const lockRows = lockIn > 0 ? rows.filter(r => r.year <= lockIn) : []
    // Sum each lock-in year's own instalment — the rate (and so the instalment)
    // can change part-way through a lock-in, e.g. 1.40 / 1.40 / floating.
    const totalInstalment = lockRows.length > 0 && lockRows.every(r => r.instalment != null)
        ? lockRows.reduce((s, r) => s + (r.instalment ?? 0) * 12, 0)
        : null

    return {
        key: variantKey(cfg.id, isAlt),
        cfg, pkgIdx, isAlt, ten, lockIn, rows,
        instalment: rows[0]?.instalment ?? null,
        lockInInterest: lockRow?.cumulativeInterest ?? null,
        outstanding: lockRow?.balance ?? null,
        totalInstalment,
        totalInterest: valid.at(-1)?.cumulativeInterest ?? null,
        totalPrincipal: valid.reduce((s, r) => s + (r.yearPrincipal ?? 0), 0),
    }
}

// ── Component ─────────────────────────────────────────────────────────────────

function AmortizationCalculator() {
    const [loanAmount, setLoanAmount] = useState('300,000')
    const [packages, setPackages] = useState<PackageConfig[]>([
        { id: 'pkg-1', name: 'Package A', tenure: '25', lockIn: '', schedule: newSchedule() },
    ])
    const [activeId, setActiveId] = useState('pkg-1')
    // Which of the active package's two tenures the summary cards and the
    // year-by-year table are showing. Held per package id, so switching tabs
    // never silently moves another package to its alt tenure.
    const [altView, setAltView] = useState<Record<string, boolean>>({})
    const [sora, setSora] = useState<SoraRates | null>(null)

    useEffect(() => {
        fetch('/api/insurance/rates')
            .then(r => r.json())
            .then(d => { if (d.sora) setSora(d.sora) })
            .catch(() => {})
    }, [])

    const loan = parseFloat(loanAmount.replace(/,/g, '')) || 0

    const results = useMemo(
        () => packages.flatMap((p, i) => hasAlt(p)
            ? [buildResult(p, i, false, loan, sora), buildResult(p, i, true, loan, sora)]
            : [buildResult(p, i, false, loan, sora)]
        ),
        [packages, loan, sora]
    )

    const activeIdx = Math.max(0, packages.findIndex(p => p.id === activeId))
    const active = packages[activeIdx]
    const activeVariants = results.filter(r => r.cfg.id === active.id)
    const showAlt = !!altView[active.id] && hasAlt(active)
    const result = activeVariants.find(r => r.isAlt === showAlt) ?? activeVariants[0]
    const accent = ACCENTS[activeIdx % ACCENTS.length]

    /** Jump to a specific package AND tenure (comparison table row click). */
    function selectVariant(r: PackageResult) {
        setActiveId(r.cfg.id)
        setAltView(v => ({ ...v, [r.cfg.id]: r.isAlt }))
    }

    const { ten, lockIn: lockInYears, rows, totalInterest, totalPrincipal } = result

    const lockInCards = Array.from({ length: lockInYears }, (_, i) => {
        const yr = i + 1
        return { year: yr, value: rows.find(r => r.year === yr)?.cumulativeInterest ?? null }
    })

    const showComparison = results.length > 1
    const anyLockIn = results.some(r => r.lockIn > 0)
    const mixedLockIn = anyLockIn && new Set(results.map(r => r.lockIn)).size > 1

    // ── Package mutations ──
    function patchPackage(id: string, patch: Partial<PackageConfig>) {
        setPackages(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p))
    }

    function addPackage(clone: boolean) {
        if (packages.length >= MAX_PACKAGES) return
        const src = packages[activeIdx]
        const id = nextPkgId()
        setPackages(ps => [...ps, {
            id,
            name: clone ? `${src.name} (copy)` : `Package ${letterFor(ps.length)}`,
            tenure: src.tenure,
            lockIn: src.lockIn,
            altTenure: clone ? src.altTenure : undefined,
            schedule: clone ? src.schedule.map(e => ({ ...e })) : newSchedule(),
        }])
        setActiveId(id)
    }

    function removePackage(id: string) {
        if (packages.length <= 1) return
        const next = packages.filter(p => p.id !== id)
        setPackages(next)
        if (id === active.id) setActiveId(next[next.length - 1].id)
    }

    // ── Rate schedule mutations (always on the active package) ──
    function updateRow(idx: number, patch: Partial<RateScheduleEntry>) {
        patchPackage(active.id, {
            schedule: active.schedule.map((e, i) => i === idx ? { ...e, ...patch } : e),
        })
    }

    function addYear() {
        const s = active.schedule
        const maxYear = Math.max(0, ...s.filter(e => e.year != null).map(e => e.year!))
        const thereafterIdx = s.findIndex(e => e.thereafter)
        const newEntry: RateScheduleEntry = { year: maxYear + 1, type: 'fixed' }
        const next = [...s]
        if (thereafterIdx >= 0) next.splice(thereafterIdx, 0, newEntry)
        else next.push(newEntry)
        patchPackage(active.id, { schedule: next })
    }

    function addThereafter() {
        if (active.schedule.some(e => e.thereafter)) return
        patchPackage(active.id, {
            schedule: [...active.schedule, { thereafter: true, type: 'floating' }],
        })
    }

    function removeRow(idx: number) {
        if (active.schedule.length <= 1) return
        patchPackage(active.id, { schedule: active.schedule.filter((_, i) => i !== idx) })
    }

    const hasThereafter = active.schedule.some(e => e.thereafter)
    const comp3m = sora?.comp_sora_3m
    const comp1m = sora?.comp_sora_1m

    return (
        <div className="max-w-6xl mx-auto space-y-6">

            {/* ── Header ── */}
            <div>
                <Link
                    href="/property/calculators"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-600 mb-3 transition-colors"
                >
                    <ArrowLeft size={13} /> Calculators
                </Link>
                <h1 className="ios-page-title flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                        <Calculator size={18} className="text-[#059669]" />
                    </span>
                    Amortization Calculator
                </h1>
                <p className="page-subtitle mt-1">
                    Year-by-year breakdown with variable rates per period. Compare up to {MAX_PACKAGES} packages
                    on the same loan, each over two tenures.
                </p>
            </div>

            {/* ── Shared loan amount + live SORA ── */}
            <div className="card px-6 py-4 flex items-end justify-between gap-4 flex-wrap">
                <div className="w-full sm:w-72">
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                        Loan Amount
                    </label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">$</span>
                        <input
                            type="text"
                            value={loanAmount}
                            onChange={e => setLoanAmount(formatMoneyInput(e.target.value))}
                            className={`${inp} pl-7 w-full`}
                            placeholder="300,000"
                        />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1.5">Shared across all packages.</p>
                </div>
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

            {/* ── Package tabs ── */}
            <div className="flex items-center gap-2 flex-wrap">
                {packages.map((p, i) => {
                    const a = ACCENTS[i % ACCENTS.length]
                    const isActive = p.id === active.id
                    const mine = results.filter(x => x.cfg.id === p.id)
                    const r = mine[0]
                    return (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => setActiveId(p.id)}
                            className={`flex items-center gap-2 pl-3 pr-2.5 py-2 rounded-xl border text-sm font-semibold transition-colors ${
                                isActive ? a.tabOn : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                            }`}
                        >
                            <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-white/70' : a.dot}`} />
                            <span>{p.name || `Package ${letterFor(i)}`}</span>
                            <span className={`text-[11px] font-medium ${isActive ? 'text-white/60' : 'text-slate-400'}`}>
                                {mine.map(v => `${v.ten}y`).join(' / ')}
                                {r.lockIn > 0 ? ` · ${r.lockIn}y lock` : ''}
                            </span>
                            {packages.length > 1 && (
                                <span
                                    role="button"
                                    tabIndex={-1}
                                    onClick={e => { e.stopPropagation(); removePackage(p.id) }}
                                    className={`ml-0.5 p-0.5 rounded-md transition-colors ${
                                        isActive
                                            ? 'text-white/50 hover:text-white hover:bg-white/15'
                                            : 'text-slate-300 hover:text-red-400 hover:bg-red-50'
                                    }`}
                                >
                                    <X size={12} />
                                </span>
                            )}
                        </button>
                    )
                })}

                {packages.length < MAX_PACKAGES && (
                    <>
                        <button
                            type="button"
                            onClick={() => addPackage(false)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-slate-300 text-sm font-semibold text-slate-500 hover:text-[#059669] hover:border-[#059669] hover:bg-emerald-50/50 transition-colors"
                        >
                            <Plus size={14} /> Add Package
                        </button>
                        <button
                            type="button"
                            onClick={() => addPackage(true)}
                            title="Duplicate this package — a starting point for a similar offer"
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-slate-300 text-sm font-semibold text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
                        >
                            <Copy size={13} /> Duplicate
                        </button>
                    </>
                )}
            </div>

            {/* ── Top section: 3-col grid ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

                {/* ── Inputs (span 2) ── */}
                <div className="lg:col-span-2 card overflow-hidden">

                    {/* Card header — package name */}
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${accent.dot}`} />
                        <input
                            type="text"
                            value={active.name}
                            onChange={e => patchPackage(active.id, { name: e.target.value })}
                            placeholder={`Package ${letterFor(activeIdx)}`}
                            className="flex-1 min-w-0 text-sm font-bold text-[#052d4a] bg-transparent border border-transparent hover:border-slate-200 focus:border-[#059669] focus:ring-2 focus:ring-[#059669]/10 rounded-lg px-2 py-1 outline-none transition-colors"
                        />
                        {hasAlt(active) ? (
                            <div className="flex items-center gap-1 shrink-0 bg-slate-100 p-0.5 rounded-lg">
                                {activeVariants.map(v => (
                                    <button
                                        key={v.key}
                                        type="button"
                                        onClick={() => setAltView(s => ({ ...s, [active.id]: v.isAlt }))}
                                        title="Which tenure the summary and year-by-year table below show"
                                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${
                                            v.isAlt === showAlt
                                                ? 'bg-white text-[#059669] shadow-sm'
                                                : 'text-slate-400 hover:text-slate-600'
                                        }`}
                                    >
                                        {v.ten} yrs
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <span className="hidden sm:block text-[11px] text-slate-400 shrink-0">e.g. bank + package name</span>
                        )}
                    </div>

                    <div className="p-6 space-y-6">
                        {/* Row 1: Tenure + Lock-in + optional second tenure */}
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-2xl">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                    Tenure (Yrs)
                                </label>
                                <input
                                    type="number"
                                    value={active.tenure}
                                    onChange={e => patchPackage(active.id, { tenure: e.target.value })}
                                    onBlur={e => {
                                        const v = parseInt(e.target.value)
                                        if (isNaN(v) || v < 5) patchPackage(active.id, { tenure: '5' })
                                        else if (v > 35) patchPackage(active.id, { tenure: '35' })
                                    }}
                                    className={`${inp} w-full`}
                                    placeholder="25"
                                    min={5}
                                    max={35}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                    Lock-in Period (Yrs)
                                </label>
                                <input
                                    type="number"
                                    value={active.lockIn}
                                    onChange={e => patchPackage(active.id, { lockIn: e.target.value })}
                                    onBlur={e => {
                                        const v = parseInt(e.target.value)
                                        if (!isNaN(v) && v < 0) patchPackage(active.id, { lockIn: '0' })
                                    }}
                                    className={`${inp} w-full`}
                                    placeholder="e.g. 3"
                                    min={0}
                                />
                            </div>

                            {/* Second tenure - same rates, same lock-in, different term */}
                            {hasAlt(active) ? (
                                <div>
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                            Compare Tenure
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                patchPackage(active.id, { altTenure: undefined })
                                                setAltView(s => ({ ...s, [active.id]: false }))
                                            }}
                                            title="Stop comparing tenures"
                                            className="p-0.5 rounded-md text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                    <input
                                        type="number"
                                        value={active.altTenure ?? ''}
                                        onChange={e => patchPackage(active.id, { altTenure: e.target.value })}
                                        onBlur={e => {
                                            const v = parseInt(e.target.value)
                                            if (isNaN(v)) patchPackage(active.id, { altTenure: undefined })
                                            else if (v < 5) patchPackage(active.id, { altTenure: '5' })
                                            else if (v > 35) patchPackage(active.id, { altTenure: '35' })
                                        }}
                                        className={`${inp} w-full`}
                                        placeholder="e.g. 30"
                                        min={5}
                                        max={35}
                                    />
                                </div>
                            ) : (
                                <div className="flex items-end">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const t = parseInt(active.tenure)
                                            const suggested = isNaN(t) ? 30 : (t <= 30 ? t + 5 : t - 5)
                                            patchPackage(active.id, { altTenure: String(suggested) })
                                            setAltView(s => ({ ...s, [active.id]: true }))
                                        }}
                                        title="Run this package's rates over a second tenure"
                                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-dashed border-slate-300 text-xs font-semibold text-slate-500 hover:text-[#059669] hover:border-[#059669] hover:bg-emerald-50/50 transition-colors"
                                    >
                                        <Plus size={13} /> Compare Tenure
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Rate schedule */}
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    Interest Rates (p.a.)
                                </span>
                                {lockInYears > 0 && (
                                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${accent.chip}`}>
                                        <Lock size={9} /> {lockInYears}-yr lock-in
                                    </span>
                                )}
                            </div>

                            <div className="rounded-xl border border-slate-100 overflow-hidden">
                                {/* Lock-in rows */}
                                {active.schedule.filter(e => !e.thereafter).map((entry, idx) => (
                                    <RateRow
                                        key={idx}
                                        entry={entry}
                                        label={`Year ${entry.year}`}
                                        isLockin
                                        accentBar={accent.dot}
                                        onChange={patch => updateRow(active.schedule.indexOf(entry), patch)}
                                        onRemove={() => removeRow(active.schedule.indexOf(entry))}
                                        canRemove={active.schedule.length > 1}
                                        soraRefs={AMORT_RATE_REFS}
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
                                {active.schedule.filter(e => e.thereafter).map((entry, idx) => (
                                    <RateRow
                                        key={`thereafter-${idx}`}
                                        entry={entry}
                                        label="Thereafter"
                                        isLockin={false}
                                        accentBar={accent.dot}
                                        onChange={patch => updateRow(active.schedule.indexOf(entry), patch)}
                                        onRemove={() => removeRow(active.schedule.indexOf(entry))}
                                        canRemove={active.schedule.length > 1}
                                        soraRefs={AMORT_RATE_REFS}
                                        inp={inp}
                                    />
                                ))}
                            </div>

                            <div className="flex gap-2 mt-3">
                                <button
                                    type="button"
                                    onClick={addYear}
                                    className="flex items-center gap-1.5 text-xs font-semibold text-[#059669] hover:bg-emerald-50 px-3 py-1.5 rounded-lg transition-colors"
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

                {/* ── Summary cards (span 1) — active package ── */}
                <div className="flex flex-col gap-3">
                    {lockInCards.length === 0 && (
                        <div className="card p-5 text-center">
                            <p className="text-xs text-slate-400">Enter a lock-in period to see the interest summary.</p>
                        </div>
                    )}

                    {lockInCards.map(({ year, value }, i) => {
                        const isLast = i === lockInCards.length - 1
                        if (isLast) {
                            return (
                                <div
                                    key={year}
                                    className="card overflow-hidden"
                                    style={{ background: accent.gradient, border: 'none' }}
                                >
                                    <div className="p-5">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <p className={`text-[11px] font-semibold uppercase tracking-wider ${accent.gradLabel}`}>
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
                                        <p className={`text-xs mt-3 ${accent.gradSub}`}>
                                            {active.name}{hasAlt(active) ? ` · ${ten}-yr tenure` : ''} · cumulative interest over {year} year{year > 1 ? 's' : ''}
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
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${accent.pill}`}>
                                    <span className="text-xs font-bold">Y{year}</span>
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
                            <p className="text-[11px] text-slate-400 mt-1">{active.name} · over {ten} years</p>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Package comparison ── */}
            {showComparison && (() => {
                const base = results[0]
                const dc = (diff: number) => diff > 0 ? 'text-red-500' : diff < 0 ? 'text-emerald-600' : 'text-slate-400'
                const ds = (diff: number) => diff > 0 ? '+' : '−'
                const delta = (mine: number | null, theirs: number | null, suffix = '') => {
                    if (mine == null || theirs == null) return null
                    const diff = mine - theirs
                    if (Math.abs(diff) < 0.005) {
                        return <span className="block text-[11px] font-semibold text-slate-300 mt-0.5">same</span>
                    }
                    return (
                        <span className={`block text-[11px] font-bold mt-0.5 ${dc(diff)}`}>
                            {ds(diff)}${fmt(Math.abs(diff))}{suffix}
                        </span>
                    )
                }
                return (
                    <div className="card overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100">
                            <h3 className="section-label mb-0">
                                {packages.length > 1 ? 'Package Comparison' : 'Tenure Comparison'}
                            </h3>
                            <p className="text-xs text-slate-400 mt-1">
                                Same ${fmt(loan)} loan · differences shown against {base.cfg.name} over {base.ten} yrs.
                                {!anyLockIn && ' Add a lock-in period to compare cost over the lock-in.'}
                                {mixedLockIn && ' Lock-in periods differ — each row is measured over its own lock-in.'}
                            </p>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200">
                                        <th className="px-6 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Package</th>
                                        <th className="px-6 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                            Monthly Instalment<br />
                                            <span className="text-slate-400 font-normal normal-case tracking-normal">Year 1</span>
                                        </th>
                                        {anyLockIn && (<>
                                            <th className="px-6 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                                Total Instalment<br />
                                                <span className="text-slate-400 font-normal normal-case tracking-normal">Paid over lock-in</span>
                                            </th>
                                            <th className="px-6 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                                Outstanding Loan<br />
                                                <span className="text-slate-400 font-normal normal-case tracking-normal">After lock-in</span>
                                            </th>
                                            <th className="px-6 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                                Total Interest<br />
                                                <span className="text-slate-400 font-normal normal-case tracking-normal">Over lock-in</span>
                                            </th>
                                        </>)}
                                        <th className="px-6 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                            Total Interest<br />
                                            <span className="text-slate-400 font-normal normal-case tracking-normal">Full tenure</span>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.map((r, i) => {
                                        const a = ACCENTS[r.pkgIdx % ACCENTS.length]
                                        const isBase = i === 0
                                        const isActive = r.key === result.key
                                        return (
                                            <tr
                                                key={r.key}
                                                onClick={() => selectVariant(r)}
                                                className={`border-b border-slate-100 cursor-pointer transition-colors ${
                                                    isActive ? a.rowBg : 'hover:bg-slate-50/60'
                                                }`}
                                            >
                                                <td className="px-6 py-4 align-top">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className={`w-1.5 h-5 rounded-full shrink-0 ${a.dot} ${r.isAlt ? 'opacity-40' : ''}`} />
                                                        <span className="font-bold text-[#052d4a]">
                                                            {r.cfg.name || `Package ${letterFor(r.pkgIdx)}`}
                                                        </span>
                                                        {hasAlt(r.cfg) && (
                                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${a.chip}`}>
                                                                {r.ten} yrs
                                                            </span>
                                                        )}
                                                        {isBase && (
                                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${a.chip}`}>Base</span>
                                                        )}
                                                    </div>
                                                    <p className="text-[11px] text-slate-400 mt-1 ml-3.5">
                                                        {r.ten} yrs{r.lockIn > 0 ? ` · ${r.lockIn}-yr lock-in` : ' · no lock-in'}
                                                    </p>
                                                </td>
                                                <td className="px-6 py-4 text-right align-top">
                                                    <span className="font-bold text-[#052d4a] text-base">
                                                        {r.instalment != null ? `$${fmt(r.instalment)}` : '—'}
                                                    </span>
                                                    {!isBase && delta(r.instalment, base.instalment, '/mth')}
                                                </td>
                                                {anyLockIn && (<>
                                                    <td className="px-6 py-4 text-right align-top">
                                                        <span className="font-bold text-[#052d4a] text-base">
                                                            {r.totalInstalment != null ? `$${fmt(r.totalInstalment)}` : '—'}
                                                        </span>
                                                        {!isBase && delta(r.totalInstalment, base.totalInstalment)}
                                                    </td>
                                                    <td className="px-6 py-4 text-right align-top">
                                                        <span className="font-bold text-[#052d4a] text-base">
                                                            {r.outstanding != null ? `$${fmt(r.outstanding)}` : '—'}
                                                        </span>
                                                        {!isBase && delta(r.outstanding, base.outstanding)}
                                                    </td>
                                                    <td className="px-6 py-4 text-right align-top">
                                                        <span className="font-bold text-[#052d4a] text-base">
                                                            {r.lockInInterest != null ? `$${fmt(r.lockInInterest)}` : '—'}
                                                        </span>
                                                        {!isBase && delta(r.lockInInterest, base.lockInInterest)}
                                                    </td>
                                                </>)}
                                                <td className="px-6 py-4 text-right align-top">
                                                    <span className="font-semibold text-slate-700 text-base">
                                                        {r.totalInterest != null ? `$${fmt(r.totalInterest)}` : '—'}
                                                    </span>
                                                    {!isBase && delta(r.totalInterest, base.totalInterest)}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            })()}

            {/* ── Amortization table (active package) ── */}
            {rows.length > 0 && (
                <div className="card overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                        <h3 className="section-label mb-0 flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${accent.dot}`} />
                            Year-by-Year Breakdown
                            <span className="text-slate-400 font-normal normal-case tracking-normal">
                                · {active.name}{hasAlt(active) ? ` · ${ten} yrs` : ''}
                            </span>
                        </h3>
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
                                                    ? accent.rowBg
                                                    : i % 2 === 0
                                                        ? 'border-slate-50 hover:bg-slate-50/60'
                                                        : 'border-slate-50 bg-slate-50/40 hover:bg-slate-50/80'
                                            }`}
                                        >
                                            <td className="py-3 pl-0 pr-4">
                                                <div className="flex items-center gap-0 h-full">
                                                    <div className={`w-1 self-stretch rounded-r mr-3 ${isLockinRow ? accent.dot : 'bg-transparent'}`} />
                                                    <span className={`font-bold ${isLockinRow ? accent.text : 'text-slate-400'}`}>
                                                        {row.year}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                {hasData ? (
                                                    <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${
                                                        isLockinRow ? accent.pill : 'bg-slate-100 text-slate-500'
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
                                                        <span className={`inline-block font-black border px-2.5 py-0.5 rounded-full text-sm ${accent.balancePill}`}>
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
    entry, label, isLockin, onChange, onRemove, canRemove, soraRefs, inp, accentBar,
}: {
    entry: RateScheduleEntry
    label: string
    isLockin: boolean
    onChange: (patch: Partial<RateScheduleEntry>) => void
    onRemove: () => void
    canRemove: boolean
    soraRefs: readonly string[]
    inp: string
    accentBar: string
}) {
    return (
        <div className={`flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0 ${
            isLockin ? 'bg-white' : 'bg-slate-50/60'
        }`}>
            {/* Left border indicator */}
            <div className={`w-1 h-8 rounded-full shrink-0 ${isLockin ? accentBar : 'bg-slate-200'}`} />

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

export default function PropertyAmortizationPage() {
    return (
        <PropertyPremiumGate>
            <AmortizationCalculator />
        </PropertyPremiumGate>
    )
}
