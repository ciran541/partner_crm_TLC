'use client'

import { ReactNode, useEffect, useMemo, useState } from 'react'
import type { RefinancingWorkflow, RefiBorrower } from '@/lib/types/workflow'
import {
    computeRefi,
    inputsFromWorkflow,
    REFI_PROPERTY_TYPES,
    refiPropertyMeta,
    ratesPropertyType,
    type RefiPropertyType,
} from '@/lib/insurance/refiCalc'
import { buildRefiRemarks, refiNextActions, type RefiRemarks } from '@/lib/insurance/refiRemarks'
import { monthlyInstallment, effectiveMonthlyIncome, tdsrAvailable, maxLoanFromPayment, STRESS_TEST_RATE } from '@/lib/insurance/loanCalc'
import { computeAmortization } from '@/lib/insurance/amortCalc'
import { type RateScheduleEntry } from '@/lib/types/rates'
import type { RefiProposalPackage } from '@/lib/insurance/refiProposal'
import { buildRefiProposalText } from '@/lib/insurance/refiProposal'
import type { RecommendedPackage } from '@/lib/insurance/rateRecommend'
import type { SoraRates } from '@/lib/insurance/sora'
import { Question, FieldInput } from '@/components/insurance/workflow/WorkflowStep'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import Modal from '@/components/shared/Modal'
import RefiPackages from './RefiPackages'
import RefiPresentation from './RefiPresentation'
import {
    Building2, CheckCircle2, AlertTriangle, Info, Lightbulb, Save, Wallet, Receipt,
    ArrowRight, ClipboardList, CalendarClock, CalendarRange, Copy, Printer, Circle,
    Presentation, MessageSquare, Percent, Lock, Plus, Trash2,
} from 'lucide-react'

const pct = (frac: number, dp = 1) => `${(frac * 100).toFixed(dp)}%`

interface Props {
    data: RefinancingWorkflow
    onChange: (updated: RefinancingWorkflow) => void
    clientName?: string
    embedded?: boolean
    saving?: boolean
    saved?: boolean
    currentStage?: string
    onStageAdvance?: (toStage: string) => void
    onSetFollowUp?: (date: string) => void
    followUpDate?: string
    hasClientName?: boolean
    onContinue?: () => void
}

/** Interest paid during the first `periodYrs` years of a loan at `ratePct`. */
function interestOverPeriod(loan: number, ratePct: number, tenureYrs: number, periodYrs: number): number {
    const r = ratePct / 100 / 12
    const nT = tenureYrs * 12
    const nP = Math.min(Math.round(periodYrs * 12), nT)
    if (r === 0 || nT === 0 || nP === 0) return 0
    const p = loan * r * Math.pow(1 + r, nT) / (Math.pow(1 + r, nT) - 1)
    const balance = Math.max(loan * Math.pow(1 + r, nP) - p * (Math.pow(1 + r, nP) - 1) / r, 0)
    return Math.max(p * nP - (loan - balance), 0)
}

const STAGE_ORDER = ['Touched Base', 'Proposal Given', 'Referred to Bank', 'Pending Approval', 'Pending Signature']
const SUBSIDY_PRESETS = ['0', '2000', '2500']

const money = (n: number) => `$${Math.floor(n).toLocaleString()}`
const num = (v: string) => (v.trim() === '' ? undefined : parseFloat(v.replace(/,/g, '')))

