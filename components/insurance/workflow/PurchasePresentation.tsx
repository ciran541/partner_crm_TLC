'use client'

import { ReactNode, useEffect } from 'react'
import type { PurchaseComputation, OptionResult, PurchasePropertyType } from '@/lib/insurance/purchaseCalc'
import type { PurchaseRemarks } from '@/lib/insurance/purchaseRemarks'
import type { ProposalPackage } from '@/lib/insurance/purchaseProposal'
import { buildPresentationHtml } from '@/lib/insurance/purchasePresentation'
import { formatRateSchedule } from '@/lib/insurance/rateSchedule'
import { X, Printer, MessageSquare, Home, Wallet, Lightbulb, AlertTriangle, Sparkles, ShieldCheck } from 'lucide-react'

interface Props {
    clientName?: string
    propertyLabel: string
    propertyType?: PurchasePropertyType
    price: number
    referenceRate?: number
    computation: PurchaseComputation
    remarks: PurchaseRemarks
    selectedPackage?: ProposalPackage | null
    onClose: () => void
    onOpenChatSummary: () => void
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`
const pct = (frac: number) => {
    const v = frac * 100
    return Number.isInteger(v) ? `${v}%` : `${v.toFixed(2)}%`
}

export default function PurchasePresentation({
    clientName, propertyLabel, price, referenceRate, computation, remarks, selectedPackage,
    onClose, onOpenChatSummary,
}: Props) {
    // Close on Escape
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        // Lock background scroll while presenting
        const prev = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
    }, [onClose])

    const print = () => {
        const html = buildPresentationHtml({ clientName, propertyLabel, price, referenceRate, computation, remarks, selectedPackage })
        const w = window.open('', '_blank', 'width=900,height=1000')
        if (!w) return
        w.document.write(html)
        w.document.close()
        w.focus()
    }

    const today = new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })
    const feesTotal = computation.bsd + computation.absd + computation.legalFee + computation.valuationFee
    const allRemarks = [...remarks.standard, ...remarks.propertyType]

    return (
        <div className="fixed inset-0 z-[120] bg-slate-100 overflow-y-auto">
            {/* Control bar — not part of the presentation */}
            <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[#052d4a] flex items-center gap-2">
                    <Sparkles size={15} className="text-[#03a9e7]" /> Client presentation
                    <span className="hidden sm:inline text-xs font-normal text-slate-400">— show this to your client</span>
                </p>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={onOpenChatSummary}
                        className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 flex items-center gap-1.5">
                        <MessageSquare size={14} /> <span className="hidden sm:inline">Chat summary</span>
                    </button>
                    <button type="button" onClick={print}
                        className="text-sm px-3 py-1.5 rounded-lg bg-[#052d4a] text-white font-semibold hover:bg-[#063a5e] flex items-center gap-1.5">
                        <Printer size={14} /> <span className="hidden sm:inline">Print / Save PDF</span>
                    </button>
                    <button type="button" onClick={onClose} aria-label="Close presentation"
                        className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* The presentation sheet */}
            <div className="max-w-4xl mx-auto px-4 sm:px-8 py-8 sm:py-12">
                <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                    {/* Cover */}
                    <div className="bg-gradient-to-br from-[#052d4a] to-[#0a4a78] text-white px-7 sm:px-10 py-8 sm:py-10">
                        <p className="text-[#7dd3fc] text-xs font-semibold uppercase tracking-[0.18em] mb-2">Home Financing Plan</p>
                        <h1 className="text-2xl sm:text-3xl font-bold leading-tight">
                            {clientName ? <>Prepared for {clientName}</> : 'Your mortgage summary'}
                        </h1>
                        <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
                            <CoverStat icon={<Home size={15} />} label="Property" value={propertyLabel} />
                            <CoverStat icon={<Wallet size={15} />} label="Purchase price" value={money(price)} />
                            {computation.weightedAge ? <CoverStat label="Avg. age" value={String(computation.weightedAge)} /> : null}
                            <CoverStat label="Date" value={today} />
                        </div>
                    </div>

                    <div className="px-7 sm:px-10 py-8 sm:py-10 space-y-10">
                        {/* Financing options */}
                        <Block title="Your financing options" subtitle="Two ways the bank can structure the loan — we'll choose what fits your cash flow.">
                            <div className={`grid gap-5 ${computation.options.length > 1 ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}>
                                {computation.options.map(opt => <OptionPanel key={opt.key} opt={opt} />)}
                            </div>
                        </Block>

