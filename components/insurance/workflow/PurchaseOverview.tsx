'use client'

import { ReactNode, useMemo } from 'react'
import type { PurchaseWorkflow } from '@/lib/types/workflow'
import {
    computePurchase,
    inputsFromWorkflow,
    propertyMeta,
    RESIDENCY_OPTIONS,
} from '@/lib/insurance/purchaseCalc'
import { nextActions } from '@/lib/insurance/purchaseRemarks'
import {
    Home, ShoppingCart, FileText, Wallet, Sparkles,
    CalendarClock, ClipboardList, ArrowRight, Briefcase,
} from 'lucide-react'

interface Props {
    workflow: PurchaseWorkflow
    stage: string
    followUpDate?: string
    onOpenWorkflow: () => void
}

const money = (n?: number | null) => (n && n > 0 ? `$${Math.floor(n).toLocaleString()}` : '—')
const pct = (frac: number) => {
    const v = frac * 100
    return Number.isInteger(v) ? `${v}%` : `${v.toFixed(2)}%`
}
const OUTSTANDING_LABEL: Record<string, string> = { '0': 'None (first loan)', '1': '1 existing', '2plus': '2 or more' }
const residencyLabel = (r?: string) => RESIDENCY_OPTIONS.find(o => o.value === r)?.label ?? '—'

