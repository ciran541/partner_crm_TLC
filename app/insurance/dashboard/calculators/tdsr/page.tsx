'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, BarChart3, CheckCircle, AlertCircle } from 'lucide-react'
import type { SoraRates } from '@/lib/insurance/sora'

// ── Constants ──────────────────────────────────────────────────────────────────

const STRESS_RATE = 0.040   // used only for eligibility (not displayed installment)
const TDSR_L = 0.55
const MSR_L  = 0.30
const NOA_F  = 0.70

// Standard 75% LTV structure
const STD = { ltv: 0.75, maxAge: 65, tenPrivate: 30, tenHDB: 25, minCash: 0.05 } as const
// Alternative 55% LTV structure
const ALT = { ltv: 0.55, maxAge: 75, tenPrivate: 35, tenHDB: 30, minCash: 0.10 } as const

type PropType  = 'hdb' | 'private' | 'ecNewLaunch'
type Residency = 'sc' | 'pr' | 'foreigner'
type Params = typeof STD

// ── Engine ─────────────────────────────────────────────────────────────────────

function borrowerIncome(basic: number, noa: number, employed: boolean): number {
    // Employed:     monthly basic + (annual variable/NOA × 70% / 12)
    // Self-employed:              annual NOA × 70% / 12
    return employed ? basic + (noa * NOA_F / 12) : (noa * NOA_F / 12)
}

function wAvgAge(a1: number, i1: number, a2: number, i2: number): number {
    const total = i1 + i2
    if (total === 0) return a1
    return Math.ceil((a1 * i1 + a2 * i2) / total)
}

function pvCalc(mr: number, months: number, payment: number): number {
    if (mr === 0) return payment * months
    return payment * (1 - Math.pow(1 + mr, -months)) / mr
}

function emiCalc(principal: number, mr: number, months: number): number {
    if (principal <= 0) return 0
    if (mr === 0) return principal / months
    return principal * mr * Math.pow(1 + mr, months) / (Math.pow(1 + mr, months) - 1)
}

interface CalcResult {
    tenure: number; wAge: number
    finalLoan: number; incomeBasedLoan: number; maxLoan: number; ltv: number
    monthlyInstallment: number
    minCash: number; balanceDP: number
    shortfall: number
    pledgeFund: { pf: number; sf: number } | null
    qualifies: boolean
}

function runCalc(
    params: Params,
    price: number,
    totalIncome: number,
    totalCommitments: number,
    wAge: number,
    propType: PropType,
    refRatePct: number,
): CalcResult | null {
    const isHDB = propType === 'hdb' || propType === 'ecNewLaunch'
    const maxTen = isHDB ? params.tenHDB : params.tenPrivate
    const tenure = Math.min(params.maxAge - wAge, maxTen)
    if (tenure <= 0 || price <= 0 || totalIncome <= 0) return null

    const months   = tenure * 12
    const stressR  = STRESS_RATE / 12
    const tdsrAvail = Math.max(totalIncome * TDSR_L - totalCommitments, 0)
    const msrAvail  = totalIncome * MSR_L
    const payment   = isHDB ? Math.min(msrAvail, tdsrAvail) : tdsrAvail

    const incomeBasedLoan = pvCalc(stressR, months, payment)
    const maxLoan  = price * params.ltv
    const finalLoan = Math.min(incomeBasedLoan, maxLoan)

    const refR = (refRatePct / 100) / 12
    const monthlyInstallment = emiCalc(finalLoan, refR, months)

    const minCash  = price * params.minCash
    const balanceDP = Math.max(0, price - finalLoan - minCash)
    const shortfall = Math.max(0, maxLoan - finalLoan)

    let pledgeFund: { pf: number; sf: number } | null = null
    if (shortfall > 1) {
        const shortfallPayment = incomeBasedLoan === 0
            ? emiCalc(shortfall, stressR, months)
            : payment * (shortfall / incomeBasedLoan)
        const divisor = isHDB ? 0.30 : 0.55
        const pf = Math.max(0, (shortfallPayment * 48) / divisor)
        const sf = Math.max(0, pf / 0.3)
        if (pf > 1 && sf > 1) pledgeFund = { pf, sf }
    }

    return {
        tenure, wAge, finalLoan, incomeBasedLoan, maxLoan,
        ltv: (finalLoan / price) * 100,
        monthlyInstallment, minCash, balanceDP, shortfall,
        pledgeFund, qualifies: incomeBasedLoan >= maxLoan,
    }
}

