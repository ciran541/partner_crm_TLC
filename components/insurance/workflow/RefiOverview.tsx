'use client'

import { ReactNode, useMemo } from 'react'
import type { RefinancingWorkflow } from '@/lib/types/workflow'
import { computeRefi, inputsFromWorkflow, refiPropertyMeta } from '@/lib/insurance/refiCalc'
import { refiNextActions } from '@/lib/insurance/refiRemarks'
import { monthlyInstallment } from '@/lib/insurance/loanCalc'
import {
    Home, RefreshCw, Sparkles, FileText,
    CalendarClock, ClipboardList, ArrowRight, Briefcase, AlertTriangle,
    Banknote, TrendingDown,
} from 'lucide-react'

interface Props {
    workflow: RefinancingWorkflow
    stage: string
    followUpDate?: string
    onOpenWorkflow: () => void
    // Hides the workflow entry-point CTAs — used by the admin console, which
    // monitors cases but never runs an agent's client workflow.
    readOnly?: boolean
}

const money = (n?: number | null) => (n && n > 0 ? `$${Math.floor(n).toLocaleString()}` : '—')
const PROPERTY_USE_LABEL: Record<string, string> = { own_stay: 'Own-Stay', investment: 'Investment' }
const RATE_PREF_LABEL: Record<string, string> = { fixed: 'Fixed', floating: 'Floating', both: 'Both / No preference' }

