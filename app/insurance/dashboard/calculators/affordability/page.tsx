'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Users } from 'lucide-react'
import { monthlyInstallment, TDSR_LIMIT, MSR_LIMIT, NOA_FACTOR } from '@/lib/insurance/loanCalc'

// ── Engine ────────────────────────────────────────────────────────────────────

interface IncomeResult { monthly: number; annual: number }
interface AffordabilityResult {
    M: number
    private: { employed: IncomeResult; employedLiab: IncomeResult; self: IncomeResult; selfLiab: IncomeResult }
    hdb:     { employed: IncomeResult; employedLiab: IncomeResult; self: IncomeResult; selfLiab: IncomeResult }
}

function compute(
    loanAmount: number,
    stressRatePct: number,
    tenureYears: number,
    monthlyLiability: number,
): AffordabilityResult | null {
    if (!loanAmount || loanAmount <= 0 || !tenureYears || tenureYears <= 0) return null

    const M = monthlyInstallment(loanAmount, stressRatePct, tenureYears)
    const L = monthlyLiability || 0

    // ── Private Property: TDSR (55%) only ────────────────────────────────────
    // Employed: gross income = effective income (no haircut)
    const pEmp     = M / TDSR_LIMIT
    const pEmpL    = (M + L) / TDSR_LIMIT
    // Self-employed: effective income = annual × NOA_FACTOR / 12
    // → annual = (required effective) / NOA_FACTOR × 12
    const pSelfAnn  = (M / TDSR_LIMIT) / NOA_FACTOR * 12
    const pSelfLAnn = ((M + L) / TDSR_LIMIT) / NOA_FACTOR * 12

    // ── HDB/EC: binding = max(MSR 30%, TDSR 55%) ─────────────────────────────
    // For employed: gross monthly income needed
    const hEmp     = Math.max(M / MSR_LIMIT, M / TDSR_LIMIT)           // MSR always stricter when L=0
    const hEmpL    = Math.max(M / MSR_LIMIT, (M + L) / TDSR_LIMIT)
    // For self-employed: effective income needed → annual gross
    const hSelfEff  = Math.max(M / MSR_LIMIT, M / TDSR_LIMIT)
    const hSelfAnn  = hSelfEff / NOA_FACTOR * 12
    // MSR caps the mortgage instalment only (liability excluded), so the
    // NOA-haircutted MSR floor is unchanged when liability is present.
    const hSelfLAnn = hSelfAnn

    return {
        M,
        private: {
            employed:     { monthly: pEmp,          annual: pEmp * 12 },
            employedLiab: { monthly: pEmpL,         annual: pEmpL * 12 },
            self:         { monthly: pSelfAnn / 12, annual: pSelfAnn },
            selfLiab:     { monthly: pSelfLAnn / 12, annual: pSelfLAnn },
        },
        hdb: {
            employed:     { monthly: hEmp,          annual: hEmp * 12 },
            employedLiab: { monthly: hEmpL,         annual: hEmpL * 12 },
            self:         { monthly: hSelfAnn / 12, annual: hSelfAnn },
            selfLiab:     { monthly: hSelfLAnn / 12, annual: hSelfLAnn },
        },
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 0): string {
    return n.toLocaleString('en-SG', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    })
}

const inp = 'px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/10 bg-white transition-colors w-full'

// ── Sub-components ────────────────────────────────────────────────────────────

