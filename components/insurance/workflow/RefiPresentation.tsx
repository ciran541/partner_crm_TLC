'use client'

import { ReactNode, useEffect } from 'react'
import type { RefiComputation } from '@/lib/insurance/refiCalc'
import type { RefiRemarks } from '@/lib/insurance/refiRemarks'
import type { RefiProposalPackage } from '@/lib/insurance/refiProposal'
import { buildRefiPresentationHtml } from '@/lib/insurance/refiPresentation'
import { formatRateSchedule } from '@/lib/insurance/rateSchedule'
import { X, Printer, MessageSquare, Building2, Wallet, Lightbulb, AlertTriangle, Sparkles, ShieldCheck, CalendarRange, Receipt } from 'lucide-react'

interface Props {
    clientName?: string
    propertyLabel: string
    currentBank?: string
    currentRatePct?: number
    totalOutstanding: number
    computation: RefiComputation
    remarks: RefiRemarks
    selectedPackage?: RefiProposalPackage | null
    onClose: () => void
    onOpenChatSummary: () => void
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`

export default function RefiPresentation({
    clientName, propertyLabel, currentBank, currentRatePct, totalOutstanding,
    computation, remarks, selectedPackage, onClose, onOpenChatSummary,
}: Props) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        const prev = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
    }, [onClose])

    const print = () => {
        const html = buildRefiPresentationHtml({ clientName, propertyLabel, currentBank, currentRatePct, totalOutstanding, computation, remarks, selectedPackage })
        const w = window.open('', '_blank', 'width=900,height=1000')
        if (!w) return
        w.document.write(html); w.document.close(); w.focus()
    }

    const today = new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })
    const allRemarks = [...remarks.standard, ...remarks.conditional]
    const t = computation.tenure

    return (
        <div className="fixed inset-0 z-[120] bg-slate-100 overflow-y-auto">
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

            <div className="max-w-4xl mx-auto px-4 sm:px-8 py-8 sm:py-12">
                <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                    {/* Cover */}
                    <div className="bg-gradient-to-br from-[#052d4a] to-[#0a4a78] text-white px-7 sm:px-10 py-8 sm:py-10">
                        <p className="text-[#7dd3fc] text-xs font-semibold uppercase tracking-[0.18em] mb-2">Refinancing Plan</p>
                        <h1 className="text-2xl sm:text-3xl font-bold leading-tight">
                            {clientName ? <>Prepared for {clientName}</> : 'Your refinancing summary'}
                        </h1>
                        <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
                            <CoverStat icon={<Building2 size={15} />} label="Property" value={propertyLabel} />
                            <CoverStat icon={<Wallet size={15} />} label="Outstanding" value={money(totalOutstanding)} />
                            {currentBank ? <CoverStat label="Current bank" value={currentBank} /> : null}
                            {currentRatePct ? <CoverStat label="Current rate" value={`${currentRatePct}%`} /> : null}
                            <CoverStat label="Date" value={today} />
                        </div>
                    </div>

                    <div className="px-7 sm:px-10 py-8 sm:py-10 space-y-10">
                        {/* Recommended package + savings */}
                        {selectedPackage?.bank && (
                            <Block title="Recommended package" subtitle="The package best matched to your loan — with the savings versus your current rate.">
                                <PackagePanel pkg={selectedPackage} />
                            </Block>
                        )}

                        {/* Tenure range */}
                        {t && !t.error && (
                            <Block title="Refinancing tenure range" subtitle="The loan term we can structure for you across the banks.">
                                <div className="rounded-2xl bg-[#052d4a] text-white px-6 py-5 flex items-center gap-4">
                                    <CalendarRange size={28} className="text-[#7dd3fc] shrink-0" />
                                    <div>
                                        <p className="text-3xl font-extrabold leading-none">{t.min} – {t.max} <span className="text-lg font-semibold">years</span></p>
                                        <p className="text-xs text-white/70 mt-1.5">
                                            Based on {computation.usingIwaa ? 'income-weighted average age' : 'average age'}
                                            {computation.ageForTenure != null ? ` ${Math.ceil(computation.ageForTenure)}` : ''}.
                                            After picking a package, use the Tenure Planner to compare instalment & interest.
                                        </p>
                                    </div>
                                </div>
                            </Block>
                        )}

                        {/* Cost of refinancing */}
                        {remarks.cost.length > 0 && (
                            <Block title="Cost of refinancing" subtitle="One-time costs to switch — separate from your monthly instalment.">
                                <div className="rounded-xl border border-slate-200 overflow-hidden">
                                    {remarks.cost.map((line, i) => {
                                        const [label, ...rest] = line.split(':')
                                        return (
                                            <div key={i} className={`flex items-start justify-between gap-4 px-5 py-3.5 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                                                <span className="text-sm text-slate-600 flex items-center gap-2"><Receipt size={14} className="text-slate-400" />{label}</span>
                                                <span className="text-sm font-semibold text-[#052d4a] text-right">{rest.join(':').trim()}</span>
                                            </div>
                                        )
                                    })}
                                </div>
                                {computation.cancellationFee > 0 && (
                                    <p className="text-xs text-amber-700 mt-2 flex items-start gap-1.5">
                                        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                                        Est. cancellation fee on the undisbursed amount ≈ {money(computation.cancellationFee)}.
                                    </p>
                                )}
                            </Block>
                        )}

                        {/* Key things to note */}
                        {(remarks.alerts.length > 0 || allRemarks.length > 0) && (
                            <Block title="Key things to note" subtitle="The important points to keep in mind for this refinance.">
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

                        <div className="flex items-start gap-2.5 pt-2 border-t border-slate-100 text-xs text-slate-400 leading-relaxed">
                            <ShieldCheck size={14} className="shrink-0 mt-0.5" />
                            <p>All figures are estimates for discussion only and are subject to the bank&apos;s formal assessment and approval. Savings compare your current rate against the recommended package over the same outstanding loan and tenure.</p>
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
            {subtitle ? <p className="text-sm text-slate-500 mt-0.5 mb-4">{subtitle}</p> : <div className="mb-4" />}
            {children}
        </section>
    )
}

