'use client'

import { ReactNode } from 'react'
import type { EquityLoanWorkflow } from '@/lib/types/workflow'
import { monthlyInstallment } from '@/lib/insurance/loanCalc'
import {
    Banknote, Sparkles, FileText, CalendarClock,
    ArrowRight, AlertTriangle, TrendingDown,
} from 'lucide-react'

interface Props {
    workflow: EquityLoanWorkflow
    stage: string
    followUpDate?: string
    onOpenWorkflow: () => void
}

const money = (n?: number | null) => (n && n > 0 ? `$${Math.floor(n).toLocaleString()}` : '—')
const PROPERTY_USE_LABEL: Record<string, string> = { own_stay: 'Own-Stay', investment: 'Investment' }
const RATE_PREF_LABEL: Record<string, string> = { fixed: 'Fixed', floating: 'Floating', both: 'Both / No preference' }
const PROPERTY_LABEL: Record<string, string> = {
    landed: 'Landed',
    completed_condo: 'Completed Condo',
    completed_ec_mop: 'Completed EC (MOP obtained)',
}

export default function EquityLoanOverview({ workflow, stage, followUpDate, onOpenWorkflow }: Props) {
    if (!workflow.property_type) {
        return (
            <div className="card p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto">
                    <Banknote size={22} className="text-[#03a9e7]" />
                </div>
                <div>
                    <p className="font-semibold text-slate-700">No equity loan details yet</p>
                    <p className="text-sm text-slate-500 mt-0.5">Open the workflow to capture the property, borrowers and equity loan amount.</p>
                </div>
                <button onClick={onOpenWorkflow} className="btn-primary text-sm px-5 py-2.5 inline-flex items-center gap-2">
                    <Banknote size={15} /> Start Workflow
                </button>
            </div>
        )
    }

    const pkg = workflow.selected_package_snapshot as Record<string, unknown> | undefined

    // Monthly preview for equity loan at selected package rate (or no preview)
    const previewRate = pkg?.avg_rate_lockin_pct as number | undefined
    const equityLoan = workflow.equity_loan_amount ?? 0
    const previewInstallment = previewRate && equityLoan > 0
        ? monthlyInstallment(equityLoan, previewRate, 35)
        : null

    // Equity calculation
    const valuation = workflow.market_price ?? 0
    const cpfUsed = workflow.cpf_used ?? 0
    const homeLoan = workflow.fully_paid ? 0 : ((workflow.outstanding_disbursed ?? 0) + (workflow.outstanding_equity_loan ?? 0))
    const loanPct = valuation > 0 ? homeLoan / valuation : 0
    const cpfPct = valuation > 0 ? cpfUsed / valuation : 0
    const equityPct = Math.max(0, 0.75 - loanPct - cpfPct)
    const equityAmt = equityPct * valuation

    const cons = workflow.considerations ?? {}
    const considerationTags: string[] = [
        cons.sell ? 'Plans to sell' : '',
        cons.partial_pay ? 'Partial repayment' : '',
        cons.decouple ? 'Decoupling' : '',
    ].filter(Boolean)

    return (
        <div className="space-y-5">
            {/* ── Equity Loan Snapshot ── */}
            <Card title="Equity Loan Snapshot" icon={<Banknote size={16} />}>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                    <Field label="Property Type" value={PROPERTY_LABEL[workflow.property_type]} />
                    <Field label="Property Use" value={workflow.property_use ? PROPERTY_USE_LABEL[workflow.property_use] : undefined} />
                    <Field label="Market Price" value={money(workflow.market_price)} />

                    <Field label="Fully Paid" value={workflow.fully_paid == null ? undefined : workflow.fully_paid ? 'Yes' : 'No'} />
                    <Field label="Year of Purchase" value={workflow.year_of_purchase ? String(workflow.year_of_purchase) : undefined} />
                    <Field label="CPF Accrued" value={cpfUsed > 0 ? money(cpfUsed) : undefined} />

                    {equityAmt > 0 && (
                        <Field label="Available Equity" value={`${((equityPct) * 100).toFixed(1)}% · ${money(equityAmt)}`} highlight />
                    )}
                    {workflow.equity_loan_amount != null && workflow.equity_loan_amount > 0 && (
                        <Field label="Equity Loan Amount" value={money(workflow.equity_loan_amount)} highlight />
                    )}
                    <Field label="Rate Preference" value={workflow.rate_preference ? RATE_PREF_LABEL[workflow.rate_preference] : undefined} />
                </div>

                {/* Current loan summary (not fully paid) */}
                {!workflow.fully_paid && (workflow.outstanding_disbursed ?? 0) > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                        <Field label="Current Bank" value={workflow.current_bank} />
                        <Field label="Lock-in End Date" value={workflow.lockin_end_date ? new Date(workflow.lockin_end_date).toLocaleDateString('en-SG') : undefined} />
                        <Field label="Current Rate" value={workflow.current_rate ? `${workflow.current_rate}% p.a.` : undefined} />
                        <Field label="Outstanding Home Loan" value={money(workflow.outstanding_disbursed)} />
                        {(workflow.outstanding_equity_loan ?? 0) > 0 && (
                            <Field label="Outstanding Equity Loan" value={money(workflow.outstanding_equity_loan)} />
                        )}
                        {workflow.subsidy_return_amount != null && (
                            <Field label="Subsidy Return" value={workflow.subsidy_return_amount > 0 ? money(workflow.subsidy_return_amount) : '$0 (none)'} warn={workflow.subsidy_return_amount > 0} />
                        )}
                    </div>
                )}

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
            </Card>

            {/* ── Selected Package ── */}
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
                            {previewInstallment != null && (
                                <p className="text-sm font-semibold text-[#052d4a] mt-0.5">{money(previewInstallment)} /mo est.</p>
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

            {/* ── Status ── */}
            <Card title="Status" icon={<FileText size={16} />}>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                    <Field label="Pipeline Stage" value={stage} />
                    <Field
                        label="Follow-up"
                        value={followUpDate ? new Date(followUpDate).toLocaleDateString('en-SG') : '—'}
                        icon={<CalendarClock size={13} />}
                    />
                </div>
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
