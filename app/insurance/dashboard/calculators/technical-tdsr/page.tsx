'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowLeftRight, ArrowRight } from 'lucide-react'
import { monthlyInstallment, maxLoanFromPayment } from '@/lib/insurance/loanCalc'
import { formatMoneyInput } from '@/lib/utils/formatCurrency'

// Two sides of the same annuity, kept deliberately dumb: no TDSR ratio, no income,
// no property type. The agent already knows the servicing figure they care about
// (e.g. a shortfall surfaced by a workflow) — this just converts it to a loan
// amount and back at a given stress rate and tenure.
//
// The two panels are INDEPENDENT scratchpads, not one chained calculation: an agent
// routinely runs an existing home loan on one side (say 27 yrs remaining) and a new
// equity loan on the other (34 yrs, age-capped) in the same sitting. Do not add
// validation that forces the two tenures or rates to agree — matching them only
// matters in the specific case where one side's output feeds the other's input.

const DEFAULT_STRESS = '4'

function fmt(n: number, decimals = 0): string {
    return n.toLocaleString('en-SG', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

const num = (s: string) => {
    const n = parseFloat(s.replace(/,/g, ''))
    return isFinite(n) ? n : 0
}

const inp = 'px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/10 bg-white transition-colors w-full tabular-nums'

export default function TechnicalTdsrPage() {
    // Left — loan amount in, monthly servicing out
    const [loanAmount, setLoanAmount] = useState('')
    const [stressL, setStressL] = useState(DEFAULT_STRESS)
    const [tenureL, setTenureL] = useState('')

    // Right — monthly servicing in, loan amount out
    const [tdsr, setTdsr] = useState('')
    const [stressR, setStressR] = useState(DEFAULT_STRESS)
    const [tenureR, setTenureR] = useState('')

    const installment = useMemo(
        () => monthlyInstallment(num(loanAmount), num(stressL), num(tenureL)),
        [loanAmount, stressL, tenureL]
    )
    const loanFromTdsr = useMemo(
        () => maxLoanFromPayment(num(tdsr), num(stressR), num(tenureR)),
        [tdsr, stressR, tenureR]
    )

    return (
        <div className="max-w-5xl mx-auto space-y-6">

            {/* ── Header ── */}
            <div>
                <Link href="/insurance/dashboard/calculators"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-600 mb-3 transition-colors">
                    <ArrowLeft size={13} /> Calculators
                </Link>
                <h1 className="ios-page-title flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-sky-100 flex items-center justify-center shrink-0">
                        <ArrowLeftRight size={18} className="text-[#03a9e7]" />
                    </span>
                    Technical TDSR
                </h1>
                <p className="page-subtitle mt-1">
                    Convert a loan amount to the monthly TDSR it needs — or a TDSR figure back to the loan it supports.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                {/* ── Left: loan amount → TDSR required ── */}
                <div className="card overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-100 bg-sky-50/60">
                        <p className="text-[11px] font-bold text-[#052d4a] uppercase tracking-wider">
                            Loan amount <ArrowRight size={11} className="inline mx-0.5 -mt-0.5" /> TDSR required
                        </p>
                    </div>
                    <div className="p-5 space-y-4">
                        <Field label="Loan Amount" prefix="$">
                            <input type="text" inputMode="numeric" value={loanAmount} placeholder="900,000"
                                onChange={e => setLoanAmount(formatMoneyInput(e.target.value))}
                                className={`${inp} pl-7`} />
                        </Field>

                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Stress Test" suffix="%">
                                <input type="text" inputMode="decimal" value={stressL} placeholder="4.00"
                                    onChange={e => setStressL(e.target.value)}
                                    className={`${inp} pr-7`} />
                            </Field>
                            <Field label="Tenure (Years)">
                                <input type="number" value={tenureL} placeholder="30"
                                    onChange={e => setTenureL(e.target.value)}
                                    className={inp} />
                            </Field>
                        </div>

                        <Result
                            label="TDSR Required"
                            value={installment > 0 ? `$${fmt(installment, 2)}` : '—'}
                            hint={installment > 0 ? `per month at ${fmt(num(stressL), 2)}% over ${fmt(num(tenureL))} yrs` : 'Enter a loan amount and tenure'}
                            tone="sky"
                        />
                    </div>
                </div>

                {/* ── Right: TDSR → loan amount ── */}
                <div className="card overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-100 bg-emerald-50/60">
                        <p className="text-[11px] font-bold text-[#052d4a] uppercase tracking-wider">
                            TDSR <ArrowRight size={11} className="inline mx-0.5 -mt-0.5" /> Loan amount
                        </p>
                    </div>
                    <div className="p-5 space-y-4">
                        <Field label="TDSR" prefix="$">
                            <input type="text" inputMode="numeric" value={tdsr} placeholder="3,000"
                                onChange={e => setTdsr(formatMoneyInput(e.target.value))}
                                className={`${inp} pl-7`} />
                        </Field>

                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Stress Test" suffix="%">
                                <input type="text" inputMode="decimal" value={stressR} placeholder="4.00"
                                    onChange={e => setStressR(e.target.value)}
                                    className={`${inp} pr-7`} />
                            </Field>
                            <Field label="Tenure (Years)">
                                <input type="number" value={tenureR} placeholder="30"
                                    onChange={e => setTenureR(e.target.value)}
                                    className={inp} />
                            </Field>
                        </div>

                        <Result
                            label="Loan Amount"
                            value={loanFromTdsr > 0 ? `$${fmt(loanFromTdsr)}` : '—'}
                            hint={loanFromTdsr > 0 ? `supported by $${fmt(num(tdsr))}/mth at ${fmt(num(stressR), 2)}% over ${fmt(num(tenureR))} yrs` : 'Enter a TDSR figure and tenure'}
                            tone="emerald"
                        />
                    </div>
                </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed px-1">
                Each side is independent — they can hold different tenures and stress rates.
                Only when you carry one side&apos;s answer into the other (e.g. converting a TDSR shortfall back into loan
                quantum, then subtracting it) do the stress test and tenure need to match on both.
                Straight annuity math on the figures entered — no income, liabilities or property type are considered here.
            </p>
        </div>
    )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({ label, prefix, suffix, children }: {
    label: string; prefix?: string; suffix?: string; children: React.ReactNode
}) {
    return (
        <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{label}</label>
            <div className="relative">
                {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400 pointer-events-none">{prefix}</span>}
                {children}
                {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400 pointer-events-none">{suffix}</span>}
            </div>
        </div>
    )
}

function Result({ label, value, hint, tone }: {
    label: string; value: string; hint: string; tone: 'sky' | 'emerald'
}) {
    const isSky = tone === 'sky'
    return (
        <div className={`rounded-xl border px-4 py-3.5 mt-1 ${isSky ? 'border-[#03a9e7]/25 bg-sky-50/50' : 'border-emerald-200 bg-emerald-50/50'}`}>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-bold tabular-nums mt-0.5 ${isSky ? 'text-[#03a9e7]' : 'text-emerald-600'}`}>{value}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>
        </div>
    )
}