function IncomeTable({
    title,
    subtitle,
    accentColor,
    accentBg,
    data,
    hasLiability,
}: {
    title: string
    subtitle: string
    accentColor: string
    accentBg: string
    data: AffordabilityResult['private']
    hasLiability: boolean
}) {
    const cols = [
        { key: 'employed'     as const, label: 'Basic Pay',    sub: 'Employed'      },
        { key: 'employedLiab' as const, label: 'With Liability', sub: 'Employed'    },
        { key: 'self'         as const, label: 'Self-employed', sub: 'NOA income'   },
        { key: 'selfLiab'     as const, label: 'With Liability', sub: 'Self-employed' },
    ]

    return (
        <div className="card overflow-hidden">
            {/* Section header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3" style={{ background: accentBg }}>
                <div
                    className="w-1 h-8 rounded-full shrink-0"
                    style={{ background: accentColor }}
                />
                <div>
                    <p className="text-sm font-bold" style={{ color: accentColor }}>{title}</p>
                    <p className="text-[11px] text-slate-500">{subtitle}</p>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider w-28" />
                            {cols.map((c, i) => (
                                <th
                                    key={i}
                                    className={`px-5 py-3 text-center text-[11px] font-bold uppercase tracking-wider ${
                                        !hasLiability && (i === 1 || i === 3) ? 'opacity-30' : ''
                                    }`}
                                    style={{ color: i === 1 || i === 3 ? '#64748b' : accentColor }}
                                >
                                    <div>{c.label}</div>
                                    <div className="text-[10px] font-medium text-slate-400 normal-case tracking-normal mt-0.5">{c.sub}</div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {/* Monthly row */}
                        <tr className="border-b border-slate-100">
                            <td className="px-5 py-3.5 text-xs font-semibold text-slate-500 whitespace-nowrap">Monthly Income</td>
                            {cols.map((c, i) => (
                                <td
                                    key={i}
                                    className={`px-5 py-3.5 text-center font-semibold text-slate-700 ${
                                        !hasLiability && (i === 1 || i === 3) ? 'opacity-30' : ''
                                    }`}
                                >
                                    ${fmt(data[c.key].monthly)}
                                </td>
                            ))}
                        </tr>
                        {/* Annual row */}
                        <tr className="bg-slate-50/60">
                            <td className="px-5 py-3.5 text-xs font-semibold text-slate-500 whitespace-nowrap">Annual Income</td>
                            {cols.map((c, i) => (
                                <td
                                    key={i}
                                    className={`px-5 py-3.5 text-center font-black text-base ${
                                        !hasLiability && (i === 1 || i === 3) ? 'opacity-30 text-slate-400' : ''
                                    }`}
                                    style={hasLiability || (i !== 1 && i !== 3) ? { color: accentColor } : {}}
                                >
                                    ${fmt(data[c.key].annual)}
                                </td>
                            ))}
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AffordabilityPage() {
    const [loanAmount, setLoanAmount]       = useState('900000')
    const [stressRate, setStressRate]       = useState('4.00')
    const [tenure, setTenure]               = useState('30')
    const [liability, setLiability]         = useState('')

    const loan    = parseFloat(loanAmount.replace(/,/g, '')) || 0
    const stress  = parseFloat(stressRate) || 4
    const ten     = Math.min(Math.max(parseInt(tenure) || 0, 0), 35)
    const liab    = parseFloat(liability.replace(/,/g, '')) || 0
    const hasLiab = liab > 0

    const result = useMemo(
        () => compute(loan, stress, ten, liab),
        [loan, stress, ten, liab]
    )

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
                    <span className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                        <Users size={18} className="text-emerald-600" />
                    </span>
                    Reverse Affordability
                </h1>
                <p className="page-subtitle mt-1">Find the minimum income needed to qualify for a given loan.</p>
            </div>

            {/* ── Top: inputs + key output ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

                {/* Inputs */}
                <div className="lg:col-span-2 card overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100">
                        <h3 className="section-label mb-0">Loan Details</h3>
                    </div>
                    <div className="p-6">
                        <div className="grid grid-cols-2 gap-4">
                            {/* Loan Amount */}
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
                                        className={`${inp} pl-7`}
                                        placeholder="900,000"
                                    />
                                </div>
                            </div>

                            {/* Stress Test Rate */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                    Stress Test Rate
                                </label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={stressRate}
                                        onChange={e => setStressRate(e.target.value)}
                                        className={`${inp} pr-7`}
                                        placeholder="4.00"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">%</span>
                                </div>
                            </div>

                            {/* Tenure */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                    Tenure (Years)
                                </label>
                                <input
                                    type="number"
                                    value={tenure}
                                    onChange={e => setTenure(e.target.value)}
                                    className={inp}
                                    placeholder="30"
                                    min={1}
                                    max={35}
                                />
                            </div>

                            {/* Monthly Liability */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                    Monthly Liability
                                    <span className="ml-1.5 font-normal text-slate-400 normal-case tracking-normal">(optional)</span>
                                </label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">$</span>
                                    <input
                                        type="text"
                                        value={liability}
                                        onChange={e => setLiability(e.target.value)}
                                        className={`${inp} pl-7 border-dashed`}
                                        placeholder="e.g. 500 for car loan"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Key output */}
                <div className="flex flex-col gap-3">
                    {/* Stress-test installment */}
                    <div
                        className="card overflow-hidden"
                        style={{ background: 'linear-gradient(135deg, #052d4a 0%, #0a4a7a 100%)', border: 'none' }}
                    >
                        <div className="p-5">
                            <p className="text-[11px] font-semibold text-sky-300 uppercase tracking-wider">
                                Monthly Instalment
                            </p>
                            <p className="text-3xl font-black text-white mt-1.5 tracking-tight">
                                {result ? `$${fmt(result.M, 2)}` : '—'}
                            </p>
                            <p className="text-xs text-sky-200/70 mt-2">
                                At {stress}% stress-test rate · {ten} yrs
                            </p>
                        </div>
                    </div>

                    {/* Min income quick-view — private employed */}
                    {result && (
                        <div className="card p-4">
                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                                Min. Income (Private, Employed)
                            </p>
                            <p className="text-xl font-bold text-[#052d4a] mt-0.5">
                                ${fmt(result.private.employed.monthly)}<span className="text-sm font-medium text-slate-400">/mth</span>
                            </p>
                            <p className="text-xs text-slate-400 mt-1">
                                ${fmt(result.private.employed.annual)}/yr
                            </p>
                        </div>
                    )}

                    {/* Min income — HDB employed */}
                    {result && (
                        <div className="card p-4">
                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                                Min. Income (HDB/EC, Employed)
                            </p>
                            <p className="text-xl font-bold text-emerald-600 mt-0.5">
                                ${fmt(result.hdb.employed.monthly)}<span className="text-sm font-medium text-slate-400">/mth</span>
                            </p>
                            <p className="text-xs text-slate-400 mt-1">
                                ${fmt(result.hdb.employed.annual)}/yr
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Output tables ── */}
            {result && (
                <>
                    <IncomeTable
                        title="Private Property (55% TDSR)"
                        subtitle="TDSR is the only constraint — total debt ≤ 55% of gross income"
                        accentColor="#03a9e7"
                        accentBg="#f0f9ff"
                        data={result.private}
                        hasLiability={hasLiab}
                    />
                    <IncomeTable
                        title="HDB / EC Property (30% MSR)"
                        subtitle="Both MSR and TDSR apply — binding constraint is the stricter one"
                        accentColor="#059669"
                        accentBg="#f0fdf4"
                        data={result.hdb}
                        hasLiability={hasLiab}
                    />
                </>
            )}
        </div>
    )
}