// BSD (6-tier)
function calcBSD(v: number): number {
    let b = 0
    if (v <= 180000)  return v * 0.01
    b += 1800;   if (v <= 360000)  return b + (v - 180000) * 0.02
    b += 3600;   if (v <= 1000000) return b + (v - 360000) * 0.03
    b += 19200;  if (v <= 1500000) return b + (v - 1000000) * 0.04
    b += 20000;  if (v <= 3000000) return b + (v - 1500000) * 0.05
    b += 75000;  return b + (v - 3000000) * 0.06
}

// ABSD (first-property simplified: SC 0%, PR 5%, Foreigner 60%; joint = worst status)
function calcABSD(v: number, s1: Residency, s2: Residency | null, joint: boolean): number {
    const rank = (s: Residency | null) => s === 'foreigner' ? 2 : s === 'pr' ? 1 : 0
    const r = joint ? Math.max(rank(s1), rank(s2)) : rank(s1)
    if (r === 2) return v * 0.60
    if (r === 1) return v * 0.05
    return 0
}

function absdRateLabel(s1: Residency, s2: Residency | null, joint: boolean): string {
    const rank = (s: Residency | null) => s === 'foreigner' ? 2 : s === 'pr' ? 1 : 0
    const r = joint ? Math.max(rank(s1), rank(s2)) : rank(s1)
    if (r === 2) return '60%'
    if (r === 1) return '5%'
    return '0%'
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmt  = (n: number) => `$${Math.floor(n).toLocaleString('en-SG')}`
const fmtP = (n: number) => {
    const r = Math.round(n * 10) / 10
    return r === Math.floor(r) ? `${Math.floor(r)}%` : `${r}%`
}

const inp = 'px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/10 bg-white transition-colors w-full'

function moneyChange(setter: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.replace(/[^\d]/g, '')
        setter(raw ? parseInt(raw).toLocaleString('en-SG') : '')
    }
}

// ── Segmented buttons ──────────────────────────────────────────────────────────

function Seg({ options, value, onChange, disabled }: {
    options: { label: string; value: string }[]
    value: string
    onChange: (v: string) => void
    disabled?: (v: string) => boolean
}) {
    return (
        <div className="flex bg-slate-100 rounded-lg p-1 gap-1">
            {options.map(o => {
                const dis = disabled?.(o.value) ?? false
                return (
                    <button
                        key={o.value}
                        type="button"
                        disabled={dis}
                        onClick={() => !dis && onChange(o.value)}
                        className={`flex-1 text-xs font-semibold py-1.5 px-2 rounded-md transition-all whitespace-nowrap ${
                            value === o.value
                                ? 'bg-white text-[#052d4a] shadow-sm'
                                : dis
                                    ? 'text-slate-300 cursor-not-allowed'
                                    : 'text-slate-500 hover:text-slate-700 cursor-pointer'
                        }`}
                    >
                        {o.label}
                    </button>
                )
            })}
        </div>
    )
}

// ── BorrowerCard ───────────────────────────────────────────────────────────────

