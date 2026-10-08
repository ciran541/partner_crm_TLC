'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Building2 } from 'lucide-react'
import { formatMoneyInput } from '@/lib/utils/formatCurrency'
import type { SoraRates } from '@/lib/insurance/sora'

// ── Milestones ─────────────────────────────────────────────────────────────────

const MILESTONES = [
    { label: 'Booking Fee',                               pct: 0.05 },
    { label: 'Downpayment (S&P)',                         pct: 0.15 },
    { label: 'Foundation',                                pct: 0.10 },
    { label: 'Unit Concrete Framework',                   pct: 0.10 },
    { label: 'Brick Wall',                                pct: 0.05 },
    { label: 'Ceiling / Roofing',                         pct: 0.05 },
    { label: 'Door / Window / Plumbing / Wiring',         pct: 0.05 },
    { label: 'Carpark / Road / Drain',                    pct: 0.05 },
    { label: 'Temporary Occupation Permit (TOP)',          pct: 0.25 },
    { label: 'Certificate of Statutory Completion (CSC)', pct: 0.15 },
]

// ── Engine ─────────────────────────────────────────────────────────────────────

function calcEMI(principal: number, annualRatePct: number, months: number): number {
    const r = annualRatePct / 12 / 100
    if (r === 0) return principal / months
    return principal * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1)
}

interface MilestoneResult {
    label: string; pct: number; amount: number
    cash: number; cpf: number; loan: number
    emi: number | null
}

function computeBUC(
    purchasePrice: number,
    loanAmount: number,
    cpfAmount: number,
    tenureYears: number,
    interestPct: number,
): { milestones: MilestoneResult[]; cashTotal: number } {
    let remCash = purchasePrice - cpfAmount - loanAmount
    let remCPF  = cpfAmount
    let remLoan = loanAmount

    const disbAmounts: number[]     = []
    const disbMilestoneIdx: number[] = []

    const milestones: MilestoneResult[] = MILESTONES.map((m, idx) => {
        const amount = m.pct * purchasePrice

        const cashPay = Math.min(remCash, amount);   remCash -= cashPay
        const cpfPay  = Math.min(remCPF,  amount - cashPay);   remCPF  -= cpfPay
        const loanPay = Math.min(remLoan, amount - cashPay - cpfPay); remLoan -= loanPay

        let emi: number | null = null

        if (loanPay > 0) {
            disbAmounts.push(loanPay)
            disbMilestoneIdx.push(idx)

            // Replicate calculateProgressiveEMI from original source
            let monthsPassed  = 0
            let totalDisbursed = 0
            let lastEMI = 0

            disbAmounts.forEach((d, i) => {
                if (i > 0) {
                    const prev = disbMilestoneIdx[i - 1]
                    const curr = disbMilestoneIdx[i]
                    // 12-month gap before CSC, 6 months between all other stages
                    monthsPassed += (curr === 9 && prev === 8) ? 12 : 6
                }
                const remMonths = tenureYears * 12 - monthsPassed
                if (remMonths <= 0) return
                totalDisbursed += d
                lastEMI = calcEMI(totalDisbursed, interestPct, remMonths)
            })

            emi = lastEMI > 0 ? lastEMI : null
        }

        return { label: m.label, pct: m.pct, amount, cash: cashPay, cpf: cpfPay, loan: loanPay, emi }
    })

    return { milestones, cashTotal: purchasePrice - cpfAmount - loanAmount }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
    return Math.round(n).toLocaleString('en-SG')
}

const inp = 'px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/10 bg-white transition-colors w-full'