export default function PurchaseOverview({ workflow, stage, followUpDate, onOpenWorkflow }: Props) {
    const meta = propertyMeta(workflow.property_type)
    const comp = useMemo(() => computePurchase(inputsFromWorkflow(workflow)), [workflow])

    // Nothing captured yet → invite the agent into the workflow.
    if (!workflow.property_type) {
        return (
            <div className="card p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto">
                    <ShoppingCart size={22} className="text-[#03a9e7]" />
                </div>
                <div>
                    <p className="font-semibold text-slate-700">No purchase details yet</p>
                    <p className="text-sm text-slate-500 mt-0.5">Open the workflow to capture this client&apos;s property, income and loan options.</p>
                </div>
                <button onClick={onOpenWorkflow} className="btn-primary text-sm px-5 py-2.5 inline-flex items-center gap-2">
                    <Briefcase size={15} /> Start Workflow
                </button>
            </div>
        )
    }

    const borrowers = workflow.borrowers ?? []
    const otpDateText = otpSummary(workflow)
    const pkg = workflow.selected_package_snapshot as Record<string, unknown> | undefined
    const actionsTotal = nextActions(workflow.property_type).length
    const actionsDone = (workflow.next_actions_done ?? []).length

    return (
        <div className="space-y-5">
            {/* Purchase snapshot */}
            <Card title="Purchase Snapshot" icon={<Home size={16} />}>
                <dl className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                    <Field label="Property Type" value={meta?.label} />
                    <Field label="Purchase Price" value={money(workflow.property_price)} />
                    <Field label="Servicing" value={meta?.rule === 'tdsr' ? 'TDSR (55%)' : meta?.rule === 'msr' ? 'MSR (30%)' : 'TDSR + MSR'} />
                    <Field label="OTP Obtained" value={workflow.otp_obtained === undefined ? '—' : workflow.otp_obtained ? `Yes${otpDateText ? ` · ${otpDateText}` : ''}` : 'No'} />
                    <Field label="Prior IPA" value={workflow.ipa_done ? ipaSummary(workflow) : workflow.ipa_done === false ? 'No' : '—'} />
                    <Field label="Outstanding Housing Loans" value={OUTSTANDING_LABEL[workflow.outstanding_housing_loans ?? '0']} />
                    {!workflow.ipa_done && borrowers.length > 0 && (
                        <Field label="Borrowers" value={`${borrowers.length} · ${borrowers.map(b => residencyLabel(b.residency)).join(', ')}`} />
                    )}
                    {workflow.selling_existing && <Field label="Selling existing property" value="Yes" />}
                </dl>
            </Card>

            {/* Financing options */}
            {comp.ready && comp.options.length > 0 && (
                <Card title="Financing Options" icon={<Wallet size={16} />}>
                    <div className={`grid gap-3 ${comp.options.length > 1 ? 'sm:grid-cols-2' : ''}`}>
                        {comp.options.map(opt => (
                            <div key={opt.key} className="rounded-lg border border-slate-200 p-3.5">
                                <p className="text-xs font-bold text-[#052d4a] mb-2">Option {opt.key} — {pct(opt.ltvPct)} LTV · to age {opt.ageCap}</p>
                                <div className="space-y-1.5">
                                    <MiniRow label="Max loan" value={money(opt.finalLoan)} strong />
                                    <MiniRow label="Tenure" value={`${opt.tenure} yrs`} />
                                    <MiniRow label="Monthly (est.)" value={money(opt.installment)} />
                                    <MiniRow label="Min cash / Cash-CPF" value={`${money(opt.minCashDown)} / ${money(opt.cashCpfDown)}`} />
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
                        <span>BSD: <span className="font-semibold text-slate-700">{money(comp.bsd)}</span></span>
                        <span>ABSD ({comp.absdRatePct % 1 === 0 ? comp.absdRatePct : comp.absdRatePct.toFixed(1)}%): <span className="font-semibold text-slate-700">{money(comp.absd)}</span></span>
                        <span>Legal: <span className="font-semibold text-slate-700">{money(comp.legalFee)}</span></span>
                        <span>Valuation: <span className="font-semibold text-slate-700">{money(comp.valuationFee)}</span></span>
                    </div>
                </Card>
            )}

            {/* Selected package */}
            {pkg?.bank ? (
                <Card title="Selected Package" icon={<Sparkles size={16} />}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                            <p className="text-sm font-semibold text-[#052d4a]">
                                {String(pkg.bank)}{pkg.category ? ` · ${String(pkg.category)}` : ''}{pkg.lockin_years ? ` · ${Number(pkg.lockin_years)}Y lock-in` : ' · No lock-in'}
                            </p>
                            {pkg.package_name ? <p className="text-xs text-slate-500">{String(pkg.package_name)}</p> : null}
                        </div>
                        <div className="text-right">
                            {pkg.year1_rate != null && <p className="text-base font-bold text-[#03a9e7]">{Number(pkg.year1_rate).toFixed(2)}%</p>}
                            {pkg.projected_monthly != null && <p className="text-xs text-slate-500">{money(Number(pkg.projected_monthly))}/mo</p>}
                        </div>
                    </div>
                </Card>
            ) : null}

            {/* Status + CTA */}
            <Card title="Status" icon={<FileText size={16} />}>
                <dl className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                    <Field label="Pipeline Stage" value={stage} />
                    <Field label="Follow-up" value={followUpDate ? new Date(followUpDate).toLocaleDateString() : '—'} icon={<CalendarClock size={13} />} />
                    <Field label="Next actions" value={`${actionsDone} / ${actionsTotal} done`} icon={<ClipboardList size={13} />} />
                </dl>
                <button onClick={onOpenWorkflow} className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2 mt-4">
                    Continue Workflow <ArrowRight size={15} />
                </button>
            </Card>
        </div>
    )
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function otpSummary(wf: PurchaseWorkflow): string | null {
    const d = wf.otp_dates ?? {}
    if (d.completion) return `completion ${d.completion}`
    if (d.option_expiry) return `expiry ${d.option_expiry}`
    if (d.top_year) return `TOP ${d.top_year}`
    if (d.snp_date) return `S&P ${d.snp_date}`
    if (d.key_collection_year) return `keys ${d.key_collection_year}`
    return null
}

function ipaSummary(wf: PurchaseWorkflow): string {
    const i = wf.ipa ?? {}
    const bits = [i.bank, i.amount ? `$${Math.floor(i.amount).toLocaleString()}` : null, i.tenure ? `${i.tenure}y` : null, i.age_cap ? `age ${i.age_cap}` : null].filter(Boolean)
    return bits.length ? `Yes · ${bits.join(' · ')}` : 'Yes'
}

// ─── presentational ───────────────────────────────────────────────────────────

function Card({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
    return (
        <div className="card p-5">
            <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-[#03a9e7]">{icon}</div>
                <h3 className="font-bold text-[#052d4a]">{title}</h3>
            </div>
            {children}
        </div>
    )
}

function Field({ label, value, icon }: { label: string; value?: string; icon?: ReactNode }) {
    return (
        <div>
            <dt className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">{icon}{label}</dt>
            <dd className="text-sm font-medium text-slate-800 mt-0.5">{value || '—'}</dd>
        </div>
    )
}

function MiniRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-500">{label}</span>
            <span className={strong ? 'text-sm font-bold text-[#052d4a]' : 'font-semibold text-slate-700'}>{value}</span>
        </div>
    )
}