function BorrowerCard({
    title, employed, setEmployed,
    basic, setBasic, noa, setNoa,
    age, setAge, commitments, setCommitments,
    residency, setResidency, disableForeigner,
}: {
    title: string
    employed: boolean; setEmployed: (v: boolean) => void
    basic: string; setBasic: (v: string) => void
    noa: string; setNoa: (v: string) => void
    age: string; setAge: (v: string) => void
    commitments: string; setCommitments: (v: string) => void
    residency: Residency; setResidency: (v: Residency) => void
    disableForeigner: boolean
}) {
    const noaLabel = employed ? 'Annual Bonus / Variable Income' : 'Annual NOA Income'

    return (
        <div className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/60">
                <h3 className="text-sm font-bold text-slate-700">{title}</h3>
            </div>
            <div className="p-5 space-y-4">

                {/* Employment toggle */}
                <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Employment</label>
                    <Seg
                        options={[
                            { label: 'Employed', value: 'employed' },
                            { label: 'Self-Employed', value: 'selfEmployed' },
                        ]}
                        value={employed ? 'employed' : 'selfEmployed'}
                        onChange={v => setEmployed(v === 'employed')}
                    />
                </div>

                {/* Basic salary — employed only */}
                {employed && (
                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Monthly Basic Salary</label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">$</span>
                            <input
                                type="text"
                                value={basic}
                                onChange={moneyChange(setBasic)}
                                className={`${inp} pl-7`}
                                placeholder="5,000"
                            />
                        </div>
                    </div>
                )}

                {/* NOA / Variable */}
                <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{noaLabel}</label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">$</span>
                        <input
                            type="text"
                            value={noa}
                            onChange={moneyChange(setNoa)}
                            className={`${inp} pl-7 border-dashed`}
                            placeholder="0"
                        />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">70% of this is assessed · divide by 12 for monthly</p>
                </div>

                {/* Age + Commitments */}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Age</label>
                        <input
                            type="number"
                            value={age}
                            onChange={e => setAge(e.target.value)}
                            className={inp}
                            placeholder="35"
                            min={18}
                            max={80}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Monthly Commitments</label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">$</span>
                            <input
                                type="text"
                                value={commitments}
                                onChange={moneyChange(setCommitments)}
                                className={`${inp} pl-7`}
                                placeholder="0"
                            />
                        </div>
                    </div>
                </div>

                {/* Residency */}
                <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Residency Status</label>
                    <Seg
                        options={[
                            { label: 'SC', value: 'sc' },
                            { label: 'PR', value: 'pr' },
                            { label: 'Foreigner', value: 'foreigner' },
                        ]}
                        value={residency}
                        onChange={v => setResidency(v as Residency)}
                        disabled={v => disableForeigner && v === 'foreigner'}
                    />
                    {disableForeigner && (
                        <p className="text-[11px] text-amber-600 mt-1.5">Foreigners cannot purchase HDB / EC New Launch</p>
                    )}
                </div>
            </div>
        </div>
    )
}

// ── ResultCard ─────────────────────────────────────────────────────────────────

