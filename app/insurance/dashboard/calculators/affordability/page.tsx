'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Users } from 'lucide-react'
import { monthlyInstallment, TDSR_LIMIT, MSR_LIMIT, NOA_FACTOR } from '@/lib/insurance/loanCalc'

const STRESS_RATE = 4.0

// ── Engine ────────────────────────────────────────────────────────────────────

interface IncomeResult { monthly: number; annual: number }
interface AffordabilityResult {
    M: number
    private: { employed: IncomeResult; employedLiab: IncomeResult; self: IncomeResult; selfLiab: IncomeResult }
    hdb:     { employed: IncomeResult; employedLiab: IncomeResult; self: IncomeResult; selfLiab: IncomeResult }
}

function compute(
    loanAmount: number,
    tenureYears: number,
    monthlyLiability: number,
): AffordabilityResult | null {
    if (!loanAmount || loanAmount <= 0 || !tenureYears || tenureYears <= 0) return null

    const M = monthlyInstallment(loanAmount, STRESS_RATE, tenureYears)
    const L = monthlyLiability || 0

    // ── Private Property: TDSR (55%) only ────────────────────────────────────
    const pEmp     = M / TDSR_LIMIT
    const pEmpL    = (M + L) / TDSR_LIMIT
    const pSelfAnn  = (M / TDSR_LIMIT) / NOA_FACTOR * 12
    const pSelfLAnn = ((M + L) / TDSR_LIMIT) / NOA_FACTOR * 12

    // ── HDB / EC New Launch: binding = max(MSR 30%, TDSR 55%) ────────────────
    const hEmp     = Math.max(M / MSR_LIMIT, M / TDSR_LIMIT)
    const hEmpL    = Math.max(M / MSR_LIMIT, (M + L) / TDSR_LIMIT)
    const hSelfEff  = Math.max(M / MSR_LIMIT, M / TDSR_LIMIT)
    const hSelfAnn  = hSelfEff / NOA_FACTOR * 12
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
    tenureNote,
    accentColor,
    accentBg,
    data,
    hasLiability,
    ltvRemark,
}: {
    title: string
    subtitle: string
    tenureNote: string
    accentColor: string
    accentBg: string
    data: AffordabilityResult['private']
    hasLiability: boolean
    ltvRemark?: boolean
}) {
    // Fixed per-column colors — independent of section accent
    const cols = [
        { key: 'employed'     as const, label: 'Basic Pay',      sub: 'Employed',      dotColor: '#16a34a', subColor: '#f97316' },
        { key: 'employedLiab' as const, label: 'With Liability',  sub: 'Employed',      dotColor: '#ef4444', subColor: '#f97316' },
        { key: 'self'         as const, label: 'NOA income',      sub: 'Self-employed', dotColor: '#7c3aed', subColor: '#94a3b8' },
        { key: 'selfLiab'     as const, label: 'With Liability',  sub: 'Self-employed', dotColor: '#ef4444', subColor: '#7c3aed' },
    ]

    return (
        <div className="card overflow-hidden">
            {/* Section header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-start gap-3" style={{ background: accentBg }}>
                <div className="w-1 h-8 rounded-full shrink-0 mt-0.5" style={{ background: accentColor }} />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold" style={{ color: accentColor }}>{title}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5 italic">{tenureNote}</p>
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
                                >
                                    <div className="font-semibold normal-case tracking-normal" style={{ color: accentColor }}>{c.sub}</div>
                                    <div className="mt-0.5" style={{ color: (c.label === 'Basic Pay' || c.label === 'NOA income') ? accentColor : c.dotColor }}>{c.label}</div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {/* Monthly row */}
                        <tr className="border-b border-slate-100">
                            <td className="px-5 py-3.5 text-xs font-semibold text-slate-500 whitespace-nowrap">Monthly Income</td>
                            {cols.map((c, i) => {
                                const isLiab = i === 1 || i === 3
                                return (
                                    <td
                                        key={i}
                                        className={`px-5 py-3.5 text-center font-semibold ${
                                            !hasLiability && isLiab ? 'opacity-30' : ''
                                        }`}
                                        style={{ color: isLiab ? '#374151' : accentColor }}
                                    >
                                        ${fmt(data[c.key].monthly)}
                                    </td>
                                )
                            })}
                        </tr>
                        {/* Annual row */}
                        <tr className="bg-slate-50/60">
                            <td className="px-5 py-3.5 text-xs font-semibold text-slate-500 whitespace-nowrap">Annual Income</td>
                            {cols.map((c, i) => {
                                const isLiab = i === 1 || i === 3
                                return (
                                    <td
                                        key={i}
                                        className={`px-5 py-3.5 text-center font-black text-base ${
                                            !hasLiability && isLiab ? 'opacity-30' : ''
                                        }`}
                                        style={{ color: isLiab ? '#374151' : accentColor }}
                                    >
                                        ${fmt(data[c.key].annual)}
                                    </td>
                                )
                            })}
                        </tr>
                    </tbody>
                </table>
            </div>

            {ltvRemark && (
                <div className="px-5 py-2.5 border-t border-amber-100 bg-amber-50 flex items-center gap-2">
                    <span className="text-amber-500 text-sm font-bold shrink-0">⚠</span>
                    <p className="text-xs font-semibold text-amber-700">Loan is capped at 55% LTV</p>
                </div>
            )}
        </div>
    )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AffordabilityPage() {
    const [loanAmount, setLoanAmount] = useState('900000')
    const [tenure, setTenure]         = useState('30')
    const [liability, setLiability]   = useState('')

    const loan   = parseFloat(loanAmount.replace(/,/g, '')) || 0
    const tenRaw = parseInt(tenure)
    const ten    = isNaN(tenRaw) ? 0 : Math.min(Math.max(tenRaw, 5), 35)
    const liab   = parseFloat(liability.replace(/,/g, '')) || 0
    const hasLiab = liab > 0

    const result = useMemo(
        () => compute(loan, ten, liab),
        [loan, ten, liab]
    )

    // Blur / remark rules
    const hdbBlurred     = ten > 30
    const showLtvPrivate = ten > 30
    const showLtvHdb     = ten >= 26 && ten <= 30
    const showLtvEc      = ten > 30

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

            {/* ── Inputs ── */}
            <div className="card overflow-hidden">
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

                        {/* Tenure */}
                        <div className="col-span-2 sm:col-span-1">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                Tenure (Years)
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
                                className={inp}
                                placeholder="30"
                                min={5}
                                max={35}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Output tables ── */}
            {result && (
                <div className="space-y-4">
                    {/* Private Property */}
                    <IncomeTable
                        title="Private Property (55% TDSR)"
                        subtitle="Borrower will need to pass TDSR."
                        tenureNote="Tenure range 5 – 35 years"
                        accentColor="#03a9e7"
                        accentBg="#f0f9ff"
                        data={result.private}
                        hasLiability={hasLiab}
                        ltvRemark={showLtvPrivate}
                    />

                    {/* HDB */}
                    <div className={`transition-opacity duration-200 ${hdbBlurred ? 'opacity-40 pointer-events-none' : ''}`}>
                        {hdbBlurred && (
                            <p className="text-xs font-semibold text-slate-500 bg-slate-100 border border-slate-200 rounded-lg px-4 py-2 mb-3">
                                HDB loans cannot exceed 30 years — not applicable at this tenure.
                            </p>
                        )}
                        <IncomeTable
                            title="HDB (55% TDSR / 30% MSR)"
                            subtitle="Borrower will need to pass TDSR and MSR."
                            tenureNote="Tenure range 5 – 30 years"
                            accentColor="#059669"
                            accentBg="#f0fdf4"
                            data={result.hdb}
                            hasLiability={hasLiab}
                            ltvRemark={showLtvHdb}
                        />
                    </div>

                    {/* EC New Launch */}
                    <IncomeTable
                        title="EC New Launch (55% TDSR / 30% MSR)"
                        subtitle="Borrower will need to pass TDSR and MSR."
                        tenureNote="Tenure range 5 – 35 years"
                        accentColor="#7c3aed"
                        accentBg="#f5f3ff"
                        data={result.hdb}
                        hasLiability={hasLiab}
                        ltvRemark={showLtvEc}
                    />
                </div>
            )}
        </div>
    )
}
