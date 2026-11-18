'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { CalculatorDraftScope, CalculatorResetButton, useCalcDraft } from '@/lib/calculators/draft'
import Link from 'next/link'
import { ArrowLeft, BarChart3, Plus, Minus } from 'lucide-react'
import { formatMoneyInput } from '@/lib/utils/formatCurrency'
import { TDSR_LIMIT, MSR_LIMIT, NOA_FACTOR, STRESS_TEST_RATE, incomeWeightedAge } from '@/lib/insurance/loanCalc'
import { OPTION_MATRIX, maxPurchaseFromLoan, type MaxPurchaseBreakdown as PurchaseBreakdown, type PurchasePropertyType } from '@/lib/insurance/purchaseCalc'
import type { Residency } from '@/lib/insurance/stampDuty'
import MaxPurchaseBreakdown from '@/components/shared/MaxPurchaseBreakdown'
import PropertyPremiumGate from '@/components/property/PropertyPremiumGate'

// Premium-tier feature — property-branded port of
// app/insurance/dashboard/calculators/tdsr/page.tsx ("Affordability" — the
// forward direction: income → max loan). TDSR/MSR limits and the IWAA engine
// come from lib/insurance/loanCalc.ts, the same source the insurance
// purchase workflow computes from.

// ── Constants ─────────────────────────────────────────────────────────────────

const STRESS_RATE = STRESS_TEST_RATE * 100   // % p.a. — used only for PV calculation

// Property type → two tenure options (maxAge cap, maxTenure)
const PROP_OPTS = {
    hdb:     { opt1: { maxAge: 65, maxTen: 25 }, opt2: { maxAge: 75, maxTen: 30 } },
    private: { opt1: { maxAge: 65, maxTen: 30 }, opt2: { maxAge: 75, maxTen: 35 } },
    ec:      { opt1: { maxAge: 65, maxTen: 30 }, opt2: { maxAge: 75, maxTen: 35 } },
} as const

type PropertyType = 'hdb' | 'private' | 'ec'
type Employment   = 'employed' | 'selfEmployed'

// Fee schedule (legal / valuation) for the purchase-price breakdown. This page's
// three types map onto the purchase workflow's: HDB → resale HDB, Private →
// resale condo, EC → EC new launch. Assumes no outstanding housing loan — the
// same assumption behind the 5% / 10% cash notes on the option cards.
const FEE_TYPE: Record<PropertyType, PurchasePropertyType> = {
    hdb: 'resale_hdb', private: 'resale_condo', ec: 'ec_new_launch',
}

interface Borrower {
    employment:         Employment
    monthlyBasic:       string
    annualVariable:     string   // commission / bonus (employed, optional)
    annualNOA:          string   // self-employed only
    age:                string
    monthlyLiabilities: string
}

// ── Engine ────────────────────────────────────────────────────────────────────

function parseMoney(s: string): number {
    return parseFloat(s.replace(/,/g, '')) || 0
}

function effectiveIncome(b: Borrower): number {
    if (b.employment === 'employed') {
        return parseMoney(b.monthlyBasic) + parseMoney(b.annualVariable) * NOA_FACTOR / 12
    }
    return parseMoney(b.annualNOA) * NOA_FACTOR / 12
}

// Shared IWAA engine (loanCalc)
function computeIWAA(borrowers: Borrower[]): number {
    return incomeWeightedAge(
        borrowers.map(b => ({ age: parseInt(b.age) || 0, monthlyIncome: effectiveIncome(b) })),
        { roundUp: true, zeroIncomeFallback: 'simple-average' },
    ) ?? 0
}

function pvCalc(months: number, payment: number): number {
    const r = STRESS_RATE / 12 / 100
    if (r === 0 || months <= 0) return payment * months
    return payment * (1 - Math.pow(1 + r, -months)) / r
}

function fmt(n: number): string {
    return Math.round(n).toLocaleString('en-SG')
}