function ResultCard({
    label, badge, params, result, price, refRatePct,
}: {
    label: string; badge: string
    params: Params; result: CalcResult | null
    price: number; refRatePct: number
}) {
    if (!result) {
        return (
            <div className="card p-5">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-slate-700">{label}</h3>
                    <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded">{badge}</span>
                </div>
                <p className="text-xs text-slate-400">Enter income details above to see results.</p>
            </div>
        )
    }

    const maxLtvPct = params.ltv * 100
    const barFill   = Math.min((result.ltv / maxLtvPct) * 100, 100)
    const balanceDPPct = Math.max(0, 100 - result.ltv - params.minCash * 100)

    return (
        <div className="card overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-700">{label}</h3>
                <span className="text-[11px] font-bold text-[#03a9e7] bg-sky-50 border border-sky-100 px-2 py-1 rounded">{badge}</span>
            </div>

            <div className="p-5 space-y-4">

                {/* Loan bar */}
                <div>
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-semibold text-slate-500">
                            LTV {fmtP(result.ltv)} of {fmtP(maxLtvPct)} max
                        </span>
                        <span className="text-sm font-black text-[#052d4a]">{fmt(result.finalLoan)}</span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                                width: `${barFill}%`,
                                background: result.qualifies
                                    ? 'linear-gradient(90deg, #03a9e7, #052d4a)'
                                    : 'linear-gradient(90deg, #f59e0b, #d97706)',
                            }}
                        />
                    </div>
                </div>

                {/* Tenure + Monthly */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 rounded-xl p-3.5">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Loan Tenure</p>
                        <p className="text-xl font-black text-slate-700 mt-1">
                            {result.tenure}<span className="text-sm font-semibold text-slate-400 ml-1">yrs</span>
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Weighted age {result.wAge}</p>
                    </div>
                    <div className="rounded-xl p-3.5" style={{ background: 'linear-gradient(135deg, #052d4a, #0a4a7a)' }}>
                        <p className="text-[10px] font-bold text-sky-300 uppercase tracking-wider">Monthly</p>
                        <p className="text-xl font-black text-white mt-1">{fmt(result.monthlyInstallment)}</p>
                        <p className="text-[10px] text-sky-200/70 mt-0.5">at {refRatePct.toFixed(2)}% p.a.</p>
                    </div>
                </div>

                {/* Income eligibility */}
                <div className="bg-sky-50 border border-sky-100 rounded-xl p-3.5">
                    <p className="text-[10px] font-bold text-sky-500 uppercase tracking-wider mb-1">Income-Based Eligibility</p>
                    <p className="text-base font-bold text-sky-700">{fmt(result.incomeBasedLoan)}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                        Stress tested at {(STRESS_RATE * 100).toFixed(1)}% p.a. · Max allowed: {fmt(result.maxLoan)}
                    </p>
                </div>

                {/* Downpayment */}
                <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Downpayment Required</p>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Min Cash ({fmtP(params.minCash * 100)})</span>
                            <span className="text-sm font-bold text-amber-600">{fmt(result.minCash)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Balance Cash / CPF ({fmtP(balanceDPPct)})</span>
                            <span className="text-sm font-bold text-violet-600">{fmt(result.balanceDP)}</span>
                        </div>
                        <div className="border-t border-slate-100 pt-2 flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-600">Total Downpayment</span>
                            <span className="text-sm font-black text-slate-700">{fmt(result.minCash + result.balanceDP)}</span>
                        </div>
                    </div>
                </div>

                {/* Qualify / Shortfall */}
                {result.qualifies ? (
                    <div className="flex items-start gap-2.5 bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-3">
                        <CheckCircle size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                        <p className="text-xs font-medium text-emerald-700">
                            Qualifies for maximum {fmtP(maxLtvPct)} loan based on income provided.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2.5">
                        <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 rounded-xl px-3.5 py-3">
                            <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                            <p className="text-xs font-medium text-red-600">
                                Loan shortfall {fmt(result.shortfall)} to reach {fmtP(maxLtvPct)}
                            </p>
                        </div>
                        {result.pledgeFund && (
                            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3.5 space-y-2">
                                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">
                                    To reach {fmtP(maxLtvPct)} — pledge or show funds:
                                </p>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-slate-600">Pledge Fund</span>
                                    <span className="text-sm font-bold text-amber-700">{fmt(result.pledgeFund.pf)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-slate-600">Show Fund</span>
                                    <span className="text-sm font-bold text-amber-700">{fmt(result.pledgeFund.sf)}</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function TDSRPage() {
    // Property
    const [propType,  setPropType]  = useState<PropType>('private')
    const [joint,     setJoint]     = useState(false)
    const [price,     setPrice]     = useState('1,000,000')
    const [refRate,   setRefRate]   = useState('3.80')
    const [sora,      setSora]      = useState<SoraRates | null>(null)

    // Borrower 1
    const [b1Emp,  setB1Emp]  = useState(true)
    const [b1Sal,  setB1Sal]  = useState('')
    const [b1NOA,  setB1NOA]  = useState('')
    const [b1Age,  setB1Age]  = useState('')
    const [b1Comm, setB1Comm] = useState('')
    const [b1Res,  setB1Res]  = useState<Residency>('sc')

    // Borrower 2
    const [b2Emp,  setB2Emp]  = useState(true)
    const [b2Sal,  setB2Sal]  = useState('')
    const [b2NOA,  setB2NOA]  = useState('')
    const [b2Age,  setB2Age]  = useState('')
    const [b2Comm, setB2Comm] = useState('')
    const [b2Res,  setB2Res]  = useState<Residency>('sc')

    const isHDB = propType === 'hdb' || propType === 'ecNewLaunch'

    // Live SORA pre-fill
    useEffect(() => {
        fetch('/api/insurance/rates')
            .then(r => r.json())
            .then(d => {
                if (d.sora?.comp_sora_3m) {
                    setSora(d.sora)
                    setRefRate((d.sora.comp_sora_3m + 0.28).toFixed(2))
                }
            })
            .catch(() => {})
    }, [])

    // Reset foreigner status when HDB/EC selected
    useEffect(() => {
        if (isHDB) {
            if (b1Res === 'foreigner') setB1Res('sc')
            if (b2Res === 'foreigner') setB2Res('sc')
        }
    }, [isHDB])

    // Parse inputs
    const priceVal  = parseFloat(price.replace(/,/g, '')) || 0
    const refRateVal = parseFloat(refRate) || 0
    const b1SalVal  = parseFloat(b1Sal.replace(/,/g, '')) || 0
    const b1NOAVal  = parseFloat(b1NOA.replace(/,/g, '')) || 0
    const b1AgeVal  = parseInt(b1Age) || 0
    const b1CommVal = parseFloat(b1Comm.replace(/,/g, '')) || 0
    const b2SalVal  = parseFloat(b2Sal.replace(/,/g, '')) || 0
    const b2NOAVal  = parseFloat(b2NOA.replace(/,/g, '')) || 0
    const b2AgeVal  = parseInt(b2Age) || 0
    const b2CommVal = parseFloat(b2Comm.replace(/,/g, '')) || 0

    const inc1 = borrowerIncome(b1SalVal, b1NOAVal, b1Emp)
    const inc2 = joint ? borrowerIncome(b2SalVal, b2NOAVal, b2Emp) : 0
    const totalIncome = inc1 + inc2
    const totalCommitments = b1CommVal + (joint ? b2CommVal : 0)
    const wAge = joint && b2AgeVal > 0
        ? wAvgAge(b1AgeVal, inc1, b2AgeVal, inc2)
        : b1AgeVal

    const results = useMemo(() => {
        if (priceVal <= 0 || totalIncome <= 0 || wAge <= 0 || refRateVal <= 0) return null
        return {
            std: runCalc(STD, priceVal, totalIncome, totalCommitments, wAge, propType, refRateVal),
            alt: runCalc(ALT, priceVal, totalIncome, totalCommitments, wAge, propType, refRateVal),
        }
    }, [priceVal, totalIncome, totalCommitments, wAge, propType, refRateVal])

    // Misc costs
    const bsd      = priceVal > 0 ? calcBSD(priceVal) : 0
    const absd     = priceVal > 0 ? calcABSD(priceVal, b1Res, joint ? b2Res : null, joint) : 0
    const absdRate = absdRateLabel(b1Res, joint ? b2Res : null, joint)
    const legalFee = isHDB ? 1800 : 2500
    const valFee   = isHDB ? 120 : priceVal < 1000000 ? 300 : priceVal < 2000000 ? 400 : 500

    const comp3m = sora?.comp_sora_3m

    return (
        <div className="max-w-6xl mx-auto space-y-6">

            {/* Header */}
            <div>
                <Link
                    href="/insurance/dashboard/calculators"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-600 mb-3 transition-colors"
                >
                    <ArrowLeft size={13} /> Calculators
                </Link>
                <h1 className="ios-page-title flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                        <BarChart3 size={18} className="text-blue-600" />
                    </span>
                    Technical TDSR
                </h1>
                <p className="page-subtitle mt-1">
                    Loan eligibility under standard 75% LTV and alternative 55% LTV, with pledge fund guidance.
                </p>
            </div>

            {/* Property card */}
            <div className="card overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                    <h3 className="section-label mb-0">Property</h3>
                </div>
                <div className="p-6 space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Property Type</label>
                            <Seg
                                options={[
                                    { label: 'HDB', value: 'hdb' },
                                    { label: 'Private', value: 'private' },
                                    { label: 'EC New Launch', value: 'ecNewLaunch' },
                                ]}
                                value={propType}
                                onChange={v => setPropType(v as PropType)}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Borrowers</label>
                            <Seg
                                options={[
                                    { label: 'Single Borrower', value: 'single' },
                                    { label: 'Joint Borrowers', value: 'joint' },
                                ]}
                                value={joint ? 'joint' : 'single'}
                                onChange={v => setJoint(v === 'joint')}
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Property Value</label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">$</span>
                                <input
                                    type="text"
                                    value={price}
                                    onChange={moneyChange(setPrice)}
                                    className={`${inp} pl-7`}
                                    placeholder="1,000,000"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Reference Rate (% p.a.)</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    step="0.01"
                                    value={refRate}
                                    onChange={e => setRefRate(e.target.value)}
                                    className={`${inp} pr-7`}
                                    placeholder="3.80"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">%</span>
                            </div>
                            {comp3m != null ? (
                                <p className="text-[11px] text-slate-400 mt-1.5">
                                    Live 3M SORA: {comp3m.toFixed(4)}% · Pre-filled at SORA + 0.28%
                                </p>
                            ) : (
                                <p className="text-[11px] text-slate-400 mt-1.5">Used only for monthly installment display · eligibility uses 4.0% stress rate</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Borrower cards */}
            <div className={`grid grid-cols-1 ${joint ? 'lg:grid-cols-2' : ''} gap-5`}>
                <BorrowerCard
                    title={joint ? 'Borrower 1 — Income Details' : 'Income Details'}
                    employed={b1Emp} setEmployed={setB1Emp}
                    basic={b1Sal} setBasic={setB1Sal}
                    noa={b1NOA} setNoa={setB1NOA}
                    age={b1Age} setAge={setB1Age}
                    commitments={b1Comm} setCommitments={setB1Comm}
                    residency={b1Res} setResidency={setB1Res}
                    disableForeigner={isHDB}
                />
                {joint && (
                    <BorrowerCard
                        title="Borrower 2 — Income Details"
                        employed={b2Emp} setEmployed={setB2Emp}
                        basic={b2Sal} setBasic={setB2Sal}
                        noa={b2NOA} setNoa={setB2NOA}
                        age={b2Age} setAge={setB2Age}
                        commitments={b2Comm} setCommitments={setB2Comm}
                        residency={b2Res} setResidency={setB2Res}
                        disableForeigner={isHDB}
                    />
                )}
            </div>

            {/* Effective income summary */}
            {totalIncome > 0 && (
                <div className="card p-4">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Effective Monthly Income (post-haircut)</p>
                    <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                        <div>
                            <p className="text-[11px] text-slate-400">{joint ? 'Borrower 1' : 'Effective Income'}</p>
                            <p className="text-base font-bold text-slate-700">{fmt(inc1)}<span className="text-xs font-normal text-slate-400"> /mo</span></p>
                        </div>
                        {joint && inc2 > 0 && (
                            <div>
                                <p className="text-[11px] text-slate-400">Borrower 2</p>
                                <p className="text-base font-bold text-slate-700">{fmt(inc2)}<span className="text-xs font-normal text-slate-400"> /mo</span></p>
                            </div>
                        )}
                        {joint && (
                            <div className="border-l border-slate-200 pl-8">
                                <p className="text-[11px] text-slate-400">Combined</p>
                                <p className="text-base font-bold text-[#052d4a]">{fmt(totalIncome)}<span className="text-xs font-normal text-slate-400"> /mo</span></p>
                            </div>
                        )}
                        {totalCommitments > 0 && (
                            <div className="border-l border-slate-200 pl-8">
                                <p className="text-[11px] text-slate-400">Total Commitments</p>
                                <p className="text-base font-bold text-red-500">{fmt(totalCommitments)}<span className="text-xs font-normal text-slate-400"> /mo</span></p>
                            </div>
                        )}
                        {wAge > 0 && (
                            <div className="border-l border-slate-200 pl-8">
                                <p className="text-[11px] text-slate-400">{joint ? 'Weighted Age' : 'Age'}</p>
                                <p className="text-base font-bold text-slate-700">{wAge}<span className="text-xs font-normal text-slate-400"> yrs</span></p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Results — two columns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <ResultCard
                    label="Standard Structure"
                    badge="75% LTV · Max age 65"
                    params={STD}
                    result={results?.std ?? null}
                    price={priceVal}
                    refRatePct={refRateVal}
                />
                <ResultCard
                    label="Alternative Structure"
                    badge="55% LTV · Max age 75"
                    params={ALT}
                    result={results?.alt ?? null}
                    price={priceVal}
                    refRatePct={refRateVal}
                />
            </div>

            {/* Transaction costs */}
            {priceVal > 0 && (
                <div className="card overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100">
                        <h3 className="section-label mb-0">Estimated Transaction Costs</h3>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 divide-x divide-slate-100">
                        {[
                            {
                                label: 'Legal Fee',
                                value: legalFee,
                                sub: isHDB ? 'HDB (est.)' : 'Private (est.)',
                            },
                            {
                                label: 'Valuation Fee',
                                value: valFee,
                                sub: priceVal >= 2000000 ? 'onwards' : 'est.',
                            },
                            {
                                label: 'Buyer Stamp Duty',
                                value: bsd,
                                sub: '',
                            },
                            {
                                label: `ABSD (${absdRate})`,
                                value: absd,
                                sub: absd === 0 ? 'Not applicable — 1st property SC' : '',
                            },
                        ].map(c => (
                            <div key={c.label} className="p-4">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{c.label}</p>
                                <p className={`text-base font-bold mt-1 ${absd === c.value && absd === 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                                    {fmt(c.value)}
                                </p>
                                {c.sub && <p className="text-[10px] text-slate-400 mt-0.5">{c.sub}</p>}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
