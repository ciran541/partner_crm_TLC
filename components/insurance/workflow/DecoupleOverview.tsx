'use client'

import { ReactNode, useMemo } from 'react'
import type { DecoupleWorkflow } from '@/lib/types/workflow'
import {
    computeDecouple,
    inputsFromDecoupleWorkflow,
    DECOUPLE_PROPERTY_TYPES,
} from '@/lib/insurance/decoupleCalc'
import {
    Home, ArrowLeftRight, Wallet, User, FileText,
    CalendarClock, ArrowRight, Briefcase, AlertTriangle, CheckCircle, XCircle, Banknote,
} from 'lucide-react'

interface Props {
    workflow: DecoupleWorkflow
    stage: string
    followUpDate?: string
    onOpenWorkflow: () => void
}

const money = (n?: number | null) => (n && n > 0 ? `$${Math.floor(n).toLocaleString()}` : '—')
const pct = (n: number) => `${(n * 100).toFixed(1).replace(/\.0$/, '')}%`

const SCENARIO_LABELS: Record<string, { label: string; desc: string }> = {
    S1: { label: 'S1 – Refinancing', desc: 'Buyer takes over existing loan via refi (no new purchase loan)' },
    S2: { label: 'S2 – New Purchase Loan', desc: 'Property fully paid; buyer takes a new bank loan' },
    S3: { label: 'S3 – Refi + New Loan', desc: 'Existing loan refinanced AND buyer takes a new purchase loan' },
    S4: { label: 'S4 – Cash / CPF Only', desc: 'No bank financing; buyer pays in cash and/or CPF' },
}

const RESIDENCY_LABEL: Record<string, string> = {
    singaporean: 'Singapore Citizen',
    pr: 'Permanent Resident',
    foreigner: 'Foreigner',
}

const PROPERTY_USE_LABEL: Record<string, string> = { own_stay: 'Own-Stay', investment: 'Investment' }