                        {/* Recommended package */}
                        {selectedPackage?.bank && (
                            <Block title="Recommended package" subtitle="The bank package best matched to this loan.">
                                <PackagePanel pkg={selectedPackage} />
                            </Block>
                        )}

                        {/* Upfront costs */}
                        <Block title="Upfront costs" subtitle="One-time costs payable on purchase, separate from your downpayment.">
                            <div className="rounded-xl border border-slate-200 overflow-hidden">
                                <CostRow label="Buyer's Stamp Duty (BSD)" value={money(computation.bsd)} />
                                <CostRow
                                    label={`Additional Buyer's Stamp Duty (ABSD${computation.absdRatePct ? ` · ${computation.absdRatePct % 1 === 0 ? computation.absdRatePct : computation.absdRatePct.toFixed(1)}%` : ''})`}
                                    value={money(computation.absd)}
                                />
                                <CostRow label="Legal fee (est.)" value={money(computation.legalFee)} />
                                <CostRow label="Valuation fee (est.)" value={money(computation.valuationFee)} />
                                <CostRow label="Total stamp duty & fees" value={money(feesTotal)} grand />
                            </div>
                        </Block>

                        {/* Key things to note */}
                        {(remarks.alerts.length > 0 || allRemarks.length > 0) && (
                            <Block title="Key things to note" subtitle="The important points to keep in mind for this purchase.">
                                <div className="space-y-3">
                                    {remarks.alerts.map((a, i) => (
                                        <div key={`a${i}`} className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                                            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                                            <p className="text-sm text-amber-800 leading-relaxed">{a}</p>
                                        </div>
                                    ))}
                                    {allRemarks.length > 0 && (
                                        <ul className="space-y-3.5">
                                            {allRemarks.map((r, i) => (
                                                <li key={i} className="flex items-start gap-3">
                                                    <span className="mt-1 shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#03a9e7]/10">
                                                        <Lightbulb size={12} className="text-[#03a9e7]" />
                                                    </span>
                                                    <p className="text-[15px] text-slate-700 leading-relaxed">{r}</p>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </Block>
                        )}

                        {/* Disclaimer */}
                        <div className="flex items-start gap-2.5 pt-2 border-t border-slate-100 text-xs text-slate-400 leading-relaxed">
                            <ShieldCheck size={14} className="shrink-0 mt-0.5" />
                            <p>
                                All figures are estimates for discussion only and are subject to the bank&apos;s formal assessment and approval.
                                Stamp duties follow prevailing IRAS rates.
                                {referenceRate ? ` Monthly instalments are estimated at ${referenceRate}% p.a.` : ''}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function CoverStat({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
    return (
        <div>
            <p className="text-[11px] uppercase tracking-wide text-white/55 flex items-center gap-1.5">{icon}{label}</p>
            <p className="text-base font-semibold mt-0.5">{value}</p>
        </div>
    )
}

function Block({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
    return (
        <section>
            <h2 className="text-lg font-bold text-[#052d4a]">{title}</h2>
            {subtitle && <p className="text-sm text-slate-500 mt-0.5 mb-4">{subtitle}</p>}
            {!subtitle && <div className="mb-4" />}
            {children}
        </section>
    )
}

function OptionPanel({ opt }: { opt: OptionResult }) {
    const downTotal = opt.minCashDown + opt.cashCpfDown
    return (
        <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <div className="bg-[#052d4a] text-white px-5 py-3.5">
                <p className="text-base font-bold">Option {opt.key}</p>
                <p className="text-xs text-white/70">{pct(opt.ltvPct)} LTV · tenure up to age {opt.ageCap}</p>
            </div>
            <div className="px-5 py-4">
                <p className="text-3xl font-extrabold text-[#03a9e7] leading-none">{money(opt.finalLoan)}</p>
                <p className="text-[11px] uppercase tracking-wide text-slate-400 mt-1">Maximum bank loan</p>
                <dl className="mt-4 divide-y divide-slate-100">
                    <PanelRow label="Loan tenure" value={`${opt.tenure} years`} />
                    <PanelRow label="Est. monthly instalment" value={money(opt.installment)} />
                    <PanelRow label={`Minimum cash (${pct(opt.minCashPct)})`} value={money(opt.minCashDown)} />
                    <PanelRow label={`Balance cash / CPF (${pct(opt.cashCpfPct)})`} value={money(opt.cashCpfDown)} />
                    <PanelRow label="Total downpayment" value={money(downTotal)} strong />
                </dl>
                {opt.pledge && (
                    <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 leading-relaxed">
                        To reach the full {pct(opt.ltvPct)}, either pledge <b>{money(opt.pledge.pledgeFund)}</b> (locked 4 yrs) or show <b>{money(opt.pledge.showFund)}</b> in funds.
                    </div>
                )}
            </div>
        </div>
    )
}

function PanelRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-sm text-slate-500">{label}</dt>
            <dd className={`text-sm shrink-0 ${strong ? 'font-bold text-[#052d4a] text-base' : 'font-semibold text-slate-800'}`}>{value}</dd>
        </div>
    )
}

function CostRow({ label, value, grand }: { label: string; value: string; grand?: boolean }) {
    return (
        <div className={`flex items-center justify-between gap-3 px-5 py-3.5 ${grand ? 'bg-slate-50 border-t-2 border-[#052d4a]' : 'border-b border-slate-100'}`}>
            <span className={`text-sm ${grand ? 'font-bold text-[#052d4a]' : 'text-slate-600'}`}>{label}</span>
            <span className={`shrink-0 ${grand ? 'text-lg font-extrabold text-[#052d4a]' : 'text-sm font-semibold text-slate-800'}`}>{value}</span>
        </div>
    )
}

function PackagePanel({ pkg }: { pkg: ProposalPackage }) {
    const header = `${pkg.bank ?? ''}${pkg.category ? ` · ${pkg.category}` : ''}${pkg.lockin_years ? ` · ${pkg.lockin_years}-year lock-in` : ' · No lock-in'}`
    const sched = pkg.rate_schedule?.length ? formatRateSchedule(pkg.rate_schedule) : (pkg.year1_rate != null ? [`Year 1: ${pkg.year1_rate.toFixed(2)}%`] : [])
    return (
        <div className="rounded-2xl border border-slate-200 border-l-4 border-l-[#03a9e7] px-5 sm:px-6 py-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                    <p className="text-base font-bold text-[#052d4a]">{header}</p>
                    {pkg.package_name && <p className="text-sm text-slate-500 mt-0.5">{pkg.package_name}</p>}
                </div>
                {pkg.projected_monthly != null && (
                    <div className="text-right">
                        <p className="text-2xl font-extrabold text-[#03a9e7] leading-none">{money(pkg.projected_monthly)}</p>
                        <p className="text-[11px] uppercase tracking-wide text-slate-400 mt-1">Est. monthly</p>
                    </div>
                )}
            </div>
            {sched.length > 0 && (
                <ul className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
                    {sched.map((l, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                            <span className="text-[#03a9e7] mt-1.5 w-1 h-1 rounded-full bg-[#03a9e7] shrink-0" />{l}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