function PackagePanel({ pkg }: { pkg: RefiProposalPackage }) {
    const header = `${pkg.bank ?? ''}${pkg.category ? ` · ${pkg.category}` : ''}${pkg.lockin_years ? ` · ${pkg.lockin_years}-year lock-in` : ' · No lock-in'}`
    const sched = pkg.rate_schedule?.length ? formatRateSchedule(pkg.rate_schedule) : (pkg.year1_rate != null ? [`Year 1: ${pkg.year1_rate.toFixed(2)}%`] : [])
    const saving = pkg.monthly_saving
    return (
        <div className="rounded-2xl border border-slate-200 border-l-4 border-l-[#03a9e7] px-5 sm:px-6 py-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                    <p className="text-base font-bold text-[#052d4a]">{header}</p>
                    {pkg.package_name && <p className="text-sm text-slate-500 mt-0.5">{pkg.package_name}</p>}
                </div>
                {saving != null && saving > 0 && (
                    <div className="text-right">
                        <p className="text-2xl font-extrabold text-emerald-600 leading-none">{money(saving)}</p>
                        <p className="text-[11px] uppercase tracking-wide text-slate-400 mt-1">Est. monthly saving</p>
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
            {(pkg.current_monthly != null || pkg.projected_monthly != null) && (
                <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm border-t border-slate-100 pt-4">
                    {pkg.current_monthly != null && <span className="text-slate-500">Current monthly: <b className="text-slate-700">{money(pkg.current_monthly)}</b></span>}
                    {pkg.projected_monthly != null && <span className="text-slate-500">New monthly: <b className="text-[#052d4a]">{money(pkg.projected_monthly)}</b></span>}
                    {pkg.net_saving_2yr != null && <span className="text-slate-500">2-yr net saving: <b className="text-emerald-600">{money(pkg.net_saving_2yr)}</b></span>}
                </div>
            )}
        </div>
    )
}