export default function DecoupleOverview({ workflow, stage, followUpDate, onOpenWorkflow }: Props) {
    const comp = useMemo(() => computeDecouple(inputsFromDecoupleWorkflow(workflow)), [workflow])

    const propMeta = DECOUPLE_PROPERTY_TYPES.find(t => t.value === workflow.property_type)

    if (!workflow.property_type) {
        return (
            <div className="card p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto">
                    <ArrowLeftRight size={22} className="text-[#03a9e7]" />
                </div>
                <div>
                    <p className="font-semibold text-slate-700">No decoupling details yet</p>
                    <p className="text-sm text-slate-500 mt-0.5">Open the workflow to capture the property, ownership split and financing scenario.</p>
                </div>
                <button onClick={onOpenWorkflow} className="btn-primary text-sm px-5 py-2.5 inline-flex items-center gap-2">
                    <Briefcase size={15} /> Start Workflow
                </button>
            </div>
        )
    }

    const scenario = comp.scenario
    const scenarioInfo = scenario ? SCENARIO_LABELS[scenario] : null
    const isRefi = scenario === 'S1' || scenario === 'S3'
    const isPurchase = scenario === 'S2' || scenario === 'S3'
    const isFinancing = scenario === 'S2' || scenario === 'S3'
    const isS4 = scenario === 'S4'
    const buyerPct = workflow.buyer_share != null ? workflow.buyer_share : null
    const sellerPct = buyerPct != null ? (100 - buyerPct) : null

    return (
        <div className="space-y-5">
            {/* ── Decoupling Snapshot ──────────────────────────────────── */}
            <Card title="Decoupling Snapshot" icon={<Home size={16} />}>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                    {/* Property */}
                    <Field label="Property Type" value={propMeta?.label} />
                    <Field label="Property Valuation" value={money(workflow.property_valuation)} highlight />
                    <Field label="Year of Purchase" value={workflow.year_of_purchase ? String(workflow.year_of_purchase) : undefined} />
                    <Field label="Property Use" value={workflow.property_use ? PROPERTY_USE_LABEL[workflow.property_use] : undefined} />

                    {/* Ownership split */}
                    <Field label="Buyer's Current Share" value={buyerPct != null ? `${buyerPct}%` : undefined} />
                    <Field label="Seller's Share (Transferring)" value={sellerPct != null ? `${sellerPct}%` : undefined} highlight />

                    {/* Buyer */}
                    <Field label="Buyer Residency" value={workflow.residency ? RESIDENCY_LABEL[workflow.residency] : undefined} />
                    {workflow.priority_client && (
                        <Field label="Priority Banks" value={workflow.priority_banks?.length ? workflow.priority_banks.join(', ') : 'Yes'} />
                    )}
                </div>

                {/* Scenario badge */}
                {scenarioInfo && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Financing Scenario</p>
                        <div className="inline-flex items-start gap-2 rounded-lg bg-[#052d4a]/5 border border-[#052d4a]/10 px-3 py-2">
                            <span className="text-xs font-bold text-[#052d4a] mt-0.5">{scenarioInfo.label}</span>
                            <span className="text-xs text-slate-500">{scenarioInfo.desc}</span>
                        </div>
                    </div>
                )}

                {/* Existing mortgage (shown for all scenarios that have a loan) */}
                {!workflow.fully_paid && (workflow.outstanding_home_loan || workflow.current_bank) && (
                    <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
                        {workflow.current_bank && <Field label="Current Bank" value={workflow.current_bank} />}
                        {workflow.current_rate != null && <Field label="Current Rate" value={`${workflow.current_rate}% p.a.`} />}
                        {workflow.lockin_end_date && <Field label="Lock-in End Date" value={new Date(workflow.lockin_end_date).toLocaleDateString('en-SG')} />}
                        {workflow.outstanding_home_loan != null && <Field label="Outstanding Home Loan" value={money(workflow.outstanding_home_loan)} />}
                        {workflow.outstanding_equity_loan != null && workflow.outstanding_equity_loan > 0 && (
                            <Field label="Outstanding Equity Loan" value={money(workflow.outstanding_equity_loan)} />
                        )}
                        {workflow.subsidy_return_amount != null && workflow.subsidy_return_amount > 0 && (
                            <Field label="Subsidy Return" value={money(workflow.subsidy_return_amount)} warn />
                        )}
                    </div>
                )}
            </Card>

            {/* ── Buyer Transaction ────────────────────────────────────── */}
            {comp.purchasePrice > 0 && (
                <Card title="Buyer Transaction" icon={<Wallet size={16} />}>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                        <Field label="Purchase Price (Seller's Share)" value={money(comp.purchasePrice)} highlight />
                        <Field label="BSD" value={money(comp.bsd)} />
                        {comp.absd > 0 && (
                            <Field label={`ABSD (${comp.absdRatePct}%)`} value={money(comp.absd)} warn />
                        )}
                        <Field label="Buyer Legal Fee" value={money(comp.buyerLegalFee)} />

                        {/* Financing path (S2/S3) */}
                        {isFinancing && comp.bankLoan75 > 0 && (
                            <>
                                <Field label="Bank Loan (75%)" value={money(comp.bankLoan75)} highlight />
                                <Field label="Cash (5%)" value={money(comp.cash5)} />
                                <Field label="CPF / Cash (20%)" value={money(comp.cpfCash20)} />
                                {comp.monthlyInstallment > 0 && (
                                    <Field
                                        label={`Est. Monthly${workflow.reference_rate ? ` @ ${workflow.reference_rate}%` : ''}`}
                                        value={money(comp.monthlyInstallment)}
                                        highlight
                                    />
                                )}
                            </>
                        )}

                        {/* S1: Refi tenure + installment */}
                        {isRefi && !isPurchase && comp.refiTenureMax > 0 && (
                            <>
                                <Field label="Refi Tenure Range" value={`${comp.refiTenureMin} – ${comp.refiTenureMax} yrs`} highlight />
                                {comp.refiMonthlyInstallment > 0 && (
                                    <Field label="Est. Monthly (Refi)" value={money(comp.refiMonthlyInstallment)} highlight />
                                )}
                            </>
                        )}

                        {/* S4: Cash/CPF breakdown */}
                        {isS4 && (
                            <>
                                {comp.cpfUsedForPurchase > 0 && <Field label="CPF Used" value={money(comp.cpfUsedForPurchase)} />}
                                {comp.cashRequired > 0 && <Field label="Cash Required" value={money(comp.cashRequired)} />}
                            </>
                        )}
                    </div>
                </Card>
            )}

            {/* ── Seller Proceeds ──────────────────────────────────────── */}
            {comp.sellingPrice > 0 && (
                <Card title="Seller Proceeds" icon={<User size={16} />}>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                        <Field label="Selling Price" value={money(comp.sellingPrice)} />
                        <Field label="Outstanding Loan (Seller's Share)" value={money(comp.sellerLoanLiability)} />
                        {workflow.seller_cpf_usage != null && workflow.seller_cpf_usage > 0 && (
                            <Field label="CPF Refund to Seller OA" value={money(workflow.seller_cpf_usage)} />
                        )}
                        {comp.ssd > 0 && (
                            <Field label={`SSD (${comp.ssdRatePct}% – ${comp.ssdRateTable === 'new' ? 'new' : 'old'} table)`} value={money(comp.ssd)} warn />
                        )}
                        <Field label="Seller Legal Fee" value={money(comp.sellerLegalFee)} />
                        <Field label="Net Cash Proceeds" value={money(comp.cashProceeds)} highlight />
                    </div>
                </Card>
            )}

            {/* ── TDSR ─────────────────────────────────────────────────── */}
            {!isS4 && comp.grossMonthlyIncome > 0 && (
                <Card title="TDSR" icon={<Banknote size={16} />}>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                        <Field label="Gross Monthly Income" value={money(comp.grossMonthlyIncome)} />
                        <Field label="Existing Monthly Debts" value={comp.existingMonthlyDebts > 0 ? money(comp.existingMonthlyDebts) : '$0'} />
                        <Field label="TDSR Headroom" value={money(comp.availableTdsr)} highlight />

                        {isRefi && comp.refiStressInstallment > 0 && (
                            <Field label="Home Loan Stress @ 4%" value={money(comp.refiStressInstallment)} />
                        )}
                        {isPurchase && comp.purchaseStressInstallment > 0 && (
                            <Field label="Purchase Loan Stress @ 4%" value={money(comp.purchaseStressInstallment)} />
                        )}
                    </div>

                    {/* Outcome badges */}
                    <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-2">
                        {isRefi && (
                            <TdsrBadge label="Refi" pass={comp.refiTdsrPass} />
                        )}
                        {isPurchase && (
                            <TdsrBadge label="Purchase Loan" pass={comp.purchaseTdsrPass} />
                        )}
                        {!isRefi && !isPurchase && comp.tdsrOutcome && (
                            <TdsrBadge label="Overall" pass={comp.tdsrOutcome === 'both_pass'} />
                        )}
                    </div>
                </Card>
            )}

            {/* ── Equity Loan Headroom ─────────────────────────────────── */}
            {(workflow.equity_loan_amount && workflow.equity_loan_amount > 0) || comp.equityLoanMaxLtv > 0 ? (
                <Card title="Equity Loan" icon={<Banknote size={16} />}>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                        <Field label="Max by LTV" value={money(comp.equityLoanMaxLtv)} />
                        <Field label="Max (LTV + TDSR)" value={money(comp.equityLoanMax)} highlight />
                        {workflow.equity_loan_amount != null && workflow.equity_loan_amount > 0 && (
                            <Field label="Requested" value={money(workflow.equity_loan_amount)} />
                        )}
                        <Field label="Eligible?" value={comp.equityEligible ? 'Yes' : comp.equityNotEligibleReason ?? 'No'} warn={!comp.equityEligible} />
                    </div>
                </Card>
            ) : null}

            {/* ── Status ───────────────────────────────────────────────── */}
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

// ─── helpers ──────────────────────────────────────────────────────────────────

function TdsrBadge({ label, pass }: { label: string; pass: boolean }) {
    return (
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1 ${
            pass ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
            {pass ? <CheckCircle size={11} /> : <XCircle size={11} />}
            {label} {pass ? 'Pass' : 'Fail'}
        </span>
    )
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
