'use client'

import { useMemo } from 'react'
import { CalculatorDraftScope, CalculatorResetButton, useCalcDraft } from '@/lib/calculators/draft'
import Link from 'next/link'
import { ArrowLeft, Receipt, Minus, Plus } from 'lucide-react'
import { formatMoneyInput } from '@/lib/utils/formatCurrency'
import { computeBsdBreakdown, absdRate, worstResidency, type Residency } from '@/lib/insurance/stampDuty'

// BSD tiers + ABSD rate ladder come from lib/insurance/stampDuty.ts — the same
// source the purchase and decoupling workflow engines compute from, so this
// calculator can never disagree with a workflow.

const computeBSD = computeBsdBreakdown

// ── ABSD engine ────────────────────────────────────────────────────────────────

type PurchaseType = 'single' | 'jointMarried' | 'jointOther'
type Status = 'sc' | 'pr' | 'foreigner'

const toResidency = (s: Status): Residency => (s === 'sc' ? 'singaporean' : s)
const countFor = (existing: number): 1 | 2 | 3 => (existing <= 0 ? 1 : existing === 1 ? 2 : 3)

function computeABSD(
    value: number,
    purchaseType: PurchaseType,
    yourStatus: Status,
    partnerStatus: Status,
    existingCount: number,
): { rate: number; amount: number } {
    let rate = 0
    const count = countFor(existingCount)

    if (purchaseType === 'single') {
        rate = absdRate(toResidency(yourStatus), count)
    } else if (purchaseType === 'jointMarried') {
        // SC + PR/Foreigner married couple: first-property remission applies
        const mixedWithSC =
            (yourStatus === 'sc' && partnerStatus !== 'sc') ||
            (partnerStatus === 'sc' && yourStatus !== 'sc')

        if (mixedWithSC) {
            if (existingCount === 0) {
                rate = 0   // remission — treated as SC first property
            } else {
                const hasForeigner = yourStatus === 'foreigner' || partnerStatus === 'foreigner'
                rate = hasForeigner ? absdRate('foreigner', count) : absdRate('pr', count)
            }
        } else {
            rate = absdRate(worstResidency([toResidency(yourStatus), toResidency(partnerStatus)]), count)
        }
    } else {
        // Joint (not married) — worst status applies
        rate = absdRate(worstResidency([toResidency(yourStatus), toResidency(partnerStatus)]), count)
    }

    return { rate, amount: Math.round(value * rate) }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
    return Math.round(n).toLocaleString('en-SG')
}

function ordinalLabel(n: number): string {
    if (n === 1) return '1st property'
    if (n === 2) return '2nd property'
    if (n === 3) return '3rd property'
    return `${n}th property`
}

const inp = 'px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/10 bg-white transition-colors w-full'

// ── Segmented button group ─────────────────────────────────────────────────────