export default function RefinancingWorkflowPanel({
    data, onChange, clientName, embedded, saving, saved,
    currentStage, onStageAdvance, onSetFollowUp, followUpDate,
    hasClientName, onContinue,
}: Props) {
    const update = (patch: Partial<RefinancingWorkflow>) => onChange({ ...data, ...patch })
    const [proposalOpen, setProposalOpen] = useState(false)
    const [presentationOpen, setPresentationOpen] = useState(false)
    const [customSubsidy, setCustomSubsidy] = useState(
        data.subsidy_return_amount != null && !SUBSIDY_PRESETS.includes(String(data.subsidy_return_amount)),
    )
    const [soraForAmort, setSoraForAmort] = useState<SoraRates | null>(null)
    const [preferredTenure2, setPreferredTenure2] = useState<number | undefined>()
    const [rawPrefTenure1, setRawPrefTenure1] = useState('')
    const [rawPrefTenure2, setRawPrefTenure2] = useState('')

    useEffect(() => {
        fetch('/api/insurance/rates')
            .then(r => r.json())
            .then(d => { if (d.sora) setSoraForAmort(d.sora) })
            .catch(() => {})
    }, [])

    const meta = refiPropertyMeta(data.property_type)
    const computation = useMemo(() => computeRefi(inputsFromWorkflow(data)), [data])
    const remarks = useMemo<RefiRemarks>(() => buildRefiRemarks({
        propertyType: data.property_type,
        isPrivate: meta?.isPrivate,
        buc: meta?.buc,
        totalOutstanding: computation.totalOutstanding,
        undisbursed: data.outstanding_undisbursed,
        subsidyClawback: computation.subsidyClawback,
        smallLoanNoSubsidy: computation.smallLoanNoSubsidy,
        considerations: data.considerations,
        cost: computation.cost,
        tenureError: computation.tenure?.error ?? null,
    }), [data, computation, meta])

    // ── Borrowers (always 4 rows, age default 0) ──
    const borrowers: RefiBorrower[] = Array.from({ length: 4 }, (_, i) => data.borrowers?.[i] ?? {})
    const updateBorrower = (i: number, patch: Partial<RefiBorrower>) => {
        const next = borrowers.map((b, idx) => idx === i ? { ...b, ...patch } : b)
        update({ borrowers: next })
    }
    const agedBorrowers = borrowers.map((b, i) => ({ b, i })).filter(({ b }) => (b.age ?? 0) > 0)

    const setPropertyType = (type: RefiPropertyType) => {
        const patch: Partial<RefinancingWorkflow> = { property_type: type }
        // Undisbursed only applies to the incompleted (BUC) type — clear otherwise.
        if (!refiPropertyMeta(type)?.buc) patch.outstanding_undisbursed = undefined
        // Equity loan fields only apply to private property types.
        if (!refiPropertyMeta(type)?.isPrivate) {
            patch.outstanding_equity_loan = undefined
            patch.current_equity_loan_tenure = undefined
            patch.decouple_now = undefined
            patch.cpf_used = undefined
            patch.equity_loan_amount = undefined
            patch.preferred_tenure_equity = undefined
        }
        update(patch)
    }

    const toggleConsideration = (key: keyof NonNullable<RefinancingWorkflow['considerations']>) => {
        const c = { ...(data.considerations ?? {}) }
        c[key] = !c[key]
        update({ considerations: c })
    }

    const onSelectPackage = (rec: RecommendedPackage, sora: SoraRates | null) => {
        update({
            selected_package_snapshot: {
                id: rec.pkg.id,
                bank: rec.pkg.bank,
                category: rec.pkg.category,
                package_name: rec.pkg.package_name,
                lockin_years: rec.pkg.lockin_years,
                rate_schedule: rec.pkg.rate_schedule,
                projected_monthly: rec.projection.newMonthly,
                year1_rate: rec.projection.perYear[0]?.ratePct ?? null,
                avg_rate_lockin_pct: rec.projection.avgRateLockinPct,
                current_monthly: rec.savings?.currentMonthly ?? null,
                monthly_saving: rec.savings?.monthlySaving ?? null,
                net_saving_2yr: rec.savings?.netSaving2yr ?? null,
                net_saving_3yr: rec.savings?.netSaving3yr ?? null,
                sora_as_of: sora?.published_date ?? sora?.value_date ?? null,
                frozen_at: new Date().toISOString(),
            },
        })
    }

    const selectedPkgId = (data.selected_package_snapshot?.id as string) ?? undefined
    const selectedPackage = data.selected_package_snapshot as RefiProposalPackage | undefined

    const proposalText = useMemo(() => buildRefiProposalText({
        clientName,
        propertyLabel: meta?.label ?? 'Property',
        currentBank: data.current_bank,
        totalOutstanding: computation.totalOutstanding,
        currentRatePct: data.current_rate,
        computation,
        selectedPackage,
    }), [clientName, meta, data.current_bank, data.current_rate, computation, selectedPackage])

    const actions = refiNextActions({ buc: meta?.buc, considerations: data.considerations })
    const actionsDone = data.next_actions_done ?? []
    const toggleAction = (a: string) => {
        const set = new Set(actionsDone)
        if (set.has(a)) set.delete(a); else set.add(a)
        update({ next_actions_done: [...set] })
    }
    const stageIdx = currentStage ? STAGE_ORDER.indexOf(currentStage) : -1
    const suggestedStage = stageIdx >= 0 && stageIdx < STAGE_ORDER.length - 1 ? STAGE_ORDER[stageIdx + 1] : null

    // ── Rate schedule for amortisation (package wins over manual) ──
    const DEFAULT_RATE_SCHEDULE: RateScheduleEntry[] = [{ year: 1, type: 'fixed' }]
    const pkgSchedule = data.selected_package_snapshot?.rate_schedule as RateScheduleEntry[] | undefined
    const hasPkg = pkgSchedule != null && pkgSchedule.length > 0
    const activeSchedule: RateScheduleEntry[] = hasPkg
        ? pkgSchedule
        : (data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE)
    const lockinYears = (data.selected_package_snapshot?.lockin_years as number | undefined) ?? data.reference_lockin_years
    const updateScheduleRow = (idx: number, patch: Partial<RateScheduleEntry>) => {
        const s = data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE
        update({ manual_rate_schedule: s.map((e, i) => i === idx ? { ...e, ...patch } : e) })
    }
    const addScheduleYear = () => {
        const s = data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE
        const maxYear = Math.max(0, ...s.filter(e => e.year != null).map(e => e.year!))
        update({ manual_rate_schedule: [...s, { year: maxYear + 1, type: 'fixed' }] })
    }
    const removeScheduleRow = (idx: number) => {
        const s = data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE
        if (s.length > 1) update({ manual_rate_schedule: s.filter((_, i) => i !== idx) })
    }

    // ── Tenure Comparison — rate source ──
    const snapshotRate = data.selected_package_snapshot?.avg_rate_lockin_pct as number | undefined
    const compRate: number | null = snapshotRate ?? data.current_rate ?? null
    const compRateLabel: string | null = snapshotRate != null
        ? `${data.selected_package_snapshot?.bank ?? 'selected package'} @ ${snapshotRate.toFixed(2)}% avg lock-in`
        : data.current_rate != null ? `current rate ${data.current_rate}% p.a.` : null
    const compLockinYears: number = (((data.selected_package_snapshot?.lockin_years as number | undefined) ?? 2) || 1)

    // ── Tenure Comparison — TDSR inputs ──
    const grossForTdsr = useMemo(() => {
        const total = agedBorrowers.reduce((s, { b }) => s + effectiveMonthlyIncome({
            basicMonthlySalary: b.basic_salary,
            annualVariableIncome: b.annual_variable,
            isSelfEmployed: b.employment === 'self_employed',
        }), 0)
        return total > 0 ? total : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.borrowers])

    const debtsForTdsr = useMemo(() =>
        agedBorrowers.reduce((s, { b }) => s + (b.commitments ?? 0), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    , [data.borrowers])

    const subsidyValue = data.subsidy_return_amount
    const t = computation.tenure

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-lg font-bold text-[#052d4a] flex items-center gap-2">
                        <Building2 size={18} className="text-[#03a9e7]" /> Refinancing — Eligibility & Advice
                    </h2>
                    <p className="text-sm text-slate-500">
                        {clientName ? <>Advising <span className="font-medium text-slate-700">{clientName}</span>. </> : null}
                        Capture only what applies — tenure, costs, remarks and packages update live.
                    </p>
                </div>
                {embedded && (
                    <span className="text-xs text-slate-400 flex items-center gap-1.5">
                        {saving ? <><Save size={13} className="animate-pulse" /> Saving…</>
                            : saved ? <><CheckCircle2 size={13} className="text-emerald-500" /> Saved</>
                            : null}
                    </span>
                )}
            </div>

            {/* ── Property ── */}
            <Section title="Property" icon={<Building2 size={15} />}>
                <Question label="Type of Property" required>
                    <PillSelect
                        value={data.property_type}
                        onChange={v => setPropertyType(v as RefiPropertyType)}
                        options={REFI_PROPERTY_TYPES.map(p => ({ value: p.value, label: p.label }))}
                    />
                </Question>
                <Question label="Is this property used for Own-Stay or Investment?">
                    <PillSelect
                        value={data.property_use}
                        onChange={v => update({ property_use: v as 'own_stay' | 'investment' })}
                        options={[
                            { value: 'own_stay', label: 'Own-Stay' },
                            { value: 'investment', label: 'Investment' },
                        ]}
                    />
                </Question>
                <Question label="Rough market price of your property today">
                    <FieldInput commas prefix="$" value={data.market_price ?? ''} placeholder="e.g. 1,500,000"
                        onChange={v => update({ market_price: num(v) })} />
                </Question>
                <Question label="Year of purchase" required>
                    <FieldInput type="number" value={data.year_of_purchase ?? ''} placeholder="e.g. 2018"
                        onChange={v => update({ year_of_purchase: num(v) })} />
                </Question>
            </Section>

            {/* ── Current loan ── */}
            {data.property_type && (
                <Section title="Current Loan" icon={<Wallet size={15} />}>
                    {meta?.isPrivate ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Question label="Outstanding Home Loan" required>
                                <FieldInput commas prefix="$" value={data.outstanding_disbursed ?? ''} placeholder="e.g. 800,000"
                                    onChange={v => update({ outstanding_disbursed: num(v) })} />
                            </Question>
                            <Question label="Outstanding Equity Loan">
                                <FieldInput commas prefix="$" value={data.outstanding_equity_loan ?? ''} placeholder="e.g. 100,000"
                                    onChange={v => update({ outstanding_equity_loan: num(v) })} />
                            </Question>
                        </div>
                    ) : (
                        <Question label="Outstanding loan amount" required>
                            <FieldInput commas prefix="$" value={data.outstanding_disbursed ?? ''} placeholder="e.g. 800,000"
                                onChange={v => update({ outstanding_disbursed: num(v) })} />
                        </Question>
                    )}

                    {meta?.buc && (
                        <Question label="Outstanding loan amount (undisbursed)">
                            <FieldInput commas prefix="$" value={data.outstanding_undisbursed ?? ''} placeholder="e.g. 200,000"
                                onChange={v => update({ outstanding_undisbursed: num(v) })} />
                            {computation.cancellationFee > 0 && (
                                <p className="text-[11px] text-amber-600 mt-1.5 flex items-center gap-1.5">
                                    <AlertTriangle size={12} /> Estimated cancellation fee: {money(computation.cancellationFee)} ({money(data.outstanding_undisbursed ?? 0)} × 0.75%)
                                </p>
                            )}
                        </Question>
                    )}

                    {(() => {
                        const total = (data.outstanding_disbursed ?? 0) + (data.outstanding_equity_loan ?? 0) + (data.outstanding_undisbursed ?? 0)
                        const cap = (data.market_price ?? 0) * 0.75
                        if (!data.market_price || total === 0 || total <= cap) return null
                        return (
                            <p className="text-[11px] text-amber-600 flex items-center gap-1.5">
                                <AlertTriangle size={12} /> Total outstanding ({money(total)}) exceeds 75% of valuation ({money(cap)}). Please verify the figures.
                            </p>
                        )
                    })()}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Question label={data.property_type === 'hdb' ? 'Current Financier' : 'Current Bank'}>
                            <InsuranceBankDropdown value={data.current_bank ?? ''} onChange={v => update({ current_bank: v })} showHdb={data.property_type === 'hdb'} />
                        </Question>
                        <Question label="Lock-in end date">
                            <FieldInput type="date" value={data.lockin_end_date ?? ''} onChange={v => update({ lockin_end_date: v })} />
                        </Question>
                    </div>
                    <Question label="Current interest rate">
                        <FieldInput type="number" suffix="% p.a." value={data.current_rate ?? ''} placeholder="e.g. 3.5"
                            onChange={v => update({ current_rate: num(v) })} />
                    </Question>

                    <Question label="Do you need to return any subsidy to the current bank?">
                        <p className="text-[11px] text-slate-400 -mt-1 mb-2">Only applicable if the current bank gave a subsidy and you&apos;ve been with them less than 3 years.</p>
                        <PillSelect
                            value={customSubsidy ? 'custom' : (subsidyValue != null ? String(subsidyValue) : undefined)}
                            onChange={v => {
                                if (v === 'custom') { setCustomSubsidy(true); update({ subsidy_return_amount: undefined }) }
                                else { setCustomSubsidy(false); update({ subsidy_return_amount: Number(v) }) }
                            }}
                            options={[
                                { value: '0', label: '$0' },
                                { value: '2000', label: '$2,000' },
                                { value: '2500', label: '$2,500' },
                                { value: 'custom', label: 'Other amount' },
                            ]}
                        />
                        {customSubsidy && (
                            <div className="mt-2">
                                <FieldInput commas prefix="$" value={subsidyValue ?? ''} placeholder="Enter amount"
                                    onChange={v => update({ subsidy_return_amount: num(v) })} />
                            </div>
                        )}
                    </Question>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Question label={meta?.isPrivate ? 'Current Home Loan Tenure (remaining years)' : 'Current Tenure (remaining years on existing loan)'}>
                            <FieldInput type="number" value={data.current_tenure ?? ''} placeholder="e.g. 20"
                                onChange={v => update({ current_tenure: num(v) })} />
                            {data.current_tenure != null && data.current_tenure < 5 && (
                                <p className="text-[11px] text-red-500 mt-1">Cannot be less than 5 years</p>
                            )}
                            {data.current_tenure != null && data.current_tenure > (meta?.tenureCap ?? 35) && (
                                <p className="text-[11px] text-red-500 mt-1">Cannot be more than {meta?.tenureCap ?? 35} years for {meta?.isPrivate === false ? 'HDB' : 'private property'}</p>
                            )}
                            {!(data.current_tenure != null && (data.current_tenure < 5 || data.current_tenure > (meta?.tenureCap ?? 35))) && (
                                <p className="text-[11px] text-slate-400 mt-1">5 – {meta?.tenureCap ?? 35} years for {meta?.isPrivate === false ? 'HDB' : 'private'}</p>
                            )}
                        </Question>
                        {meta?.isPrivate && (data.outstanding_equity_loan ?? 0) > 0 && (
                            <Question label="Current Equity Loan Tenure (remaining years)">
                                <FieldInput type="number" value={data.current_equity_loan_tenure ?? ''} placeholder="e.g. 10"
                                    onChange={v => update({ current_equity_loan_tenure: num(v) })} />
                                <p className="text-[11px] text-slate-400 mt-1">Up to 35 years, to age 75</p>
                            </Question>
                        )}
                    </div>
                </Section>
            )}

            {/* ── Plans ── */}
            {data.property_type && (
                <Section title="Plans (next 1–3 years)" icon={<Info size={15} />}>
                    <Question label="Any consideration for the following? (select all that apply)">
                        <div className="space-y-2">
                            <CheckRow label="Sell" checked={!!data.considerations?.sell} onToggle={() => toggleConsideration('sell')} />
                            <CheckRow label="Partial Pay" checked={!!data.considerations?.partial_pay} onToggle={() => toggleConsideration('partial_pay')} />
                            <CheckRow label="Decouple" hint="Not applicable for HDB or EC within MOP" checked={!!data.considerations?.decouple} onToggle={() => toggleConsideration('decouple')} />
                            <CheckRow label="Equity Loan" hint="Not applicable for HDB or EC within MOP" checked={!!data.considerations?.equity_loan} onToggle={() => toggleConsideration('equity_loan')} />
                        </div>
                    </Question>

                    {/* Decouple now? */}
                    {data.considerations?.decouple && meta?.isPrivate && (
                        <div className="pl-1 space-y-3">
                            <Question label="Do you plan to decouple now?">
                                <YesNo value={data.decouple_now} onChange={v => update({ decouple_now: v })} />
                            </Question>
                            {data.decouple_now && (
                                <div className="flex items-start gap-2.5 rounded-lg border border-[#03a9e7]/40 bg-sky-50 px-4 py-3">
                                    <Lightbulb size={14} className="text-[#03a9e7] shrink-0 mt-0.5" />
                                    <p className="text-[12px] text-[#052d4a] leading-relaxed">
                                        <span className="font-semibold">Tip:</span> Recommended to use the <span className="font-semibold">Decoupling Mortgage Planner</span> for a full breakdown.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Equity loan — CPF input + available equity diagram */}
                    {data.considerations?.equity_loan && meta?.isPrivate && (() => {
                        const totalLoan = (data.outstanding_disbursed ?? 0) + (data.outstanding_equity_loan ?? 0)
                        const valuation = data.market_price ?? 0
                        const cpfUsed = data.cpf_used ?? 0
                        const loanPct = valuation > 0 ? totalLoan / valuation : 0
                        const cpfPct  = valuation > 0 ? cpfUsed / valuation : 0
                        const equityPct = Math.max(0, 0.75 - loanPct - cpfPct)
                        const equityAmt = equityPct * valuation
                        const cashPct = Math.max(0, 1 - loanPct - cpfPct)
                        const cashAmt = cashPct * valuation
                        const equityEligible = equityAmt >= 50_000
                        const hasInputs = valuation > 0 && totalLoan > 0

                        return (
                            <div className="pl-1 space-y-4">
                                <Question label="Total CPF accrued by all owner(s)">
                                    <FieldInput commas prefix="$" value={data.cpf_used ?? ''} placeholder="e.g. 100,000"
                                        onChange={v => update({ cpf_used: num(v) })} />
                                </Question>

                                {hasInputs && (
                                    <div className="rounded-xl border border-[#03a9e7]/30 overflow-hidden">
                                        <div className="px-4 py-3 bg-sky-50/70 border-b border-[#03a9e7]/15">
                                            <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">Single Ownership Structure</p>
                                        </div>
                                        <div className="p-4 space-y-4">
                                            <OwnershipBar
                                                loanPct={loanPct}
                                                cpfPct={cpfPct}
                                                cashPct={cashPct}
                                                loanAmt={totalLoan}
                                                cpfAmt={cpfUsed}
                                                cashAmt={cashAmt}
                                            />
                                            <p className="text-[11px] text-slate-400">Based on property valuation of {money(valuation)}.</p>

                                            <div className="space-y-2">
                                                <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">Available Equity</p>
                                                <p className="text-sm text-slate-600">
                                                    75% − {pct(loanPct)} (loan) − {pct(cpfPct)} (CPF) = <span className={`font-bold ${equityPct > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{pct(equityPct)}</span>
                                                </p>
                                                {equityPct <= 0 ? (
                                                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                                                        <AlertTriangle size={13} className="text-red-500 shrink-0 mt-0.5" />
                                                        <p className="text-[12px] text-red-800">Not eligible for equity loan — combined loan and CPF already reach 75% of property value.</p>
                                                    </div>
                                                ) : !equityEligible ? (
                                                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                                                        <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
                                                        <p className="text-[12px] text-amber-800">Available equity {money(equityAmt)} — below $50,000 minimum for an equity loan.</p>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-3">
                                                        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                                                            <CheckCircle2 size={13} className="text-emerald-600 shrink-0 mt-0.5" />
                                                            <p className="text-[12px] text-emerald-800 font-semibold">Available Equity: {money(equityAmt)} — eligible.</p>
                                                        </div>
                                                        <Question label="Would you like to take up an equity loan?">
                                                            <FieldInput commas prefix="$"
                                                                value={data.equity_loan_amount ?? ''}
                                                                placeholder={`max ${money(equityAmt)}`}
                                                                onChange={v => {
                                                                    const n = num(v)
                                                                    update({ equity_loan_amount: n !== undefined ? Math.min(n, equityAmt) : undefined })
                                                                }} />
                                                        </Question>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })()}
                </Section>
            )}

            {/* ── Borrowers & age ── */}
            {data.property_type && (
                <Section title="Borrower(s) & Age" icon={<CalendarRange size={15} />}>
                    <Question label="Age of all borrower(s)">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {borrowers.map((b, i) => (
                                <div key={i}>
                                    <label className="text-[11px] text-slate-500">Borrower {i + 1}</label>
                                    <FieldInput type="number" value={b.age ?? ''} placeholder="0"
                                        onChange={v => updateBorrower(i, { age: num(v) })} />
                                </div>
                            ))}
                        </div>
                        {computation.averageAge != null && (
                            <div className="mt-2 space-y-0.5">
                                <p className="text-[12px] text-slate-500">
                                    Average age: <span className="font-semibold text-[#052d4a]">{Math.ceil(computation.averageAge)}</span>
                                </p>
                                {computation.usingIwaa && computation.iwaa != null && (
                                    <p className="text-[12px] text-slate-500">
                                        Income-Weighted Average Age (IWAA): <span className="font-semibold text-[#03a9e7]">{Math.ceil(computation.iwaa)}</span> <span className="text-slate-400">(used for tenure)</span>
                                    </p>
                                )}
                            </div>
                        )}
                    </Question>

                    {agedBorrowers.length > 0 ? (
                        <div className="space-y-3">
                            {agedBorrowers.map(({ b, i }) => (
                                <div key={i} className="rounded-lg border border-slate-200 p-4 space-y-3">
                                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Borrower {i + 1} · age {b.age}</p>
                                    <Question label="Employment">
                                        <PillSelect
                                            value={b.employment ?? 'employed'}
                                            onChange={v => updateBorrower(i, { employment: v as 'employed' | 'self_employed' })}
                                            options={[{ value: 'employed', label: 'Employed' }, { value: 'self_employed', label: 'Self-Employed' }]}
                                        />
                                    </Question>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {b.employment !== 'self_employed' && (
                                            <Question label="Monthly Basic Salary">
                                                <FieldInput commas prefix="$" value={b.basic_salary ?? ''}
                                                    onChange={v => updateBorrower(i, { basic_salary: num(v) })} />
                                            </Question>
                                        )}
                                        <Question label={b.employment === 'self_employed' ? 'Annual income (NOA)' : 'Annual Bonus / Variable Income'}>
                                            <FieldInput commas prefix="$" value={b.annual_variable ?? ''}
                                                onChange={v => updateBorrower(i, { annual_variable: num(v) })} />
                                        </Question>
                                        <Question label="Monthly Liabilities">
                                            <FieldInput commas prefix="$" value={b.commitments ?? ''} placeholder="e.g. 500"
                                                onChange={v => updateBorrower(i, { commitments: num(v) })} />
                                        </Question>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-[12px] text-slate-400 flex items-center gap-1.5"><Info size={12} /> Enter borrower age(s) above to capture income for TDSR assessment.</p>
                    )}

                    <Question label="Is any borrower a priority client with any bank?">
                        <YesNo value={data.priority_client} onChange={v => update({ priority_client: v, priority_banks: v ? data.priority_banks : [] })} />
                    </Question>
                    {data.priority_client && (
                        <Question label="Which bank(s)? (select all that apply)">
                            <MultiBankSelect
                                value={data.priority_banks ?? []}
                                onChange={v => update({ priority_banks: v })}
                            />
                        </Question>
                    )}
                </Section>
            )}

            {/* ── TDSR Assessment ── */}
            {data.property_type && grossForTdsr != null && grossForTdsr > 0 && (() => {
                const availableTdsr = Math.max(grossForTdsr * 0.55 - debtsForTdsr, 0)

                // Refinancing TDSR: home loan at current_tenure, 4% stress
                const refiLoan = (data.outstanding_disbursed ?? 0)
                const refiTenure = data.current_tenure ?? (t?.max ?? 0)
                const refiStress = refiLoan > 0 && refiTenure > 0
                    ? monthlyInstallment(refiLoan, STRESS_TEST_RATE * 100, refiTenure)
                    : 0
                // If there's also an outstanding equity loan being refinanced, add its stress installment
                const equityOutstandingLoan = meta?.isPrivate ? (data.outstanding_equity_loan ?? 0) : 0
                const equityOutstandingTenure = data.current_equity_loan_tenure ?? refiTenure
                const equityOutstandingStress = equityOutstandingLoan > 0 && equityOutstandingTenure > 0
                    ? monthlyInstallment(equityOutstandingLoan, STRESS_TEST_RATE * 100, equityOutstandingTenure)
                    : 0
                const refiTotalStress = refiStress + equityOutstandingStress
                const refiPass = refiTotalStress > 0 ? refiTotalStress <= availableTdsr : null

                // New equity loan TDSR
                const newEquityLoan = data.equity_loan_amount ?? 0
                const maxEquityAge = agedBorrowers.length > 0 ? Math.max(...agedBorrowers.map(({ b }) => b.age ?? 0)) : 0
                const equityTenureMax = maxEquityAge > 0 ? Math.min(75 - maxEquityAge, 35) : 35
                const equityTenureMin = 5
                const preferredEquityTenure = data.preferred_tenure_equity != null
                    ? Math.max(equityTenureMin, Math.min(equityTenureMax, data.preferred_tenure_equity))
                    : equityTenureMax
                const equityNewStress = newEquityLoan > 0 && preferredEquityTenure > 0
                    ? monthlyInstallment(newEquityLoan, STRESS_TEST_RATE * 100, preferredEquityTenure)
                    : 0
                const balanceAfterRefi = availableTdsr - refiTotalStress
                const equityPass = newEquityLoan > 0 && equityNewStress > 0 ? equityNewStress <= balanceAfterRefi : null

                const showEquityBlock = newEquityLoan > 0 && data.considerations?.equity_loan

                return (
                    <Section title="TDSR Assessment" icon={<Percent size={15} />}>
                        {/* Available TDSR header */}
                        <div className="rounded-lg border border-[#03a9e7]/20 bg-sky-50/40 px-4 py-3 flex items-start justify-between gap-4 flex-wrap">
                            <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Available TDSR</p>
                                <p className="text-xl font-bold text-[#052d4a]">{money(availableTdsr)}/mo</p>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                    {money(grossForTdsr)} × 55%{debtsForTdsr > 0 ? ` − ${money(debtsForTdsr)} commitments` : ''}
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Gross Monthly Income</p>
                                <p className="text-base font-bold text-[#052d4a]">{money(grossForTdsr)}</p>
                            </div>
                        </div>

                        {/* Refinancing block */}
                        {refiTotalStress > 0 && (
                            <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                                <p className="text-xs font-bold text-[#052d4a] uppercase tracking-wide">Refinancing</p>
                                {equityOutstandingStress > 0 && (
                                    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5 space-y-1">
                                        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Loan breakdown at 4% stress</p>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <p className="text-[11px] text-slate-500">Home Loan ({refiTenure} yrs)</p>
                                                <p className="text-sm font-bold text-[#052d4a]">{money(refiStress)}/mo</p>
                                            </div>
                                            <div>
                                                <p className="text-[11px] text-slate-500">Equity Loan ({equityOutstandingTenure} yrs)</p>
                                                <p className="text-sm font-bold text-[#052d4a]">{money(equityOutstandingStress)}/mo</p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                                    <p className="text-[11px] text-slate-500">TDSR Required{equityOutstandingStress > 0 ? ' (combined)' : ` at ${refiTenure} yrs, 4% stress`}</p>
                                    <p className="text-sm font-bold text-[#052d4a]">{money(refiTotalStress)}/mo</p>
                                </div>
                                {refiPass !== null && (
                                    <div className={`rounded-lg border px-3 py-2.5 flex items-center gap-2 ${refiPass ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                                        {refiPass
                                            ? <><CheckCircle2 size={14} className="text-emerald-600" /><span className="text-sm font-bold text-emerald-700">TDSR Pass</span></>
                                            : <><AlertTriangle size={14} className="text-red-500" /><span className="text-sm font-bold text-red-600">TDSR Fail</span>
                                                <span className="ml-auto text-[11px] font-semibold text-red-600">shortfall: {money(refiTotalStress - availableTdsr)}/mo</span></>
                                        }
                                    </div>
                                )}
                                {refiPass === false && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                                        <p className="text-[12px] font-semibold text-amber-800 mb-1">Potential Remedies</p>
                                        <p className="text-[12px] text-amber-700 leading-relaxed">
                                            {data.property_use === 'investment'
                                                ? 'Bank will require client to pay down 3% of outstanding loan and/or show some funds to prove repayment ability.'
                                                : 'Client may qualify for TDSR Waiver with most banks — to double check with banker.'}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* New equity loan TDSR block */}
                        {showEquityBlock && (
                            <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                                <p className="text-xs font-bold text-[#052d4a] uppercase tracking-wide">Equity Loan ({money(newEquityLoan)} requested)</p>
                                <div className="space-y-2">
                                    <div className="flex items-center gap-4 text-sm">
                                        <span className="text-slate-500">Tenure range:</span>
                                        <span className="font-semibold text-[#052d4a]">{equityTenureMin} – {equityTenureMax} yrs</span>
                                        <span className="text-[11px] text-slate-400">(to age 75)</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="number"
                                            value={data.preferred_tenure_equity ?? ''}
                                            placeholder={String(equityTenureMax)}
                                            onChange={e => {
                                                const v = parseInt(e.target.value, 10)
                                                const clamped = isNaN(v) ? undefined : Math.max(equityTenureMin, Math.min(equityTenureMax, v))
                                                update({ preferred_tenure_equity: clamped })
                                            }}
                                            className="w-20 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12"
                                        />
                                        <span className="text-xs text-slate-500">years (using {preferredEquityTenure} yrs)</span>
                                    </div>
                                </div>
                                <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                                    <p className="text-[11px] text-slate-500">TDSR Required at {preferredEquityTenure} yrs, 4% stress</p>
                                    <p className="text-sm font-bold text-[#052d4a]">{money(equityNewStress)}/mo</p>
                                </div>
                                {equityPass !== null && (
                                    <div className={`rounded-lg border px-3 py-2.5 flex items-center gap-2 ${equityPass ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                                        {equityPass
                                            ? <><CheckCircle2 size={14} className="text-emerald-600" /><span className="text-sm font-bold text-emerald-700">TDSR Pass</span></>
                                            : <><AlertTriangle size={14} className="text-red-500" /><span className="text-sm font-bold text-red-600">TDSR Fail</span>
                                                <span className="ml-auto text-[11px] font-semibold text-red-600">shortfall: {money(equityNewStress - balanceAfterRefi)}/mo</span></>
                                        }
                                    </div>
                                )}
                                {equityPass === false && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                                        <p className="text-[12px] font-semibold text-amber-800 mb-1">Potential Remedies</p>
                                        <p className="text-[12px] text-amber-700 leading-relaxed">
                                            Pledge or show funds required to pass TDSR for the equity loan component.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {refiTotalStress === 0 && (
                            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                                <Info size={12} /> Enter outstanding loan amount and tenure to see TDSR required.
                            </p>
                        )}
                    </Section>
                )
            })()}

            {/* ── Rate preference ── */}
            {data.property_type && (
                <Section title="Rate Preference" icon={<Percent size={15} />}>
                    <Question label="Any preference for fixed or floating rates?">
                        <PillSelect
                            value={data.rate_preference ?? 'both'}
                            onChange={v => update({ rate_preference: v as 'fixed' | 'floating' | 'both' })}
                            options={[
                                { value: 'both', label: 'Both' },
                                { value: 'fixed', label: 'Fixed' },
                                { value: 'floating', label: 'Floating' },
                            ]}
                        />
                    </Question>
                </Section>
            )}

            {/* ── Packages (shown right after rate preference) ── */}
            {computation.totalOutstanding > 0 && data.property_type && (
                <RefiPackages
                    loan={computation.totalOutstanding}
                    tenureYears={t?.max ?? meta?.tenureCap ?? 30}
                    propertyType={ratesPropertyType(data.property_type)}
                    includeBuc={!!meta?.buc}
                    currentRatePct={data.current_rate}
                    clawbackAmount={computation.subsidyClawback}
                    preference={data.rate_preference ?? 'both'}
                    selectedId={selectedPkgId}
                    onSelect={onSelectPackage}
                />
            )}

            {/* ── RESULTS ── */}
            {t?.error ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2.5">
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-[13px] text-amber-800 leading-relaxed">{t.error}</p>
                </div>
            ) : computation.ready && t ? (
                <>
                    {/* Tenure range — shown first */}
                    <div className="rounded-xl border-2 border-[#03a9e7]/40 overflow-hidden">
                        <div className="bg-sky-50 px-4 py-3 flex items-center gap-2">
                            <CalendarRange size={16} className="text-[#03a9e7]" />
                            <p className="text-sm font-bold text-[#052d4a]">Estimated Tenure Range for Refinancing</p>
                        </div>
                        <div className="p-4 flex flex-wrap items-end gap-x-8 gap-y-2">
                            <div>
                                <p className="text-3xl font-extrabold text-[#052d4a] leading-none">{t.min} – {t.max} <span className="text-base font-semibold text-slate-500">years</span></p>
                                <p className="text-[11px] text-slate-400 mt-1.5">
                                    Min 5 yrs · max = lower of (75 − age = {t.result1}) and ({meta?.tenureCap} − yrs since purchase − 1 = {t.result2})
                                </p>
                            </div>
                            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                                <Info size={12} /> After picking a package, use the Tenure Planner below to compare instalment & interest.
                            </p>
                        </div>
                    </div>

                    {/* Monthly Instalment — replaces old TenureComparison */}
                    {computation.totalOutstanding > 0 && (() => {
                        const loan = computation.totalOutstanding
                        const clamp = (v: number) => Math.min(Math.max(v, t.min), t.max)
                        const defaultT = clamp(data.current_tenure ?? t.max)
                        const t1 = clamp(data.preferred_tenure_1 ?? defaultT)
                        const t2 = clamp(preferredTenure2 ?? defaultT)
                        const amortRows1 = computeAmortization(loan, t1, activeSchedule, soraForAmort)
                        const amortRows2 = computeAmortization(loan, t2, activeSchedule, soraForAmort)
                        const m1 = amortRows1[0]?.instalment ?? null
                        const m2 = amortRows2[0]?.instalment ?? null
                        const effectiveLockin = (lockinYears != null && lockinYears > 0) ? lockinYears : null
                        const i1 = effectiveLockin != null ? (amortRows1.find(r => r.year === effectiveLockin)?.cumulativeInterest ?? null) : null
                        const i2 = effectiveLockin != null ? (amortRows2.find(r => r.year === effectiveLockin)?.cumulativeInterest ?? null) : null
                        const lockInCards = effectiveLockin != null
                            ? Array.from({ length: effectiveLockin }, (_, i) => ({
                                year: i + 1,
                                value: amortRows1.find(r => r.year === i + 1)?.cumulativeInterest ?? null,
                                instalment: amortRows1.find(r => r.year === i + 1)?.instalment ?? null,
                            }))
                            : []
                        const schedExplicitYears = activeSchedule.filter(e => !e.thereafter && e.year != null).length
                        const breakdownYears = effectiveLockin ?? (schedExplicitYears > 0 ? schedExplicitYears : 3)
                        const inputCls = 'w-20 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12'
                        const fmt2 = (n: number | null) => n != null ? `$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
                        const money2 = (n: number) => { const r = Math.round(n); return r < 0 ? `-$${(-r).toLocaleString()}` : `$${r.toLocaleString()}` }
                        return (
                            <Section title="Monthly Instalment" icon={<Wallet size={15} />}>

                                {/* Live SORA */}
                                {soraForAmort && (soraForAmort.comp_sora_1m != null || soraForAmort.comp_sora_3m != null) && (
                                    <div className="flex items-center gap-3 flex-wrap">
                                        {soraForAmort.comp_sora_1m != null && (
                                            <div className="flex items-baseline gap-1.5">
                                                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">1M SORA</span>
                                                <span className="text-base font-black text-[#052d4a]">{soraForAmort.comp_sora_1m.toFixed(4)}%</span>
                                            </div>
                                        )}
                                        {soraForAmort.comp_sora_1m != null && soraForAmort.comp_sora_3m != null && <span className="w-px h-5 bg-slate-200 shrink-0" />}
                                        {soraForAmort.comp_sora_3m != null && (
                                            <div className="flex items-baseline gap-1.5">
                                                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">3M SORA</span>
                                                <span className="text-base font-black text-[#052d4a]">{soraForAmort.comp_sora_3m.toFixed(4)}%</span>
                                            </div>
                                        )}
                                        {(soraForAmort.published_date ?? soraForAmort.value_date) && (
                                            <span className="text-[11px] text-slate-400 ml-auto">as of {soraForAmort.published_date ?? soraForAmort.value_date}</span>
                                        )}
                                    </div>
                                )}

                                {/* Rate schedule */}
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Interest Rates p.a.</span>
                                        {effectiveLockin != null && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#03a9e7] bg-sky-50 border border-sky-100 px-2 py-0.5 rounded-full">
                                                <Lock size={9} /> {effectiveLockin}-yr lock-in
                                            </span>
                                        )}
                                        {hasPkg && (
                                            <button type="button" onClick={() => update({ selected_package_snapshot: undefined })}
                                                className="ml-auto text-[11px] text-slate-400 hover:text-slate-600 underline underline-offset-2">
                                                Clear package
                                            </button>
                                        )}
                                    </div>
                                    <div className="rounded-xl border border-slate-100 overflow-hidden">
                                        {activeSchedule.filter(e => !e.thereafter).map((entry, idx) => {
                                            const schedIdx = activeSchedule.indexOf(entry)
                                            return hasPkg ? (
                                                <div key={idx} className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 last:border-b-0 bg-white">
                                                    <div className="w-1 h-7 rounded-full shrink-0 bg-[#03a9e7]" />
                                                    <span className="w-20 shrink-0 text-xs font-bold text-[#052d4a]">Year {entry.year}</span>
                                                    <span className="text-xs font-semibold text-slate-600">
                                                        {entry.type === 'fixed'
                                                            ? `${entry.rate?.toFixed(2) ?? '—'}% fixed`
                                                            : `${entry.reference ?? ''} + ${entry.spread?.toFixed(2) ?? '—'}%`}
                                                    </span>
                                                </div>
                                            ) : (
                                                <RefiAmortRateRow key={idx}
                                                    entry={entry} label={`Year ${entry.year}`} isLockin
                                                    onChange={patch => updateScheduleRow(schedIdx, patch)}
                                                    onRemove={() => removeScheduleRow(schedIdx)}
                                                    canRemove={(data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE).length > 1}
                                                    refId={`refi-rate-${idx}`}
                                                />
                                            )
                                        })}
                                        {activeSchedule.some(e => e.thereafter) && (
                                            <>
                                                <div className="flex items-center gap-3 px-3 py-1.5 bg-slate-50 border-t border-b border-slate-100">
                                                    <div className="flex-1 h-px bg-slate-200" />
                                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Out of lock-in</span>
                                                    <div className="flex-1 h-px bg-slate-200" />
                                                </div>
                                                {activeSchedule.filter(e => e.thereafter).map((entry, idx) => {
                                                    const schedIdx = activeSchedule.indexOf(entry)
                                                    return hasPkg ? (
                                                        <div key={`t-${idx}`} className="flex items-center gap-2 px-3 py-2.5 bg-slate-50/60">
                                                            <div className="w-1 h-7 rounded-full shrink-0 bg-slate-200" />
                                                            <span className="w-20 shrink-0 text-xs font-bold text-slate-400">Thereafter</span>
                                                            <span className="text-xs font-semibold text-slate-500">
                                                                {entry.type === 'fixed'
                                                                    ? `${entry.rate?.toFixed(2) ?? '—'}% fixed`
                                                                    : `${entry.reference ?? ''} + ${entry.spread?.toFixed(2) ?? '—'}%`}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <RefiAmortRateRow key={`t-${idx}`}
                                                            entry={entry} label="Thereafter" isLockin={false}
                                                            onChange={patch => updateScheduleRow(schedIdx, patch)}
                                                            onRemove={() => removeScheduleRow(schedIdx)}
                                                            canRemove={(data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE).length > 1}
                                                            refId={`refi-rate-thereafter-${idx}`}
                                                        />
                                                    )
                                                })}
                                            </>
                                        )}
                                    </div>
                                    {!hasPkg && (
                                        <button type="button" onClick={addScheduleYear}
                                            className="mt-2 flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-600 hover:bg-slate-50 px-2.5 py-1.5 rounded-lg transition-colors">
                                            <Plus size={12} /> Add Year
                                        </button>
                                    )}
                                </div>

                                {/* Lock-in period */}
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                    <Lock size={11} className="text-[#03a9e7] shrink-0" />
                                    <span className="shrink-0">Lock-in period:</span>
                                    <input type="number" min={1} max={10}
                                        value={data.reference_lockin_years ?? ''}
                                        placeholder={hasPkg && (data.selected_package_snapshot?.lockin_years as number | undefined) != null
                                            ? String(data.selected_package_snapshot?.lockin_years) : 'yrs'}
                                        onChange={e => update({ reference_lockin_years: e.target.value === '' ? undefined : parseInt(e.target.value) })}
                                        className="w-14 px-2 py-1 rounded-md border border-slate-200 bg-white text-center font-medium text-slate-700 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12" />
                                    <span>yrs</span>
                                    {hasPkg && (data.selected_package_snapshot?.lockin_years as number | undefined) != null && data.reference_lockin_years == null && (
                                        <span className="text-[11px] text-slate-400">(from package)</span>
                                    )}
                                </div>

                                {/* Per-year interest cards */}
                                {lockInCards.length > 0 && (
                                    <div className="flex gap-2 flex-wrap">
                                        {lockInCards.map(({ year, value, instalment }, i) => {
                                            const isLast = i === lockInCards.length - 1
                                            return isLast ? (
                                                <div key={year} className="flex-1 min-w-[120px] rounded-xl border-2 border-[#052d4a] bg-[#052d4a] text-white px-4 py-3">
                                                    <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">Total Int · Yr {year}</p>
                                                    <p className="text-xl font-black mt-0.5">{value != null ? money2(value) : '—'}</p>
                                                    {instalment != null && <p className="text-[11px] opacity-60 mt-0.5">{money2(instalment)}/mo</p>}
                                                </div>
                                            ) : (
                                                <div key={year} className="flex-1 min-w-[100px] rounded-xl border border-slate-200 bg-white px-4 py-3">
                                                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Int · Yr {year}</p>
                                                    <p className="text-lg font-black text-[#052d4a] mt-0.5">{value != null ? money2(value) : '—'}</p>
                                                    {instalment != null && <p className="text-[11px] text-slate-400 mt-0.5">{money2(instalment)}/mo</p>}
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}

                                {/* Tenure range label */}
                                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                                    Tenure Range: {t.min} – {t.max} yrs
                                </div>

                                {/* Tenure inputs */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <label className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">Preferred Tenure 1</label>
                                        <div className="flex items-center gap-2">
                                            <input type="number" min={t.min} max={t.max}
                                                value={rawPrefTenure1 !== '' ? rawPrefTenure1 : (data.preferred_tenure_1 != null ? String(data.preferred_tenure_1) : '')}
                                                placeholder={String(defaultT)}
                                                onChange={e => setRawPrefTenure1(e.target.value)}
                                                onBlur={() => {
                                                    const parsed = parseInt(rawPrefTenure1, 10)
                                                    setRawPrefTenure1('')
                                                    update({ preferred_tenure_1: isNaN(parsed) ? undefined : clamp(parsed) })
                                                }}
                                                className={inputCls} />
                                            <span className="text-xs text-slate-500">yrs</span>
                                        </div>
                                        {data.preferred_tenure_1 == null && <p className="text-[11px] text-slate-400">Defaults to remaining tenure</p>}
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">Preferred Tenure 2</label>
                                        <div className="flex items-center gap-2">
                                            <input type="number" min={t.min} max={t.max}
                                                value={rawPrefTenure2 !== '' ? rawPrefTenure2 : (preferredTenure2 != null ? String(preferredTenure2) : '')}
                                                placeholder={String(defaultT)}
                                                onChange={e => setRawPrefTenure2(e.target.value)}
                                                onBlur={() => {
                                                    const parsed = parseInt(rawPrefTenure2, 10)
                                                    setRawPrefTenure2('')
                                                    setPreferredTenure2(isNaN(parsed) ? undefined : clamp(parsed))
                                                }}
                                                className={inputCls} />
                                            <span className="text-xs text-slate-500">yrs</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Comparison table */}
                                <div className="rounded-xl border border-slate-200 overflow-hidden">
                                    <div className="grid grid-cols-3 border-b border-slate-100 bg-slate-50/60">
                                        <div className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Option</div>
                                        <div className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide border-l border-slate-100 text-right">Tenure 1 ({t1} yrs)</div>
                                        <div className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide border-l border-slate-100 text-right">Tenure 2 ({t2} yrs)</div>
                                    </div>
                                    <div className="grid grid-cols-3 border-b border-slate-100">
                                        <div className="px-3 py-2.5 text-slate-600 text-sm">Monthly Instalment</div>
                                        <div className="px-3 py-2.5 text-right font-semibold text-[#052d4a] border-l border-slate-100 text-sm">
                                            {m1 != null ? <>{money2(m1)}<span className="text-slate-400 font-normal">/mo</span></> : <span className="text-slate-300">—</span>}
                                        </div>
                                        <div className="px-3 py-2.5 text-right font-semibold border-l border-slate-100 text-sm">
                                            {m1 != null && m2 != null ? (
                                                <>{money2(m2)}<span className="text-slate-400 font-normal">/mo</span>
                                                <span className={`ml-1.5 text-[11px] font-bold ${m2 > m1 ? 'text-red-500' : 'text-emerald-600'}`}>
                                                    {m2 > m1 ? '+' : ''}{money2(m2 - m1)}
                                                </span></>
                                            ) : <span className="text-slate-300">—</span>}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3">
                                        <div className="px-3 py-2.5 text-slate-600 text-sm">
                                            {effectiveLockin != null ? `Interest (${effectiveLockin}-yr lock-in)` : 'Lock-in Interest'}
                                        </div>
                                        <div className="px-3 py-2.5 text-right font-semibold text-slate-700 border-l border-slate-100 text-sm">
                                            {i1 != null ? money2(i1) : <span className="text-slate-300">—</span>}
                                        </div>
                                        <div className="px-3 py-2.5 text-right font-semibold border-l border-slate-100 text-sm">
                                            {i1 != null && i2 != null ? (
                                                <>{money2(i2)}
                                                <span className={`ml-1.5 text-[11px] font-bold ${i2 > i1 ? 'text-red-500' : 'text-emerald-600'}`}>
                                                    {i2 > i1 ? '+' : ''}{money2(i2 - i1)}
                                                </span></>
                                            ) : <span className="text-slate-300">—</span>}
                                        </div>
                                    </div>
                                </div>

                                {/* Year-by-year breakdown — both tenures */}
                                {[
                                    { rows: amortRows1, tv: t1, label: 'Tenure 1' },
                                    { rows: amortRows2, tv: t2, label: 'Tenure 2' },
                                ].map(({ rows, tv, label }) => rows.length > 0 && (
                                    <div key={label} className="rounded-lg border border-slate-200 overflow-hidden">
                                        <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                                            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Year-by-Year Breakdown</span>
                                            <span className="text-[11px] text-slate-400">
                                                {effectiveLockin != null ? 'Lock-in · ' : ''}{label} ({tv} yrs)
                                            </span>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr className="border-b border-slate-100 bg-slate-50/50">
                                                        <th className="py-2 pl-3 pr-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wide">YR</th>
                                                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Rate</th>
                                                        <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Monthly</th>
                                                        <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Prin /mo</th>
                                                        <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Int /mo</th>
                                                        <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Int (yr)</th>
                                                        <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Balance</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {rows.filter(r => r.year <= breakdownYears).map(row => {
                                                        const hasData = row.instalment != null
                                                        const isLastRow = row.year === breakdownYears
                                                        return (
                                                            <tr key={row.year} className={`border-b border-slate-50 last:border-b-0 ${isLastRow ? 'bg-sky-50/50' : 'bg-white'}`}>
                                                                <td className="py-2.5 pl-3 pr-3">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <div className="w-0.5 h-4 rounded-full bg-[#03a9e7] shrink-0" />
                                                                        <span className="font-semibold text-[#052d4a]">{row.year}</span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-3 py-2.5 text-[#03a9e7] font-semibold">{hasData ? `${row.rate?.toFixed(2)}%` : '—'}</td>
                                                                <td className="px-3 py-2.5 text-right text-slate-700">{fmt2(row.instalment)}</td>
                                                                <td className="px-3 py-2.5 text-right text-slate-600">{fmt2(row.monthPrincipal)}</td>
                                                                <td className="px-3 py-2.5 text-right text-slate-600">{fmt2(row.monthInterest)}</td>
                                                                <td className="px-3 py-2.5 text-right text-slate-600">{fmt2(row.yearInterest)}</td>
                                                                <td className="px-3 py-2.5 text-right">
                                                                    {hasData ? (
                                                                        isLastRow
                                                                            ? <span className="font-black text-[#052d4a] bg-sky-100 border border-sky-200 px-2 py-0.5 rounded-full">{fmt2(row.balance)}</span>
                                                                            : <span className="font-semibold text-slate-700">{fmt2(row.balance)}</span>
                                                                    ) : '—'}
                                                                </td>
                                                            </tr>
                                                        )
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ))}

                                {effectiveLockin == null && (
                                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                                        <Info size={11} className="text-[#03a9e7]" /> Set lock-in period above to see per-year interest cards.
                                    </p>
                                )}
                            </Section>
                        )
                    })()}

                    {/* Cost of refinancing */}
                    {remarks.cost.length > 0 && (
                        <Section title="Cost of Refinancing" icon={<Receipt size={15} />}>
                            <div className="rounded-lg border border-slate-200 overflow-hidden">
                                {remarks.cost.map((line, i) => {
                                    const [label, ...rest] = line.split(':')
                                    return (
                                        <div key={i} className={`flex items-start justify-between gap-4 px-4 py-3 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                                            <span className="text-sm text-slate-600">{label}</span>
                                            <span className="text-sm font-semibold text-[#052d4a] text-right">{rest.join(':').trim()}</span>
                                        </div>
                                    )
                                })}
                            </div>
                        </Section>
                    )}

                    {/* Remarks */}
                    <RemarksCard remarks={remarks} />

                    {/* Next step */}
                    <NextStepCard
                        embedded={!!embedded}
                        currentStage={currentStage}
                        suggestedStage={suggestedStage}
                        onStageAdvance={onStageAdvance}
                        actions={actions}
                        actionsDone={actionsDone}
                        onToggleAction={toggleAction}
                        followUpDate={followUpDate}
                        onSetFollowUp={onSetFollowUp}
                        onPresent={() => setPresentationOpen(true)}
                        onOpenProposal={() => setProposalOpen(true)}
                    />
                </>
            ) : (
                <div className="card p-8 text-center text-sm text-slate-400">
                    Enter the property type, outstanding loan, borrower age(s) and year of purchase to see the tenure range and packages.
                </div>
            )}

            {/* Hand-off — leaves the advisory workflow and goes to the internal
                tab to capture the client's details, set the stage, or close. */}
            {embedded && onContinue && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-[#03a9e7]/25 bg-sky-50/40 p-4">
                    <p className="text-xs text-slate-500 flex items-center gap-1.5">
                        <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                        Saved automatically.{hasClientName ? '' : ' Add the client’s details to finish.'}
                    </p>
                    <button type="button" onClick={onContinue}
                        className="btn-primary text-sm px-5 py-2.5 flex items-center gap-2">
                        {hasClientName ? 'Save & continue' : 'Add client details & save'} <ArrowRight size={16} />
                    </button>
                </div>
            )}

            {presentationOpen && (
                <RefiPresentation
                    clientName={clientName}
                    propertyLabel={meta?.label ?? 'Property'}
                    currentBank={data.current_bank}
                    currentRatePct={data.current_rate}
                    totalOutstanding={computation.totalOutstanding}
                    computation={computation}
                    remarks={remarks}
                    selectedPackage={selectedPackage}
                    onClose={() => setPresentationOpen(false)}
                    onOpenChatSummary={() => { setPresentationOpen(false); setProposalOpen(true) }}
                />
            )}

            {proposalOpen && (
                <Modal title="Chat summary" onClose={() => setProposalOpen(false)}>
                    <ProposalView text={proposalText} />
                </Modal>
            )}
        </div>
    )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
    return (
        <div className="card p-5 space-y-4">
            <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                {icon && <span className="text-[#03a9e7]">{icon}</span>}{title}
            </p>
            {children}
        </div>
    )
}

interface PillOption { value: string; label: string; disabled?: boolean }
function PillSelect({ value, onChange, options }: { value?: string; onChange: (v: string) => void; options: PillOption[] }) {
    return (
        <div className="flex flex-wrap gap-2">
            {options.map(opt => (
                <button key={opt.value} type="button" disabled={opt.disabled} onClick={() => onChange(opt.value)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                        opt.disabled ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
                            : value === opt.value
                                ? 'bg-[#052d4a] border-[#052d4a] text-white'
                                : 'bg-white border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7]'
                    }`}>
                    {opt.label}
                </button>
            ))}
        </div>
    )
}

function YesNo({ value, onChange }: { value?: boolean; onChange: (v: boolean) => void }) {
    return (
        <PillSelect
            value={value === undefined ? undefined : value ? 'yes' : 'no'}
            onChange={v => onChange(v === 'yes')}
            options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
        />
    )
}

function CheckRow({ label, hint, checked, onToggle }: { label: string; hint?: string; checked: boolean; onToggle: () => void }) {
    return (
        <button type="button" onClick={onToggle} className="flex items-start gap-2.5 text-left w-full group">
            {checked
                ? <CheckCircle2 size={18} className="text-[#03a9e7] shrink-0 mt-0.5" />
                : <Circle size={18} className="text-slate-300 group-hover:text-[#03a9e7] shrink-0 mt-0.5" />}
            <span>
                <span className={`text-sm font-medium ${checked ? 'text-[#052d4a]' : 'text-slate-700'}`}>{label}</span>
                {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
            </span>
        </button>
    )
}

function RemarksCard({ remarks }: { remarks: RefiRemarks }) {
    const all = [...remarks.standard, ...remarks.conditional]
    if (!all.length && !remarks.alerts.length) return null
    return (
        <div className="space-y-3">
            {remarks.alerts.map((a, i) => (
                <div key={i} className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-[13px] text-amber-800 leading-relaxed">{a}</p>
                </div>
            ))}
            {all.length > 0 && (
                <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-5">
                    <p className="text-sm font-bold text-violet-800 flex items-center gap-2 mb-3">
                        <Lightbulb size={15} /> Remarks — advise the client
                    </p>
                    <ul className="space-y-2.5">
                        {all.map((r, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-[13px] text-violet-900 leading-relaxed">
                                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0 mt-1.5" />
                                <span>{r}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    )
}

// ─── Next step ────────────────────────────────────────────────────────────────

interface NextStepProps {
    embedded: boolean
    currentStage?: string
    suggestedStage: string | null
    onStageAdvance?: (toStage: string) => void
    actions: string[]
    actionsDone: string[]
    onToggleAction: (a: string) => void
    followUpDate?: string
    onSetFollowUp?: (date: string) => void
    onPresent: () => void
    onOpenProposal: () => void
}

function NextStepCard({
    embedded, currentStage, suggestedStage, onStageAdvance,
    actions, actionsDone, onToggleAction, followUpDate, onSetFollowUp, onPresent, onOpenProposal,
}: NextStepProps) {
    const [follow, setFollow] = useState(followUpDate ?? '')
    return (
        <div className="rounded-xl border-2 border-[#052d4a]/15 bg-gradient-to-b from-slate-50 to-white p-5 space-y-4">
            <p className="text-sm font-bold text-[#052d4a] flex items-center gap-2">
                <ArrowRight size={16} className="text-[#03a9e7]" /> Next step
            </p>

            <div className="flex flex-wrap gap-2.5">
                <button type="button" onClick={onPresent} className="btn-primary text-sm px-4 py-2 flex items-center gap-2">
                    <Presentation size={15} /> Present to client
                </button>
                <button type="button" onClick={onOpenProposal}
                    className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 flex items-center gap-2">
                    <MessageSquare size={15} /> Chat summary
                </button>
                {embedded && suggestedStage && onStageAdvance && (
                    <button type="button" onClick={() => onStageAdvance(suggestedStage)}
                        className="text-sm px-4 py-2 rounded-lg border border-[#03a9e7] text-[#03a9e7] font-semibold hover:bg-sky-50 flex items-center gap-2">
                        Advance to {suggestedStage} <ArrowRight size={14} />
                    </button>
                )}
            </div>
            {embedded && currentStage && (
                <p className="text-[11px] text-slate-400">Current stage: <span className="font-medium text-slate-600">{currentStage}</span></p>
            )}

            {actions.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5 mb-2">
                        <ClipboardList size={13} /> What to do next
                    </p>
                    <ul className="space-y-1.5">
                        {actions.map(a => {
                            const done = actionsDone.includes(a)
                            return (
                                <li key={a}>
                                    <button type="button" onClick={() => onToggleAction(a)} className="flex items-start gap-2.5 text-left w-full group">
                                        {done
                                            ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                                            : <Circle size={16} className="text-slate-300 group-hover:text-[#03a9e7] shrink-0 mt-0.5" />}
                                        <span className={`text-[13px] ${done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{a}</span>
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                </div>
            )}

            {embedded && onSetFollowUp && (
                <div className="flex flex-wrap items-end gap-2.5 pt-1 border-t border-slate-100">
                    <div className="pt-3">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                            <CalendarClock size={13} /> Follow-up reminder
                        </p>
                        <input type="date" value={follow} onChange={e => setFollow(e.target.value)}
                            className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12" />
                    </div>
                    <button type="button" disabled={!follow} onClick={() => onSetFollowUp(follow)}
                        className="text-sm px-4 py-2 rounded-lg bg-[#052d4a] text-white font-semibold disabled:opacity-40">
                        Set reminder
                    </button>
                    {followUpDate && <span className="text-[11px] text-emerald-600 pb-2.5">Saved · {followUpDate}</span>}
                </div>
            )}
        </div>
    )
}

// ─── Tenure Comparison ────────────────────────────────────────────────────────

interface TenureComparisonProps {
    loan: number
    ratePct: number | null
    rateLabel: string | null
    lockinYears: number
    tenureMin: number
    tenureMax: number
    tenure1: number
    tenure2: number
    onT1Change: (v: number) => void
    onT2Change: (v: number) => void
    grossIncome: number | null
    existingDebts: number
    propertyUse?: 'own_stay' | 'investment'
}

function TenureComparison({ loan, ratePct, rateLabel, lockinYears, tenureMin, tenureMax, tenure1, tenure2, onT1Change, onT2Change, grossIncome, existingDebts, propertyUse }: TenureComparisonProps) {
    const canPrice = ratePct != null && loan > 0 && tenure1 > 0 && tenure2 > 0

    const m1 = canPrice ? monthlyInstallment(loan, ratePct!, tenure1) : null
    const m2 = canPrice ? monthlyInstallment(loan, ratePct!, tenure2) : null
    const i1 = canPrice ? interestOverPeriod(loan, ratePct!, tenure1, lockinYears) : null
    const i2 = canPrice ? interestOverPeriod(loan, ratePct!, tenure2, lockinYears) : null

    const tdsrAvail = grossIncome != null ? tdsrAvailable(grossIncome, existingDebts) : null
    const tdsr1 = tdsrAvail != null && tenure1 > 0 ? maxLoanFromPayment(tdsrAvail, STRESS_TEST_RATE * 100, tenure1) : null
    const tdsr2 = tdsrAvail != null && tenure2 > 0 ? maxLoanFromPayment(tdsrAvail, STRESS_TEST_RATE * 100, tenure2) : null

    const better = (a: number | null, b: number | null, lowerIsBetter: boolean): 'a' | 'b' | null => {
        if (a == null || b == null || a === b) return null
        return lowerIsBetter ? (a < b ? 'a' : 'b') : (a > b ? 'a' : 'b')
    }

    const mBetter = better(m1, m2, true)
    const iBetter = better(i1, i2, true)
    const tBetter = better(tdsr1, tdsr2, false)

    const cell = (val: number | null, side: 'a' | 'b', winner: 'a' | 'b' | null) => (
        <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${winner === side ? 'text-emerald-700' : 'text-[#052d4a]'}`}>
            {val != null ? money(val) : '—'}
        </td>
    )

    const diffCell = (v1: number | null, v2: number | null, lowerIsBetter: boolean) => {
        if (!canPrice || v1 == null || v2 == null) return <td className="px-4 py-2.5 text-right text-slate-300 text-xs">—</td>
        const diff = v2 - v1
        if (diff === 0) return <td className="px-4 py-2.5 text-right text-slate-400 text-xs">—</td>
        const good = lowerIsBetter ? diff < 0 : diff > 0
        return (
            <td className={`px-4 py-2.5 text-right text-[11px] font-semibold tabular-nums ${good ? 'text-emerald-600' : 'text-red-500'}`}>
                {diff < 0 ? '↓' : '↑'} {money(Math.abs(diff))}
            </td>
        )
    }

    return (
        <Section title="Tenure Comparison" icon={<CalendarRange size={15} />}>
            {/* Rate source */}
            {rateLabel
                ? <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><Info size={12} className="text-[#03a9e7]" /> Rate used: {rateLabel}</p>
                : <p className="text-[11px] text-amber-600 flex items-center gap-1.5"><AlertTriangle size={12} /> Enter current interest rate or select a package to price the comparison.</p>
            }

            {/* Table — tenure inputs embedded in column headers */}
            <div className="rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="text-left px-4 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide w-2/5" />
                            <th className="px-4 py-2 text-right">
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Tenure 1</p>
                                <div className="inline-flex items-center gap-1 border border-slate-200 rounded-md px-2 py-1 bg-white">
                                    <input type="number" value={tenure1 || ''} min={tenureMin} max={tenureMax}
                                        onChange={e => { const v = parseFloat(e.target.value) || 0; onT1Change(v ? Math.min(Math.max(v, tenureMin), tenureMax) : 0) }}
                                        className="w-9 text-center text-sm font-bold text-[#052d4a] outline-none bg-transparent" placeholder="—" />
                                    <span className="text-[11px] text-slate-400">yrs</span>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-0.5">{tenureMin}–{tenureMax} yrs</p>
                            </th>
                            <th className="px-4 py-2 text-right">
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Tenure 2</p>
                                <div className="inline-flex items-center gap-1 border border-slate-200 rounded-md px-2 py-1 bg-white">
                                    <input type="number" value={tenure2 || ''} min={tenureMin} max={tenureMax}
                                        onChange={e => { const v = parseFloat(e.target.value) || 0; onT2Change(v ? Math.min(Math.max(v, tenureMin), tenureMax) : 0) }}
                                        className="w-9 text-center text-sm font-bold text-[#052d4a] outline-none bg-transparent" placeholder="—" />
                                    <span className="text-[11px] text-slate-400">yrs</span>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-0.5">{tenureMin}–{tenureMax} yrs</p>
                            </th>
                            <th className="text-right px-4 py-2 text-[11px] font-semibold text-slate-400">Diff</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr className="border-b border-slate-100">
                            <td className="px-4 py-2.5 text-slate-600">Monthly Instalment</td>
                            {cell(m1, 'a', mBetter)}
                            {cell(m2, 'b', mBetter)}
                            {diffCell(m1, m2, true)}
                        </tr>
                        <tr className={grossIncome != null && grossIncome > 0 ? 'border-b border-slate-100' : ''}>
                            <td className="px-4 py-2.5 text-slate-600">
                                Total Interest
                                <span className="block text-[11px] text-slate-400">over {lockinYears}-yr lock-in period</span>
                            </td>
                            {cell(i1, 'a', iBetter)}
                            {cell(i2, 'b', iBetter)}
                            {diffCell(i1, i2, true)}
                        </tr>
                        {grossIncome != null && grossIncome > 0 && (() => {
                            const pass1 = tdsr1 != null ? loan <= tdsr1 : null
                            const pass2 = tdsr2 != null ? loan <= tdsr2 : null
                            const passCell = (pass: boolean | null) => (
                                <td className="px-4 py-2.5 text-right font-semibold">
                                    {pass === null ? <span className="text-slate-300">—</span>
                                        : pass ? <span className="text-emerald-600">Pass</span>
                                        : <span className="text-red-500">Fail</span>}
                                </td>
                            )
                            return (
                                <>
                                    <tr className="border-b border-slate-100">
                                        <td className="px-4 py-2.5 text-slate-600">Max Eligible Loan</td>
                                        {cell(tdsr1, 'a', tBetter)}
                                        {cell(tdsr2, 'b', tBetter)}
                                        {diffCell(tdsr1, tdsr2, false)}
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-2.5 text-slate-600">TDSR Result</td>
                                        {passCell(pass1)}
                                        {passCell(pass2)}
                                        <td />
                                    </tr>
                                </>
                            )
                        })()}
                    </tbody>
                </table>
            </div>

            {grossIncome != null && grossIncome > 0 && (() => {
                const pass1 = tdsr1 != null ? loan <= tdsr1 : null
                const pass2 = tdsr2 != null ? loan <= tdsr2 : null
                const anyFail = pass1 === false || pass2 === false
                if (!anyFail) return null
                const remedy = propertyUse === 'investment'
                    ? 'Bank will require client to pay down 3% of outstanding loan and/or show some funds to prove repayment ability.'
                    : 'Client may qualify for TDSR Waiver — to double check with banker.'
                return (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-1">
                        <p className="text-[12px] font-semibold text-amber-800">Potential Remedies</p>
                        <p className="text-[12px] text-amber-700 leading-relaxed">{remedy}</p>
                    </div>
                )
            })()}

            {(grossIncome == null || grossIncome === 0) && (
                <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                    <Info size={12} /> Provide income details above to also see TDSR loan eligibility.
                </p>
            )}
        </Section>
    )
}

let bankCache: { id: string; name: string }[] | null = null

function MultiBankSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
    const [banks, setBanks] = useState<{ id: string; name: string }[]>(bankCache ?? [])
    useEffect(() => {
        if (bankCache) { setBanks(bankCache); return }
        fetch('/api/insurance/banks')
            .then(r => r.json())
            .then(json => { bankCache = json.data ?? []; setBanks(bankCache!) })
            .catch(() => {})
    }, [])

    const toggle = (name: string) => {
        const set = new Set(value)
        if (set.has(name)) set.delete(name); else set.add(name)
        onChange([...set])
    }

    if (!banks.length) return <p className="text-[12px] text-slate-400">Loading banks…</p>
    return (
        <div className="flex flex-wrap gap-2">
            {banks.map(b => (
                <button key={b.id} type="button" onClick={() => toggle(b.name)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                        value.includes(b.name)
                            ? 'bg-[#052d4a] border-[#052d4a] text-white'
                            : 'bg-white border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7]'
                    }`}>
                    {b.name}
                </button>
            ))}
        </div>
    )
}

function OwnershipBar({ loanPct, cpfPct, cashPct, loanAmt, cpfAmt, cashAmt }: {
    loanPct: number; cpfPct: number; cashPct: number
    loanAmt: number; cpfAmt: number; cashAmt: number
}) {
    const total = loanPct + cpfPct + cashPct
    const lW = total > 0 ? (loanPct / total) * 100 : 0
    const cW = total > 0 ? (cpfPct  / total) * 100 : 0
    const hW = total > 0 ? (cashPct / total) * 100 : 0
    const fmt = (p: number) => `${(p * 100).toFixed(1)}%`
    return (
        <div className="space-y-2">
            <div className="flex rounded-lg overflow-hidden h-8" style={{ fontSize: 11 }}>
                {lW > 0 && (
                    <div style={{ width: `${lW}%` }} className="bg-[#052d4a] flex items-center justify-center text-white font-semibold">
                        {lW > 12 ? fmt(loanPct) : ''}
                    </div>
                )}
                {cW > 0 && (
                    <div style={{ width: `${cW}%` }} className="bg-sky-400 flex items-center justify-center text-white font-semibold">
                        {cW > 12 ? fmt(cpfPct) : ''}
                    </div>
                )}
                {hW > 0 && (
                    <div style={{ width: `${hW}%` }} className="bg-emerald-400 flex items-center justify-center text-white font-semibold">
                        {hW > 12 ? fmt(cashPct) : ''}
                    </div>
                )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <span className="inline-block w-3 h-3 rounded-sm bg-[#052d4a]" />
                    Loan {fmt(loanPct)} · {money(loanAmt)}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <span className="inline-block w-3 h-3 rounded-sm bg-sky-400" />
                    CPF {fmt(cpfPct)} · {money(cpfAmt)}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <span className="inline-block w-3 h-3 rounded-sm bg-emerald-400" />
                    Cash {fmt(cashPct)} · {money(cashAmt)}
                </span>
            </div>
        </div>
    )
}

function ProposalView({ text }: { text: string }) {
    const [copied, setCopied] = useState(false)
    const copy = async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* clipboard unavailable */ }
    }
    const print = () => {
        const w = window.open('', '_blank', 'width=720,height=900')
        if (!w) return
        w.document.write(`<pre style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:13px;line-height:1.6;white-space:pre-wrap;padding:24px">${text.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))}</pre>`)
        w.document.close(); w.focus(); w.print()
    }
    return (
        <div className="space-y-3">
            <div className="flex gap-2">
                <button type="button" onClick={copy} className="btn-primary text-sm px-4 py-2 flex items-center gap-2">
                    <Copy size={15} /> {copied ? 'Copied!' : 'Copy text'}
                </button>
                <button type="button" onClick={print} className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 flex items-center gap-2">
                    <Printer size={15} /> Print / Save PDF
                </button>
            </div>
            <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-4 max-h-[55vh] overflow-y-auto" style={{ fontFamily: 'inherit' }}>{text}</pre>
        </div>
    )
}

// ── Rate row for the embedded amortisation schedule ──────────────────────────

const refiRateRowInp = 'px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/10 bg-white transition-colors'
const REFI_AMORT_RATE_REFS = ['3M SORA', '1M SORA', 'Custom'] as const

function RefiAmortRateRow({
    entry, label, isLockin, onChange, onRemove, canRemove, refId,
}: {
    entry: RateScheduleEntry
    label: string
    isLockin: boolean
    onChange: (patch: Partial<RateScheduleEntry>) => void
    onRemove: () => void
    canRemove: boolean
    refId: string
}) {
    return (
        <div className={`flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 last:border-b-0 ${isLockin ? 'bg-white' : 'bg-slate-50/60'}`}>
            <div className={`w-1 h-7 rounded-full shrink-0 ${isLockin ? 'bg-[#03a9e7]' : 'bg-slate-200'}`} />
            <span className={`w-20 shrink-0 text-xs font-bold ${isLockin ? 'text-[#052d4a]' : 'text-slate-400'}`}>{label}</span>

            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs shrink-0">
                {(['fixed', 'floating'] as const).map(t => (
                    <button key={t} type="button" onClick={() => onChange({ type: t })}
                        className={`px-2.5 py-1 font-semibold capitalize transition-colors ${entry.type === t ? 'bg-[#052d4a] text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                        {t}
                    </button>
                ))}
            </div>

            {entry.type === 'fixed' ? (
                <div className="flex items-center gap-1.5 flex-1">
                    <input type="number" step="0.01" value={entry.rate ?? ''} placeholder="1.60"
                        onChange={e => onChange({ rate: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                        className={`${refiRateRowInp} w-20`} />
                    <span className="text-xs text-slate-400">%</span>
                </div>
            ) : (
                <div className="flex items-center gap-1.5 flex-1 flex-wrap">
                    <input list={refId} value={entry.reference ?? ''} placeholder="3M SORA"
                        onChange={e => {
                            const ref = e.target.value
                            onChange(ref !== 'Custom' ? { reference: ref, rate: undefined } : { reference: ref })
                        }}
                        className={`${refiRateRowInp} w-24`} />
                    <datalist id={refId}>
                        {REFI_AMORT_RATE_REFS.map(r => <option key={r} value={r} />)}
                    </datalist>
                    {entry.reference === 'Custom' && (
                        <>
                            <input type="number" step="0.01" value={entry.rate ?? ''} placeholder="0.50"
                                onChange={e => onChange({ rate: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                                className={`${refiRateRowInp} w-16`} />
                            <span className="text-xs text-slate-400">%</span>
                        </>
                    )}
                    <span className="text-xs text-slate-400">+</span>
                    <input type="number" step="0.01" value={entry.spread ?? ''} placeholder="0.35"
                        onChange={e => onChange({ spread: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                        className={`${refiRateRowInp} w-16`} />
                    <span className="text-xs text-slate-400">%</span>
                </div>
            )}

            {canRemove && (
                <button type="button" onClick={onRemove}
                    className="ml-auto p-1 text-slate-300 hover:text-red-400 hover:bg-red-50 rounded-lg transition-colors shrink-0">
                    <Trash2 size={12} />
                </button>
            )}
        </div>
    )
}

