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
    CalendarClock, ClipboardList, ArrowRight, Briefcase, AlertTriangle,
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
    return Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`
}
const OUTSTANDING_LABEL: Record<string, string> = { '0': 'None (first loan)', '1': '1 existing', '2plus': '2 or more' }
const residencyLabel = (r?: string) => RESIDENCY_OPTIONS.find(o => o.value === r)?.label ?? '—'

export default function PurchaseOverview({ workflow, stage, followUpDate, onOpenWorkflow }: Props) {
    const meta = propertyMeta(workflow.property_type)
    const comp = useMemo(() => computePurchase(inputsFromWorkflow(workflow)), [workflow])

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
            {/* ── Purchase Snapshot ────────────────────────────────────── */}
            <Card title="Purchase Snapshot" icon={<Home size={16} />}>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                    {/* Row 1 — Property */}
                    <Field label="Property Type" value={meta?.label} />
                    <Field label="Purchase Price" value={money(workflow.property_price)} />
                    <Field label="Servicing Rule" value={meta?.rule === 'tdsr' ? 'TDSR (55%)' : meta?.rule === 'msr' ? 'MSR (30%)' : 'TDSR + MSR'} />

                    {/* Row 2 — Purchase context */}
                    <Field label="Outstanding Housing Loans" value={OUTSTANDING_LABEL[workflow.outstanding_housing_loans ?? '0']} />
                    <Field label="OTP Obtained" value={workflow.otp_obtained === undefined ? '—' : workflow.otp_obtained ? `Yes${otpDateText ? ` · ${otpDateText}` : ''}` : 'No'} />
                    {!workflow.otp_obtained && workflow.intended_buy_date && (
                        <Field label="Intended Buy Date" value={workflow.intended_buy_date} />
                    )}
                    <Field label="Prior IPA" value={workflow.ipa_done ? ipaSummary(workflow) : workflow.ipa_done === false ? 'No' : '—'} />

                    {/* Row 3 — Borrowers (income path only) */}
                    {!workflow.ipa_done && borrowers.length > 0 && (
                        <Field label="Borrowers" value={`${borrowers.length} · ${borrowers.map(b => residencyLabel(b.residency)).join(', ')}`} />
                    )}
                    {workflow.married && (
                        <Field label="Married Couple" value="Yes" />
                    )}
                    {workflow.selling_existing && <Field label="Selling Existing" value="Yes" />}
                    {workflow.selling_existing && workflow.bridging_loan != null && (
                        <Field label="Bridging Loan" value={workflow.bridging_loan ? 'Yes' : 'No'} />
                    )}
                    {workflow.sell_at_top && <Field label="Sell at TOP" value="Yes" />}
                    {workflow.ec_payment_scheme && (
                        <Field label="EC Payment Scheme" value={workflow.ec_payment_scheme === 'pps' ? 'PPS (Progressive)' : 'DPS (Deferred)'} />
                    )}
                    {workflow.rate_preference && (
                        <Field label="Rate Preference" value={workflow.rate_preference === 'fixed' ? 'Fixed' : workflow.rate_preference === 'floating' ? 'Floating' : 'Either'} />
                    )}

                    {/* Row 4 — Computed outputs (highlighted) */}
                    {comp.weightedAge != null && comp.weightedAge > 0 && (
                        <Field label="IWAA" value={`${Math.ceil(comp.weightedAge)} yrs`} highlight />
                    )}
                    {comp.tenureRange && (
                        <>
                            <Field label="Option 1 Tenure" value={`Up to ${comp.tenureRange.opt1} yrs`} highlight />
                            <Field label="Option 2 Tenure" value={`Up to ${comp.tenureRange.opt2} yrs`} highlight />
                        </>
                    )}
                    {workflow.preferred_tenure != null && (
                        <Field label="Preferred Tenure" value={`${workflow.preferred_tenure} yrs`} highlight />
                    )}
                </div>
            </Card>

            {/* ── Financing Options ────────────────────────────────────── */}
            {comp.ready && comp.options.length > 0 && (
                <Card title="Financing Options" icon={<Wallet size={16} />}>
                    <div className={`grid gap-3 ${comp.options.length > 1 ? 'sm:grid-cols-2' : ''}`}>
                        {comp.options.map(opt => (
                            <div key={opt.key} className="rounded-lg border border-slate-200 p-4 space-y-3">
                                {/* Option header */}
                                <div className="flex items-baseline justify-between gap-2">
                                    <p className="text-xs font-bold text-[#052d4a] uppercase tracking-wide">
                                        Option {opt.key}
                                    </p>
                                    <p className="text-xs text-slate-500">{pct(opt.ltvPct)} LTV · age {opt.ageCap}</p>
                                </div>

                                {/* Key number — final loan */}
                                <div>
                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Max Loan</p>
                                    <p className="text-[18px] font-extrabold text-[#052d4a] leading-none">{money(opt.finalLoan)}</p>
                                </div>

                                {/* Secondary rows */}
                                <div className="space-y-1.5 pt-1 border-t border-slate-100">
                                    <MiniRow label="Tenure" value={`${opt.tenure} yrs`} />
                                    <MiniRow label="Monthly Instalment" value={money(opt.installment)} />
                                    <MiniRow label="Min Cash" value={money(opt.minCashDown)} />
                                    <MiniRow label="Cash / CPF" value={money(opt.cashCpfDown)} />
                                </div>

                                {/* Pledge shortfall warning */}
                                {opt.pledge != null && opt.pledge.shortfall > 0 && (
                                    <p className="text-[11px] text-amber-600 flex items-center gap-1 pt-1">
                                        <AlertTriangle size={11} /> Pledge {money(opt.pledge.pledgeFund)} needed
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Stamp duty + cost strip */}
                    <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-x-6 gap-y-1.5">
                        <CostChip label="BSD" value={money(comp.bsd)} />
                        <CostChip
                            label={`ABSD (${comp.absdRatePct % 1 === 0 ? comp.absdRatePct : comp.absdRatePct.toFixed(1)}%)`}
                            value={money(comp.absd)}
                            warn={comp.absd > 0}
                        />
                        <CostChip label="Legal" value={money(comp.legalFee)} />
                        <CostChip label="Valuation" value={money(comp.valuationFee)} />
                    </div>
                </Card>
            )}

            {/* ── Selected Package ─────────────────────────────────────── */}
            {pkg?.bank ? (
                <Card title="Selected Package" icon={<Sparkles size={16} />}>
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="space-y-0.5">
                            <p className="text-sm font-semibold text-[#052d4a]">
                                {String(pkg.bank)}{pkg.category ? ` · ${String(pkg.category)}` : ''}{pkg.lockin_years ? ` · ${Number(pkg.lockin_years)}Y lock-in` : ' · No lock-in'}
                            </p>
                            {pkg.package_name ? <p className="text-xs text-slate-500">{String(pkg.package_name)}</p> : null}
                        </div>
                        <div className="text-right shrink-0">
                            {pkg.year1_rate != null && (
                                <p className="text-lg font-bold text-[#03a9e7]">{Number(pkg.year1_rate).toFixed(2)}% <span className="text-xs font-medium text-slate-400">yr 1</span></p>
                            )}
                            {pkg.projected_monthly != null && (
                                <p className="text-sm font-semibold text-[#052d4a] mt-0.5">{money(Number(pkg.projected_monthly))}</p>
                            )}
                        </div>
                    </div>
                </Card>
            ) : (
                <div className="rounded-xl border border-dashed border-slate-200 px-5 py-4 flex items-center gap-3 text-slate-400">
                    <Sparkles size={16} className="shrink-0" />
                    <p className="text-sm">No package selected yet — open the workflow to browse and select a package.</p>
                </div>
            )}

            {/* ── Status ───────────────────────────────────────────────── */}
            <Card title="Status" icon={<FileText size={16} />}>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                    <Field label="Pipeline Stage" value={stage} />
                    <Field
                        label="Follow-up"
                        value={followUpDate ? new Date(followUpDate).toLocaleDateString('en-SG') : '—'}
                        icon={<CalendarClock size={13} />}
                    />
                    {actionsTotal > 0 && (
                        <Field
                            label="Next Actions"
                            value={`${actionsDone} / ${actionsTotal} done`}
                            icon={<ClipboardList size={13} />}
                        />
                    )}
                </div>
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

function Field({ label, value, icon, highlight, warn }: {
    label: string
    value?: string
    icon?: ReactNode
    highlight?: boolean
    warn?: boolean
}) {
    return (
        <div>
            <dt className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">{icon}{label}</dt>
            <dd className={`text-sm font-semibold mt-0.5 flex items-center gap-1 ${
                warn ? 'text-amber-600'
                    : highlight ? 'text-[#03a9e7]'
                    : 'text-slate-800'
            }`}>
                {warn && <AlertTriangle size={12} className="shrink-0" />}
                {value || '—'}
            </dd>
        </div>
    )
}

function MiniRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-500">{label}</span>
            <span className="font-semibold text-slate-700">{value}</span>
        </div>
    )
}

function CostChip({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
    return (
        <span className="text-xs text-slate-500">
            {label}: <span className={`font-semibold ${warn ? 'text-amber-600' : 'text-slate-700'}`}>{value}</span>
        </span>
    )
}