function defaultBorrower(): Borrower {
    return { employment: 'employed', monthlyBasic: '', annualVariable: '', annualNOA: '', age: '', monthlyLiabilities: '' }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const inp = 'px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#059669] focus:ring-2 focus:ring-[#059669]/10 bg-white transition-colors w-full'

function moneyChangeHandler(setter: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setter(formatMoneyInput(e.target.value))
}

// ── Seg component ─────────────────────────────────────────────────────────────

function Seg<T extends string>({ options, value, onChange }: {
    options: { value: T; label: string }[]
    value: T
    onChange: (v: T) => void
}) {
    return (
        <div className="inline-flex rounded-xl border border-slate-200 overflow-hidden">
            {options.map(o => (
                <button
                    key={o.value}
                    type="button"
                    onClick={() => onChange(o.value)}
                    className={`px-4 py-2 text-sm font-semibold transition-colors border-r border-slate-200 last:border-r-0 whitespace-nowrap ${
                        value === o.value
                            ? 'bg-[#052d4a] text-white'
                            : 'bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    )
}

// ── Borrower card ─────────────────────────────────────────────────────────────

function BorrowerCard({ index, data, onChange }: {
    index: number
    data: Borrower
    onChange: (d: Borrower) => void
}) {
    const set = (field: keyof Borrower) => (val: string) => onChange({ ...data, [field]: val })
    const setMoney = (field: keyof Borrower) => moneyChangeHandler(set(field))

    return (
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs font-black text-slate-500 uppercase tracking-wider">
                    Borrower {index + 1}
                </span>
                <Seg<Employment>
                    options={[
                        { value: 'employed',    label: 'Employed' },
                        { value: 'selfEmployed', label: 'Self-employed' },
                    ]}
                    value={data.employment}
                    onChange={employment => onChange({ ...data, employment })}
                />
            </div>

            <div className="grid grid-cols-2 gap-3">
                {data.employment === 'employed' ? (
                    <>
                        <div>
                            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                Monthly Basic Pay
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">$</span>
                                <input
                                    type="text"
                                    value={data.monthlyBasic}
                                    onChange={setMoney('monthlyBasic')}
                                    className={`${inp} pl-6`}
                                    placeholder="5,000"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                Annual Variable Pay <span className="font-normal normal-case">(optional)</span>
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">$</span>
                                <input
                                    type="text"
                                    value={data.annualVariable}
                                    onChange={setMoney('annualVariable')}
                                    className={`${inp} pl-6 border-dashed`}
                                    placeholder="20,000"
                                />
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="col-span-2">
                        <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                            Annual NOA Income
                        </label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">$</span>
                            <input
                                type="text"
                                value={data.annualNOA}
                                onChange={setMoney('annualNOA')}
                                className={`${inp} pl-6`}
                                placeholder="120,000"
                            />
                        </div>
                    </div>
                )}

                <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Age</label>
                    <input
                        type="number"
                        value={data.age}
                        onChange={e => onChange({ ...data, age: e.target.value })}
                        onBlur={e => {
                            const v = parseInt(e.target.value)
                            if (!isNaN(v) && v > 0) {
                                if (v < 21) onChange({ ...data, age: '21' })
                                else if (v > 75) onChange({ ...data, age: '75' })
                            }
                        }}
                        className={inp}
                        placeholder="35"
                        min={21}
                        max={75}
                    />
                </div>

                <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                        Monthly Liabilities <span className="font-normal normal-case">(optional)</span>
                    </label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">$</span>
                        <input
                            type="text"
                            value={data.monthlyLiabilities}
                            onChange={setMoney('monthlyLiabilities')}
                            className={`${inp} pl-6 border-dashed`}
                            placeholder="e.g. 1,400 car loan"
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}

// ── Loan option card ──────────────────────────────────────────────────────────

function LoanOptionCard({
    label, maxAge, maxTen, loan, tenure, onTenureChange, bindingLabel, payment, na, cashNote, purchase,
}: {
    label: string
    maxAge: number
    maxTen: number
    loan: number
    tenure: number
    onTenureChange: (t: number) => void
    bindingLabel: string
    payment: number
    na: boolean
    cashNote: string
    purchase: PurchaseBreakdown | null
}) {
    return (
        <div className={`card overflow-hidden transition-opacity ${na ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div>
                    <p className="text-xs font-black text-[#052d4a] uppercase tracking-wider">{label}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Max age {maxAge} · Up to {maxTen} yrs</p>
                    <p className="text-[11px] font-semibold text-amber-600 mt-0.5">{cashNote}</p>
                </div>
                {na && (
                    <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                        Not applicable
                    </span>
                )}
            </div>
            <div className="p-5 space-y-5">
                <div>
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Loan Eligibility</p>
                    <p className="text-4xl font-black text-[#052d4a] mt-1.5 tracking-tight">
                        {na ? '—' : `$${fmt(loan)}`}
                    </p>
                    {!na && (
                        <p className="text-xs text-slate-400 mt-1.5">
                            {bindingLabel} · ${fmt(payment)}/mth · {tenure} yrs @ {STRESS_RATE}% stress
                        </p>
                    )}
                </div>

                {!na && (
                    <div>
                        <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                            Adjust Tenure (5 – {maxTen} yrs)
                        </label>
                        <div className="flex items-center gap-2.5">
                            <button
                                type="button"
                                onClick={() => onTenureChange(Math.max(5, tenure - 1))}
                                disabled={tenure <= 5}
                                className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors shrink-0"
                            >
                                <Minus size={13} />
                            </button>
                            <input
                                type="number"
                                value={tenure}
                                min={5}
                                max={maxTen}
                                onChange={e => {
                                    const v = parseInt(e.target.value)
                                    if (!isNaN(v)) onTenureChange(Math.min(maxTen, Math.max(5, v)))
                                }}
                                className="w-14 text-center text-sm font-bold text-[#052d4a] border border-slate-200 rounded-lg py-1.5 outline-none focus:border-[#059669]"
                            />
                            <span className="text-xs text-slate-400 shrink-0">yrs</span>
                            <button
                                type="button"
                                onClick={() => onTenureChange(Math.min(maxTen, tenure + 1))}
                                disabled={tenure >= maxTen}
                                className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors shrink-0"
                            >
                                <Plus size={13} />
                            </button>
                            {tenure < maxTen && (
                                <button
                                    type="button"
                                    onClick={() => onTenureChange(maxTen)}
                                    className="text-xs text-[#059669] hover:underline shrink-0 ml-1"
                                >
                                    Max
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {!na && purchase && <MaxPurchaseBreakdown b={purchase} accent="#059669" />}
            </div>
        </div>
    )
}

// ── Page ──────────────────────────────────────────────────────────────────────

function AffordabilityCalculator() {
    const [numBorrowers, setNumBorrowers] = useCalcDraft('numBorrowers', 1)
    const [borrowers,    setBorrowers]   = useCalcDraft<Borrower[]>('borrowers', [defaultBorrower()])
    const [propertyType, setPropertyType] = useCalcDraft<PropertyType>('propertyType', 'private')
    const [adjTenure1,   setAdjTenure1]  = useState<number | null>(null)
    const [adjTenure2,   setAdjTenure2]  = useState<number | null>(null)
    // ABSD profile for the purchase-price breakdown — highest-rate buyer on the purchase
    const [residency,     setResidency]     = useCalcDraft<Residency>('residency', 'singaporean')
    const [propertyCount, setPropertyCount] = useCalcDraft<1 | 2 | 3>('propertyCount', 1)

    // Sync borrower array length
    useEffect(() => {
        setBorrowers(prev => {
            const next = [...prev]
            while (next.length < numBorrowers) next.push(defaultBorrower())
            return next.slice(0, numBorrowers)
        })
    }, [numBorrowers, setBorrowers])

    const liab        = useMemo(() => borrowers.reduce((s, b) => s + parseMoney(b.monthlyLiabilities), 0), [borrowers])
    const totalIncome = useMemo(() => borrowers.reduce((s, b) => s + effectiveIncome(b), 0), [borrowers])
    const iwaa        = useMemo(() => computeIWAA(borrowers), [borrowers])

    const tdsrAvail = Math.max(totalIncome * TDSR_LIMIT - liab, 0)
    const msrAvail  = totalIncome * MSR_LIMIT
    const usesMSR   = propertyType !== 'private'
    const binding   = usesMSR ? Math.min(tdsrAvail, msrAvail) : tdsrAvail
    const bindingIsMSR = usesMSR && msrAvail < tdsrAvail

    const opts  = PROP_OPTS[propertyType]
    const maxTen1 = Math.max(0, Math.min(opts.opt1.maxAge - iwaa, opts.opt1.maxTen))
    const maxTen2 = Math.max(0, Math.min(opts.opt2.maxAge - iwaa, opts.opt2.maxTen))

    // Reset tenures when max changes (property type or IWAA change)
    useEffect(() => { setAdjTenure1(maxTen1 > 0 ? maxTen1 : null) }, [maxTen1])
    useEffect(() => { setAdjTenure2(maxTen2 > 0 ? maxTen2 : null) }, [maxTen2])

    const ten1 = adjTenure1 ?? maxTen1
    const ten2 = adjTenure2 ?? maxTen2

    const loan1 = maxTen1 > 0 && binding > 0 ? pvCalc(ten1 * 12, binding) : 0
    const loan2 = maxTen2 > 0 && binding > 0 ? pvCalc(ten2 * 12, binding) : 0

    const hasIncome = totalIncome > 0

    const [o1, o2] = OPTION_MATRIX['0']
    const purchaseArgs = { propertyType: FEE_TYPE[propertyType], residency, propertyCount }
    const purchase1 = maxPurchaseFromLoan({ loan: loan1, option: o1, ...purchaseArgs })
    const purchase2 = maxPurchaseFromLoan({ loan: loan2, option: o2, ...purchaseArgs })

    const updateBorrower = useCallback((i: number, data: Borrower) => {
        setBorrowers(prev => prev.map((b, idx) => idx === i ? data : b))
    }, [setBorrowers])

    const bindingLabel = bindingIsMSR ? 'MSR 30%' : 'TDSR 55%'

    return (
        <div className="max-w-5xl mx-auto space-y-6">

            {/* Header */}
            <div>
                <Link
                    href="/property/calculators"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-600 mb-3 transition-colors"
                >
                    <ArrowLeft size={13} /> Calculators
                </Link>
                <h1 className="ios-page-title flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                        <BarChart3 size={18} className="text-[#059669]" />
                    </span>
                    Affordability
                    <CalculatorResetButton className="ml-auto" />
                </h1>
                <p className="page-subtitle mt-1">
                    Loan eligibility from income, IWAA and property type. Stress-tested at {STRESS_RATE}%.
                </p>
            </div>

            {/* Input card */}
            <div className="card overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                    <h3 className="section-label mb-0">Borrower Details</h3>
                </div>
                <div className="p-6 space-y-6">

                    {/* Number of borrowers */}
                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                            Number of Borrowers
                        </label>
                        <Seg<'1' | '2' | '3' | '4'>
                            options={[
                                { value: '1', label: 'Single' },
                                { value: '2', label: 'Joint (2)' },
                                { value: '3', label: 'Joint (3)' },
                                { value: '4', label: 'Joint (4)' },
                            ]}
                            value={String(numBorrowers) as '1' | '2' | '3' | '4'}
                            onChange={v => setNumBorrowers(parseInt(v))}
                        />
                    </div>

                    {/* Per-borrower income cards */}
                    <div className={`grid gap-4 ${numBorrowers >= 2 ? 'sm:grid-cols-2' : 'grid-cols-1 max-w-lg'}`}>
                        {borrowers.map((b, i) => (
                            <BorrowerCard key={i} index={i} data={b} onChange={d => updateBorrower(i, d)} />
                        ))}
                    </div>

                    {/* Property type */}
                    <div className="pt-2 border-t border-slate-100">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                            Property Type
                        </label>
                        <Seg<PropertyType>
                            options={[
                                { value: 'hdb',     label: 'HDB' },
                                { value: 'private', label: 'Private' },
                                { value: 'ec',      label: 'EC New Launch' },
                            ]}
                            value={propertyType}
                            onChange={setPropertyType}
                        />
                    </div>

                    {/* ABSD profile — drives the stamp duty in the purchase-price breakdown */}
                    <div className="flex flex-wrap gap-x-8 gap-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                                Buyer Residency <span className="font-normal normal-case text-slate-400">(for ABSD)</span>
                            </label>
                            <Seg<Residency>
                                options={[
                                    { value: 'singaporean', label: 'Citizen' },
                                    { value: 'pr',          label: 'PR' },
                                    { value: 'foreigner',   label: 'Foreigner' },
                                ]}
                                value={residency}
                                onChange={setResidency}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                                This Purchase Is
                            </label>
                            <Seg<'1' | '2' | '3'>
                                options={[
                                    { value: '1', label: '1st property' },
                                    { value: '2', label: '2nd' },
                                    { value: '3', label: '3rd+' },
                                ]}
                                value={String(propertyCount) as '1' | '2' | '3'}
                                onChange={v => setPropertyCount(parseInt(v) as 1 | 2 | 3)}
                            />
                        </div>
                    </div>
                    {numBorrowers > 1 && (
                        <p className="text-[11px] text-slate-400 -mt-3">Joint purchase: pick the buyer with the highest ABSD rate.</p>
                    )}
                </div>
            </div>

            {/* Results */}
            {hasIncome && (
                <div className="space-y-4">

                    {/* Income summary */}
                    <div className="card overflow-hidden">
                        <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-5">
                            <div>
                                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Eff. Income</p>
                                <p className="text-xl font-black text-[#052d4a] mt-1">${fmt(totalIncome)}</p>
                                <p className="text-[11px] text-slate-400">per month</p>
                            </div>
                            <div>
                                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">IWAA</p>
                                <p className="text-xl font-black text-[#052d4a] mt-1">{iwaa} yrs</p>
                                <p className="text-[11px] text-slate-400">income-weighted avg age</p>
                            </div>
                            <div>
                                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">TDSR Available</p>
                                <p className={`text-xl font-black mt-1 ${!bindingIsMSR ? 'text-[#052d4a]' : 'text-slate-400'}`}>
                                    ${fmt(tdsrAvail)}
                                </p>
                                <p className="text-[11px] text-slate-400">55% × income – liabilities</p>
                            </div>
                            <div>
                                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">MSR Available</p>
                                <p className={`text-xl font-black mt-1 ${usesMSR && bindingIsMSR ? 'text-[#052d4a]' : 'text-slate-400'}`}>
                                    ${fmt(msrAvail)}
                                </p>
                                <p className="text-[11px] text-slate-400">
                                    {usesMSR ? '30% × income' : 'N/A for private'}
                                </p>
                            </div>
                        </div>

                        {/* Binding constraint banner */}
                        <div className={`px-5 py-3 border-t text-xs font-semibold flex items-center gap-2 ${
                            usesMSR && !bindingIsMSR
                                ? 'bg-amber-50 border-amber-100 text-amber-700'
                                : 'bg-emerald-50 border-emerald-100 text-emerald-700'
                        }`}>
                            <span className="font-black text-sm">→</span>
                            {usesMSR && !bindingIsMSR
                                ? `TDSR is binding (${bindingLabel}) — using $${fmt(tdsrAvail)}/mth for loan eligibility`
                                : usesMSR
                                    ? `MSR is binding (${bindingLabel}) — using $${fmt(msrAvail)}/mth for loan eligibility`
                                    : `Using TDSR available — $${fmt(tdsrAvail)}/mth for loan eligibility`
                            }
                        </div>
                    </div>

                    {/* Loan option cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <LoanOptionCard
                            label="Option 1"
                            maxAge={opts.opt1.maxAge}
                            maxTen={maxTen1}
                            loan={loan1}
                            tenure={ten1}
                            onTenureChange={t => setAdjTenure1(t)}
                            bindingLabel={bindingLabel}
                            payment={binding}
                            na={maxTen1 <= 0}
                            cashNote="Min 5% Cash Downpayment"
                            purchase={purchase1}
                        />
                        <LoanOptionCard
                            label="Option 2"
                            maxAge={opts.opt2.maxAge}
                            maxTen={maxTen2}
                            loan={loan2}
                            tenure={ten2}
                            onTenureChange={t => setAdjTenure2(t)}
                            bindingLabel={bindingLabel}
                            payment={binding}
                            na={maxTen2 <= 0}
                            cashNote="Min 10% Cash Downpayment"
                            purchase={purchase2}
                        />
                    </div>
                </div>
            )}
        </div>
    )
}

export default function PropertyAffordabilityPage() {
    return (
        <PropertyPremiumGate>
            <CalculatorDraftScope id="affordability">
                <AffordabilityCalculator />
            </CalculatorDraftScope>
        </PropertyPremiumGate>
    )
}