function PurchaseBtns({ value, onChange }: { value: PurchaseType; onChange: (v: PurchaseType) => void }) {
    const opts: { value: PurchaseType; label: string }[] = [
        { value: 'single',       label: 'Single Buyer' },
        { value: 'jointMarried', label: 'Joint (Married)' },
        { value: 'jointOther',   label: 'Joint (Other)' },
    ]
    return (
        <div className="inline-flex rounded-xl border border-slate-200 overflow-hidden">
            {opts.map(o => (
                <button key={o.value} type="button" onClick={() => onChange(o.value)}
                    className={`px-4 py-2 text-sm font-semibold transition-colors border-r border-slate-200 last:border-r-0 ${
                        value === o.value ? 'bg-[#052d4a] text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    )
}

function StatusBtns({ value, onChange }: { value: Status; onChange: (v: Status) => void }) {
    const opts: { value: Status; label: string }[] = [
        { value: 'sc',        label: 'SC' },
        { value: 'pr',        label: 'PR' },
        { value: 'foreigner', label: 'Foreigner' },
    ]
    return (
        <div className="inline-flex rounded-xl border border-slate-200 overflow-hidden">
            {opts.map(o => (
                <button key={o.value} type="button" onClick={() => onChange(o.value)}
                    className={`px-4 py-2 text-sm font-semibold transition-colors border-r border-slate-200 last:border-r-0 ${
                        value === o.value ? 'bg-[#052d4a] text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    )
}

// ── Page ───────────────────────────────────────────────────────────────────────

function StampDutyCalculator() {
    const [propertyValue, setPropertyValue] = useCalcDraft('propertyValue', '1,000,000')
    const [purchaseType, setPurchaseType] = useCalcDraft<PurchaseType>('purchaseType', 'single')
    const [yourStatus, setYourStatus]     = useCalcDraft<Status>('yourStatus', 'sc')
    const [partnerStatus, setPartnerStatus] = useCalcDraft<Status>('partnerStatus', 'sc')
    const [existingCount, setExistingCount] = useCalcDraft('existingCount', 0)

    const value   = parseFloat(propertyValue.replace(/,/g, '')) || 0
    const isJoint = purchaseType !== 'single'

    const result = useMemo(() => {
        if (value < 100000) return null
        const bsd  = computeBSD(value)
        const absd = computeABSD(value, purchaseType, yourStatus, isJoint ? partnerStatus : 'sc', existingCount)
        return { bsd, absd, total: Math.round(bsd.total) + absd.amount }
    }, [value, purchaseType, yourStatus, partnerStatus, existingCount, isJoint])

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
                    <span className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                        <Receipt size={18} className="text-amber-600" />
                    </span>
                    Stamp Duty Calculator
                    <CalculatorResetButton className="ml-auto" />
                </h1>
                <p className="page-subtitle mt-1">Compute BSD and ABSD for your Singapore property purchase.</p>
            </div>

            {/* Top grid: inputs + summary */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

                {/* Inputs */}
                <div className="lg:col-span-2 card overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100">
                        <h3 className="section-label mb-0">Buyer Details</h3>
                    </div>
                    <div className="p-6 space-y-6">

                        {/* Property value */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                Property Value / Purchase Price
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">$</span>
                                <input
                                    type="text"
                                    value={propertyValue}
                                    onChange={e => setPropertyValue(formatMoneyInput(e.target.value))}
                                    className={`${inp} pl-7`}
                                    placeholder="1,000,000"
                                />
                            </div>
                            {value > 0 && value < 100000 && (
                                <p className="text-xs text-red-500 mt-1.5">Minimum property value is $100,000.</p>
                            )}
                        </div>

                        {/* Purchase type */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                                Purchase Type
                            </label>
                            <PurchaseBtns value={purchaseType} onChange={setPurchaseType} />
                        </div>

                        {/* Status */}
                        <div className={`grid gap-4 ${isJoint ? 'grid-cols-2' : 'grid-cols-1'}`}>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                                    {isJoint ? 'Your Status' : 'Citizenship Status'}
                                </label>
                                <StatusBtns value={yourStatus} onChange={setYourStatus} />
                            </div>
                            {isJoint && (
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                                        Partner's Status
                                    </label>
                                    <StatusBtns value={partnerStatus} onChange={setPartnerStatus} />
                                </div>
                            )}
                        </div>

                        {/* Properties owned counter */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                                Residential Properties Currently Owned
                            </label>
                            <p className="text-xs text-slate-400 mb-3">
                                {isJoint ? 'Combined property count for all buyers prior to this purchase. Do not include properties that will be sold.' : 'Do not include properties that will be sold.'}
                            </p>
                            <div className="flex items-center gap-4">
                                <button
                                    type="button"
                                    onClick={() => setExistingCount(c => Math.max(0, c - 1))}
                                    disabled={existingCount === 0}
                                    className="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors"
                                >
                                    <Minus size={16} />
                                </button>
                                <span className="text-2xl font-black text-[#052d4a] w-8 text-center tabular-nums">
                                    {existingCount}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setExistingCount(c => Math.min(10, c + 1))}
                                    disabled={existingCount === 10}
                                    className="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors"
                                >
                                    <Plus size={16} />
                                </button>
                                <div className="inline-flex items-center gap-1.5 border border-amber-300 bg-amber-50 rounded-lg px-3 py-1.5 text-sm">
                                    <span className="text-amber-600">→</span>
                                    <span className="text-slate-500">
                                        {existingCount === 1 ? '1 property' : `${existingCount} properties`} owned currently, buying{' '}
                                        <span className="font-bold text-[#052d4a]">{ordinalLabel(existingCount + 1)}</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Summary cards */}
                <div className="flex flex-col gap-3">
                    {result ? (
                        <>
                            {/* Total */}
                            <div
                                className="card overflow-hidden"
                                style={{ background: 'linear-gradient(135deg, #052d4a 0%, #0a4a7a 100%)', border: 'none' }}
                            >
                                <div className="p-5">
                                    <p className="text-[11px] font-semibold text-sky-300 uppercase tracking-wider">
                                        Total Stamp Duty
                                    </p>
                                    <p className="text-3xl font-black text-white mt-1.5 tracking-tight">
                                        ${fmt(result.total)}
                                    </p>
                                    <p className="text-xs text-sky-200/70 mt-2">
                                        {((result.total / value) * 100).toFixed(2)}% of property value
                                    </p>
                                </div>
                            </div>

                            {/* BSD */}
                            <div className="card p-4">
                                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                                    Buyer's Stamp Duty (BSD)
                                </p>
                                <p className="text-xl font-bold text-[#052d4a] mt-0.5">
                                    ${fmt(result.bsd.total)}
                                </p>
                            </div>

                            {/* ABSD */}
                            <div className="card p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                                            Additional BSD (ABSD)
                                        </p>
                                        <p className={`text-xl font-bold mt-0.5 ${result.absd.rate > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                            {result.absd.rate > 0 ? `$${fmt(result.absd.amount)}` : 'Not applicable'}
                                        </p>
                                    </div>
                                    <span className={`text-sm font-black px-3 py-1 rounded-full shrink-0 ${
                                        result.absd.rate > 0
                                            ? 'bg-red-50 text-red-500'
                                            : 'bg-emerald-50 text-emerald-600'
                                    }`}>
                                        {(result.absd.rate * 100).toFixed(0)}%
                                    </span>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="card p-5 text-center">
                            <p className="text-xs text-slate-400">
                                Enter a property value of at least $100,000 to compute stamp duty.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* BSD breakdown table */}
            {result && (
                <div className="card overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="section-label mb-0">BSD Tier Breakdown</h3>
                        <span className="text-[11px] text-slate-400">Progressive rates on purchase price</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="px-6 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Tier</th>
                                    <th className="px-6 py-3 text-center text-[11px] font-bold text-slate-500 uppercase tracking-wider">Rate</th>
                                    <th className="px-6 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">Taxable Amount</th>
                                    <th className="px-6 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">BSD</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.bsd.tiers.map((tier, i) => (
                                    <tr key={i} className={`border-b border-slate-50 ${i % 2 === 1 ? 'bg-slate-50/40' : ''}`}>
                                        <td className="px-6 py-3.5 text-slate-600 font-medium">{tier.label}</td>
                                        <td className="px-6 py-3.5 text-center">
                                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-sky-50 text-[#03a9e7]">
                                                {(tier.rate * 100).toFixed(0)}%
                                            </span>
                                        </td>
                                        <td className="px-6 py-3.5 text-right text-slate-600">${fmt(tier.taxable)}</td>
                                        <td className="px-6 py-3.5 text-right font-semibold text-slate-700">${fmt(tier.amount)}</td>
                                    </tr>
                                ))}
                                <tr className="bg-slate-50 border-t-2 border-slate-200">
                                    <td className="px-6 py-3 font-black text-slate-600 text-xs uppercase tracking-wider" colSpan={3}>
                                        Total BSD
                                    </td>
                                    <td className="px-6 py-3 text-right font-black text-[#052d4a] text-base">
                                        ${fmt(result.bsd.total)}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}

export default function StampDutyPage() {
    return (
        <CalculatorDraftScope id="stamp-duty">
            <StampDutyCalculator />
        </CalculatorDraftScope>
    )
}
