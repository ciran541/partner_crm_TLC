'use client'

import { ReactNode, useMemo } from 'react'
import type { RefinancingWorkflow } from '@/lib/types/workflow'
import { computeRefi, inputsFromWorkflow, refiPropertyMeta } from '@/lib/insurance/refiCalc'
import { refiNextActions } from '@/lib/insurance/refiRemarks'
import { monthlyInstallment } from '@/lib/insurance/loanCalc'
import {
    Home, RefreshCw, Wallet, Sparkles, FileText,
    CalendarClock, ClipboardList, ArrowRight, Briefcase,
} from 'lucide-react'

interface Props {
    workflow: RefinancingWorkflow
    stage: string
    followUpDate?: string
    onOpenWorkflow: () => void
}

const money = (n?: number | null) => (n && n > 0 ? `$${Math.floor(n).toLocaleString()}` : '—')
const PROPERTY_USE_LABEL: Record<string, string> = { own_stay: 'Own-Stay', investment: 'Investment' }

export default function RefiOverview({ workflow, stage, followUpDate, onOpenWorkflow }: Props) {
    const meta = refiPropertyMeta(workflow.property_type)
    const comp = useMemo(() => computeRefi(inputsFromWorkflow(workflow)), [workflow])

    if (!workflow.property_type) {
        return (
            <div className="card p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto">
                    <RefreshCw size={22} className="text-[#03a9e7]" />
                </div>
                <div>
                    <p className="font-semibold text-slate-700">No refinancing details yet</p>
                    <p className="text-sm text-slate-500 mt-0.5">Open the workflow to capture the current loan, borrower details and package recommendation.</p>
                </div>
                <button onClick={onOpenWorkflow} className="btn-primary text-sm px-5 py-2.5 inline-flex items-center gap-2">
                    <Briefcase size={15} /> Start Workflow
                </button>
            </div>
        )
    }

    const pkg = workflow.selected_package_snapshot as Record<string, unknown> | undefined
    const actionsTotal = refiNextActions({ buc: meta?.buc, considerations: workflow.considerations }).length
    const actionsDone = (workflow.next_actions_done ?? []).length

    // Monthly installment preview: use selected package avg rate or current rate, at max tenure
    const previewRate = (pkg?.avg_rate_lockin_pct as number | undefined) ?? workflow.current_rate
    const previewTenure = comp.tenure?.max
    const previewInstallment = previewRate && previewTenure && comp.totalOutstanding > 0
        ? monthlyInstallment(comp.totalOutstanding, previewRate, previewTenure)
        : null

    return (
        <div className="space-y-5">
            {/* Refinancing Snapshot */}
            <Card title="Refinancing Snapshot" icon={<Home size={16} />}>
                <dl className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                    <Field label="Property Type" value={meta?.label} />
                    <Field label="Property Use" value={workflow.property_use ? PROPERTY_USE_LABEL[workflow.property_use] : undefined} />
                    <Field label="Market Price" value={money(workflow.market_price)} />
                    <Field label="Current Bank" value={workflow.current_bank} />
                    <Field label="Lock-in End Date" value={workflow.lockin_end_date ? new Date(workflow.lockin_end_date).toLocaleDateString() : undefined} />
                    <Field label="Current Rate" value={workflow.current_rate ? `${workflow.current_rate}% p.a.` : undefined} />
                    <Field label="Outstanding Loan" value={money(comp.totalOutstanding > 0 ? comp.totalOutstanding : undefined)} />
                    <Field label="Year of Purchase" value={workflow.year_of_purchase ? String(workflow.year_of_purchase) : undefined} />
                    {workflow.current_tenure != null && (
                        <Field label="Current Tenure" value={`${workflow.current_tenure} yrs remaining`} />
                    )}
                </dl>
            </Card>

            {/* Tenure & Loan */}
            {comp.ready && comp.tenure && (
                <Card title="Tenure & Loan" icon={<Wallet size={16} />}>
                    <dl className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                        <Field label="Tenure Range" value={`${comp.tenure.min}–${comp.tenure.max} yrs`} />
                        <Field label="Outstanding Loan" value={money(comp.totalOutstanding)} />
                        {previewInstallment != null && (
                            <Field
                                label={`Monthly (${previewRate?.toFixed(2)}%, ${previewTenure}y)`}
                                value={money(previewInstallment)}
                            />
                        )}
                        {comp.cancellationFee > 0 && (
                            <Field label="Cancellation Fee" value={money(comp.cancellationFee)} />
                        )}
                        {comp.cost && (
                            <Field label="Est. Legal Fee" value={`${money(comp.cost.legalFee)} ${comp.cost.legalNote}`} />
                        )}
                        {comp.cost?.estSubsidy != null && comp.cost.estSubsidy > 0 && (
                            <Field label="Est. Subsidy" value={money(comp.cost.estSubsidy)} />
                        )}
                    </dl>
                </Card>
            )}

            {/* Selected Package */}
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
                            {pkg.avg_rate_lockin_pct != null && (
                                <p className="text-base font-bold text-[#03a9e7]">{Number(pkg.avg_rate_lockin_pct).toFixed(2)}% avg</p>
                            )}
                            {pkg.projected_monthly != null && (
                                <p className="text-xs text-slate-500">{money(Number(pkg.projected_monthly))}/mo</p>
                            )}
                        </div>
                    </div>
                </Card>
            ) : null}

            {/* Status */}
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