export default function RefiOverview({ workflow, stage, followUpDate, onOpenWorkflow, readOnly }: Props) {
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
                    <p className="text-sm text-slate-500 mt-0.5">
                        {readOnly ? 'The agent has not started this workflow yet.' : 'Open the workflow to capture the current loan, borrower details and package recommendation.'}
                    </p>
                </div>
                {!readOnly && (
                    <button onClick={onOpenWorkflow} className="btn-primary text-sm px-5 py-2.5 inline-flex items-center gap-2">
                        <Briefcase size={15} /> Start Workflow
                    </button>
                )}
            </div>
        )
    }

    const pkg = workflow.selected_package_snapshot as Record<string, unknown> | undefined
    const actionsTotal = refiNextActions({ buc: meta?.buc, considerations: workflow.considerations }).length
    const actionsDone = (workflow.next_actions_done ?? []).length

    const bankLabel = workflow.property_type === 'hdb' ? 'Current Financier' : 'Current Bank'

    // Monthly preview: selected package avg rate (if chosen) or current rate, at max tenure
    const previewRate = (pkg?.avg_rate_lockin_pct as number | undefined) ?? workflow.current_rate
    const previewTenure = comp.tenure?.max
    const previewInstallment = previewRate && previewTenure && comp.totalOutstanding > 0
        ? monthlyInstallment(comp.totalOutstanding, previewRate, previewTenure)
        : null

    const hasCosts = comp.ready && (
        (comp.cost?.legalFee && comp.cost.legalFee > 0) ||
        (comp.cost?.estSubsidy && comp.cost.estSubsidy > 0) ||
        comp.subsidyClawback > 0 ||
        comp.cancellationFee > 0
    )

    // Considerations flags
    const cons = workflow.considerations ?? {}
    const considerationTags: string[] = [
        cons.sell ? 'Plans to sell' : '',
        cons.partial_pay ? 'Partial repayment' : '',
        cons.decouple ? 'Decoupling' : '',
        cons.equity_loan ? 'Equity loan' : '',
    ].filter(Boolean)

    // Equity loan details
    const hasEquityLoan = meta?.isPrivate && (
        (workflow.outstanding_equity_loan && workflow.outstanding_equity_loan > 0) ||
        (workflow.equity_loan_amount && workflow.equity_loan_amount > 0)
    )

    return (
        <div className="space-y-5">
            {/* ── Refinancing Snapshot ─────────────────────────────────── */}
            <Card title="Refinancing Snapshot" icon={<Home size={16} />}>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                    {/* Row 1 — Property */}
                    <Field label="Property Type" value={meta?.label} />
                    <Field label="Property Use" value={workflow.property_use ? PROPERTY_USE_LABEL[workflow.property_use] : undefined} />
                    <Field label="Market Price" value={money(workflow.market_price)} />

                    {/* Row 2 — Current loan */}
                    <Field label={bankLabel} value={workflow.current_bank} />
                    <Field label="Lock-in End Date" value={workflow.lockin_end_date ? new Date(workflow.lockin_end_date).toLocaleDateString('en-SG') : undefined} />
                    <Field label="Current Rate" value={workflow.current_rate ? `${workflow.current_rate}% p.a.` : undefined} />

                    {/* Row 3 — Loan details */}
                    <Field label="Outstanding (Disbursed)" value={money(workflow.outstanding_disbursed)} />
                    {meta?.buc && (
                        <Field label="Outstanding (Undisbursed)" value={money(workflow.outstanding_undisbursed)} warn={!!workflow.outstanding_undisbursed} />
                    )}
                    <Field label="Subsidy Return" value={workflow.subsidy_return_amount != null && workflow.subsidy_return_amount > 0 ? money(workflow.subsidy_return_amount) : workflow.subsidy_return_amount === 0 ? '$0 (none)' : undefined} />

                    {/* Row 4 — Tenure inputs */}
                    <Field label="Year of Purchase" value={workflow.year_of_purchase ? String(workflow.year_of_purchase) : undefined} />
                    <Field label="Current Tenure" value={workflow.current_tenure != null ? `${workflow.current_tenure} yrs remaining` : undefined} />
                    <Field label="Rate Preference" value={workflow.rate_preference ? RATE_PREF_LABEL[workflow.rate_preference] : undefined} />

                    {/* Row 5 — Computed outputs */}
                    {comp.ready && comp.tenure && (
                        <Field label="Refinancing Tenure Range" value={`${comp.tenure.min} – ${comp.tenure.max} yrs`} highlight />
                    )}
                    {comp.usingIwaa && comp.iwaa != null && (
                        <Field label="IWAA (used for tenure)" value={`${Math.ceil(comp.iwaa)} yrs`} highlight />
                    )}
                    {previewInstallment != null && (
                        <Field
                            label={`Est. Monthly${previewRate ? ` @ ${previewRate.toFixed(2)}%` : ''}`}
                            value={money(previewInstallment)}
                            highlight
                        />
                    )}
                </div>

                {/* Considerations tags */}
                {considerationTags.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Client Considerations</p>
                        <div className="flex flex-wrap gap-1.5">
                            {considerationTags.map(tag => (
                                <span key={tag} className="text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-0.5">{tag}</span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Cost summary strip */}
                {hasCosts && (
                    <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
                        {comp.cost?.legalFee != null && comp.cost.legalFee > 0 && (
                            <Field label="Est. Legal Fee" value={`${money(comp.cost.legalFee)}${comp.cost.legalNote ? ` ${comp.cost.legalNote}` : ''}`} />
                        )}
                        {comp.cost?.estSubsidy != null && comp.cost.estSubsidy > 0 && (
                            <Field label="Est. New Subsidy" value={money(comp.cost.estSubsidy)} />
                        )}
                        {comp.subsidyClawback > 0 && (
                            <Field label="Subsidy Clawback" value={money(comp.subsidyClawback)} warn />
                        )}
                        {comp.cancellationFee > 0 && (
                            <Field label="Cancellation Fee" value={money(comp.cancellationFee)} warn />
                        )}
                    </div>
                )}
            </Card>

            {/* ── Equity Loan ──────────────────────────────────────────── */}
            {hasEquityLoan && (
                <Card title="Equity Loan" icon={<Banknote size={16} />}>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                        {workflow.outstanding_equity_loan != null && workflow.outstanding_equity_loan > 0 && (
                            <Field label="Existing Equity Loan" value={money(workflow.outstanding_equity_loan)} />
                        )}
                        {workflow.current_equity_loan_tenure != null && (
                            <Field label="Existing Equity Tenure" value={`${workflow.current_equity_loan_tenure} yrs remaining`} />
                        )}
                        {workflow.equity_loan_amount != null && workflow.equity_loan_amount > 0 && (
                            <Field label="New Equity Loan Requested" value={money(workflow.equity_loan_amount)} highlight />
                        )}
                        {workflow.cpf_used != null && workflow.cpf_used > 0 && (
                            <Field label="CPF Accrued (all owners)" value={money(workflow.cpf_used)} />
                        )}
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
                            {pkg.avg_rate_lockin_pct != null && (
                                <p className="text-lg font-bold text-[#03a9e7]">{Number(pkg.avg_rate_lockin_pct).toFixed(2)}% <span className="text-xs font-medium text-slate-400">avg lock-in</span></p>
                            )}
                            {pkg.projected_monthly != null && (
                                <p className="text-sm font-semibold text-[#052d4a] mt-0.5">{money(Number(pkg.projected_monthly))}</p>
                            )}
                            {pkg.monthly_saving != null && Number(pkg.monthly_saving) > 0 && (
                                <p className="text-[11px] text-emerald-600 mt-0.5 flex items-center gap-1 justify-end">
                                    <TrendingDown size={11} /> saves {money(Number(pkg.monthly_saving))}/mo
                                </p>
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
                    {workflow.priority_client && (
                        <Field label="Priority Client" value="Yes" />
                    )}
                    {workflow.priority_banks && workflow.priority_banks.length > 0 && (
                        <Field label="Priority Banks" value={workflow.priority_banks.join(', ')} />
                    )}
                </div>
                {!readOnly && (
                    <button onClick={onOpenWorkflow} className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2 mt-4">
                        Continue Workflow <ArrowRight size={15} />
                    </button>
                )}
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

function Field({ label, value, icon, highlight, warn }: {
    label: string
    value?: string
    icon?: ReactNode
    highlight?: boolean
    warn?: boolean
}) {
    return (
        <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1 text-slate-400">
                {icon}{label}
            </dt>
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