function moneyChange(setter: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setter(formatMoneyInput(e.target.value))
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BUCPage() {
    const [purchasePrice, setPurchasePrice] = useState('1,000,000')
    const [loanAmount,    setLoanAmount]    = useState('750,000')
    const [cpfAmount,     setCpfAmount]     = useState('')
    const [tenure,        setTenure]        = useState('30')
    const [rateRef,       setRateRef]       = useState<'3M SORA' | '1M SORA' | 'Custom'>('3M SORA')
    const [spread,        setSpread]        = useState('0.20')
    const [spreadSign,    setSpreadSign]    = useState<'+' | '-'>('+')
    const [customRate,    setCustomRate]    = useState('')
    const [sora,          setSora]          = useState<SoraRates | null>(null)

    useEffect(() => {
        fetch('/api/insurance/rates')
            .then(r => r.json())
            .then(d => { if (d.sora) setSora(d.sora) })
            .catch(() => {})
    }, [])

    const price = parseFloat(purchasePrice.replace(/,/g, '')) || 0
    const loan  = parseFloat(loanAmount.replace(/,/g, ''))   || 0
    const cpf   = parseFloat(cpfAmount.replace(/,/g, ''))    || 0
    const ten   = parseInt(tenure)  || 0
    const cash  = price - cpf - loan

    const comp3m = sora?.comp_sora_3m ?? null
    const comp1m = sora?.comp_sora_1m ?? null
    const soraValue = rateRef === '3M SORA' ? comp3m : rateRef === '1M SORA' ? comp1m : null
    const spreadVal = parseFloat(spread) || 0
    const spreadMult = spreadSign === '-' ? -1 : 1
    const rate = rateRef === 'Custom'
        ? (parseFloat(customRate) || 0)
        : soraValue != null ? +(soraValue + spreadMult * spreadVal).toFixed(4) : 0

    // Validation
    const priceErr = price > 0 && price < 100000
        ? 'Property value must be at least $100,000' : null
    const loanErr  = loan > 0
        ? loan < 100000 ? 'Loan size must be at least $100,000'
            : price > 0 && loan > 0.75 * price ? `Loan cannot exceed 75% of purchase price ($${fmt(0.75 * price)})`
            : null
        : null
    const cpfErr   = cpf > 0 && price > 0 && loan > 0 && (cpf + loan) > 0.95 * price
        ? `CPF + Loan cannot exceed 95% of purchase price ($${fmt(0.95 * price)})` : null
    const tenErr   = ten > 0 && (ten < 5 || ten > 35) ? 'Tenure must be 5–35 years' : null
    const cashErr  = price > 0 && (loan > 0 || cpf > 0) && cash < 0.05 * price
        ? `Minimum 5% cash required ($${fmt(0.05 * price)})` : null

    const rateReady = rateRef === 'Custom' ? rate >= 0.01 && rate <= 20 : soraValue != null && rate >= 0.01
    const canCompute =
        price >= 100000 && loan >= 100000 && ten >= 5 && ten <= 35 &&
        rateReady &&
        !priceErr && !loanErr && !cpfErr && !tenErr && !cashErr

    const result = useMemo(
        () => canCompute ? computeBUC(price, loan, cpf, ten, rate) : null,
        [price, loan, cpf, ten, rate, canCompute]
    )

    const finalEMI = result?.milestones.filter(m => m.emi != null).at(-1)?.emi ?? null

    return (
        <div className="max-w-5xl mx-auto space-y-6">

            {/* Header */}
            <div>
                <Link
                    href="/insurance/dashboard/calculators"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-600 mb-3 transition-colors"
                >
                    <ArrowLeft size={13} /> Calculators
                </Link>
                <h1 className="ios-page-title flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                        <Building2 size={18} className="text-violet-600" />
                    </span>
                    BUC Calculator
                </h1>
                <p className="page-subtitle mt-1">
                    Progressive payment schedule for Building Under Construction properties.
                </p>
            </div>

            {/* Top grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

                {/* Inputs */}
                <div className="lg:col-span-2 card overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4 flex-wrap">
                        <h3 className="section-label mb-0">Property Details</h3>
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
                    <div className="p-6 space-y-5">

                        <div className="grid grid-cols-2 gap-4">
                            {/* Purchase price */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                    Purchase Price
                                </label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">$</span>
                                    <input
                                        type="text"
                                        value={purchasePrice}
                                        onChange={moneyChange(setPurchasePrice)}
                                        className={`${inp} pl-7`}
                                        placeholder="1,000,000"
                                    />
                                </div>
                                {priceErr && <p className="text-xs text-red-500 mt-1.5">{priceErr}</p>}
                            </div>

                            {/* Loan amount */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                    Loan Amount
                                    <span className="ml-1.5 font-normal text-slate-400 normal-case tracking-normal">(max 75%)</span>
                                </label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">$</span>
                                    <input
                                        type="text"
                                        value={loanAmount}
                                        onChange={moneyChange(setLoanAmount)}
                                        className={`${inp} pl-7`}
                                        placeholder="750,000"
                                    />
                                </div>
                                {loanErr && <p className="text-xs text-red-500 mt-1.5">{loanErr}</p>}
                            </div>

                            {/* CPF */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                    CPF Amount
                                    <span className="ml-1.5 font-normal text-slate-400 normal-case tracking-normal">(optional)</span>
                                </label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">$</span>
                                    <input
                                        type="text"
                                        value={cpfAmount}
                                        onChange={moneyChange(setCpfAmount)}
                                        className={`${inp} pl-7 border-dashed`}
                                        placeholder="0"
                                    />
                                </div>
                                {cpfErr && <p className="text-xs text-red-500 mt-1.5">{cpfErr}</p>}
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
                                {tenErr && <p className="text-xs text-red-500 mt-1.5">{tenErr}</p>}
                            </div>
                        </div>

                        {/* Interest rate */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                Interest Rate (% p.a.)
                            </label>
                            <div className="flex items-center gap-2 flex-wrap">
                                {/* 3M SORA / 1M SORA / Custom toggle */}
                                <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs shrink-0">
                                    {(['3M SORA', '1M SORA', 'Custom'] as const).map(ref => (
                                        <button
                                            key={ref}
                                            type="button"
                                            onClick={() => setRateRef(ref)}
                                            className={`px-3 py-1.5 font-semibold transition-colors ${
                                                rateRef === ref ? 'bg-[#052d4a] text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                                            }`}
                                        >
                                            {ref}
                                        </button>
                                    ))}
                                </div>
                                {rateRef === 'Custom' ? (
                                    <>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={customRate}
                                            onChange={e => setCustomRate(e.target.value)}
                                            placeholder="2.00"
                                            className={`${inp} w-24`}
                                        />
                                        <span className="text-xs font-medium text-slate-400">% p.a.</span>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            title="Toggle add / subtract spread"
                                            onClick={() => setSpreadSign(s => s === '-' ? '+' : '-')}
                                            className="px-2 py-1 rounded-md text-xs font-bold border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:border-[#03a9e7] hover:text-[#03a9e7] transition-colors shrink-0 select-none"
                                        >
                                            {spreadSign === '-' ? '−' : '+'}
                                        </button>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={spread}
                                            onChange={e => setSpread(e.target.value)}
                                            placeholder="0.20"
                                            className={`${inp} w-24`}
                                        />
                                        <span className="text-xs font-medium text-slate-400">%</span>
                                        {soraValue != null && (
                                            <span className="text-xs text-slate-400">
                                                = {rate.toFixed(4)}% p.a.
                                            </span>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        {cashErr && (
                            <div className="bg-red-50 border border-red-200 text-red-600 text-xs font-medium rounded-lg px-4 py-2.5">
                                {cashErr}
                            </div>
                        )}
                    </div>
                </div>

                {/* Summary cards */}
                <div className="flex flex-col gap-3">
                    {result ? (
                        <>
                            <div
                                className="card overflow-hidden"
                                style={{ background: 'linear-gradient(135deg, #052d4a 0%, #0a4a7a 100%)', border: 'none' }}
                            >
                                <div className="p-5">
                                    <p className="text-[11px] font-semibold text-sky-300 uppercase tracking-wider">
                                        Final Monthly Instalment
                                    </p>
                                    <p className="text-3xl font-black text-white mt-1.5 tracking-tight">
                                        {finalEMI != null ? `$${fmt(finalEMI)}` : '—'}
                                    </p>
                                    <p className="text-xs text-sky-200/70 mt-2">
                                        After full loan disbursement · {rate}% p.a.
                                    </p>
                                </div>
                            </div>

                            <div className="card p-4">
                                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Cash Payment</p>
                                <p className="text-xl font-bold text-amber-600 mt-0.5">${fmt(result.cashTotal)}</p>
                                <p className="text-xs text-slate-400 mt-0.5">{((result.cashTotal / price) * 100).toFixed(1)}% of purchase price</p>
                            </div>

                            {cpf > 0 && (
                                <div className="card p-4">
                                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">CPF Utilised</p>
                                    <p className="text-xl font-bold text-violet-600 mt-0.5">${fmt(cpf)}</p>
                                    <p className="text-xs text-slate-400 mt-0.5">{((cpf / price) * 100).toFixed(1)}% of purchase price</p>
                                </div>
                            )}

                            <div className="card p-4">
                                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Loan Amount</p>
                                <p className="text-xl font-bold text-emerald-600 mt-0.5">${fmt(loan)}</p>
                                <p className="text-xs text-slate-400 mt-0.5">{((loan / price) * 100).toFixed(1)}% of purchase price</p>
                            </div>
                        </>
                    ) : (
                        <div className="card p-5 text-center">
                            <p className="text-xs text-slate-400">
                                Fill in the details above to see the progressive payment schedule.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Progressive payment schedule */}
            {result && (
                <div className="card overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="section-label mb-0">Progressive Payment Schedule</h3>
                        <span className="text-[11px] text-slate-400">Instalment shown is cumulative after each loan drawdown</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Stage</th>
                                    <th className="px-5 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">Amount Due</th>
                                    <th className="px-5 py-3 text-right text-[11px] font-bold text-amber-500 uppercase tracking-wider">Cash</th>
                                    <th className="px-5 py-3 text-right text-[11px] font-bold text-violet-500 uppercase tracking-wider">CPF</th>
                                    <th className="px-5 py-3 text-right text-[11px] font-bold text-emerald-600 uppercase tracking-wider">Loan Drawdown</th>
                                    <th className="px-5 py-3 text-right text-[11px] font-bold text-emerald-600 uppercase tracking-wider">Monthly Instalment</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.milestones.map((m, i) => (
                                    <tr
                                        key={i}
                                        className={`border-b border-slate-50 ${
                                            m.loan > 0
                                                ? 'bg-emerald-50/30'
                                                : i % 2 === 1 ? 'bg-slate-50/40' : ''
                                        }`}
                                    >
                                        <td className="px-5 py-3.5">
                                            <div className="flex items-center gap-2.5">
                                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                                                    m.loan > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                                                }`}>
                                                    {i + 1}
                                                </span>
                                                <span className="text-slate-700 font-medium">
                                                    {m.label}
                                                    <span className="ml-1.5 text-[11px] font-bold text-slate-400">
                                                        ({(m.pct * 100).toFixed(0)}%)
                                                    </span>
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3.5 text-right font-semibold text-slate-700">
                                            ${fmt(m.amount)}
                                        </td>
                                        <td className="px-5 py-3.5 text-right font-semibold text-amber-600">
                                            {m.cash > 0 ? `$${fmt(m.cash)}` : <span className="text-slate-200">—</span>}
                                        </td>
                                        <td className="px-5 py-3.5 text-right font-semibold text-violet-600">
                                            {m.cpf > 0 ? `$${fmt(m.cpf)}` : <span className="text-slate-200">—</span>}
                                        </td>
                                        <td className="px-5 py-3.5 text-right font-semibold text-emerald-600">
                                            {m.loan > 0 ? `$${fmt(m.loan)}` : <span className="text-slate-200">—</span>}
                                        </td>
                                        <td className="px-5 py-3.5 text-right">
                                            {m.emi != null ? (
                                                <span className="font-black text-emerald-600">${fmt(m.emi)}</span>
                                            ) : (
                                                <span className="text-slate-200">—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}
