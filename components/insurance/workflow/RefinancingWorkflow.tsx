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
    Presentation, MessageSquare, Percent,
} from 'lucide-react'

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

    // ── Tenure Comparison — rate source ──
    const snapshotRate = data.selected_package_snapshot?.avg_rate_lockin_pct as number | undefined
    const compRate: number | null = snapshotRate ?? data.current_rate ?? null
    const compRateLabel: string | null = snapshotRate != null
        ? `${data.selected_package_snapshot?.bank ?? 'selected package'} @ ${snapshotRate.toFixed(2)}% avg lock-in`
        : data.current_rate != null ? `current rate ${data.current_rate}% p.a.` : null
    const compLockinYears: number = (((data.selected_package_snapshot?.lockin_years as number | undefined) ?? 2) || 1)

    // ── Tenure Comparison — TDSR inputs ──
    const grossForTdsr = useMemo(() => {
        if (!data.provide_income) return null
        const total = agedBorrowers.reduce((s, { b }) => s + effectiveMonthlyIncome({
            basicMonthlySalary: b.basic_salary,
            annualVariableIncome: b.annual_variable,
            isSelfEmployed: b.employment === 'self_employed',
        }), 0)
        return total > 0 ? total : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.provide_income, data.borrowers])

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
            </Section>

            {/* ── Current loan ── */}
            {data.property_type && (
                <Section title="Current Loan" icon={<Wallet size={15} />}>
                    <Question label="Outstanding loan amount (disbursed)" required>
                        <FieldInput commas prefix="$" value={data.outstanding_disbursed ?? ''} placeholder="e.g. 800,000"
                            onChange={v => update({ outstanding_disbursed: num(v) })} />
                    </Question>

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
                        const total = (data.outstanding_disbursed ?? 0) + (data.outstanding_undisbursed ?? 0)
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
                        <Question label="Current interest rate">
                            <FieldInput type="number" suffix="% p.a." value={data.current_rate ?? ''} placeholder="e.g. 3.5"
                                onChange={v => update({ current_rate: num(v) })} />
                        </Question>
                    </div>

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

                    <Question label="Provide income details for an Income-Weighted Average Age (more accurate tenure)?">
                        <YesNo value={data.provide_income} onChange={v => update({ provide_income: v })} />
                        <p className="text-[11px] text-slate-400 mt-1.5 flex items-start gap-1.5">
                            <Info size={12} className="mt-0.5 shrink-0" />
                            If no, we use the simple average age for the tenure range.
                        </p>
                    </Question>

                    {data.provide_income && (
                        agedBorrowers.length > 0 ? (
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
                                                <Question label="Monthly basic salary">
                                                    <FieldInput commas prefix="$" value={b.basic_salary ?? ''}
                                                        onChange={v => updateBorrower(i, { basic_salary: num(v) })} />
                                                </Question>
                                            )}
                                            <Question label={b.employment === 'self_employed' ? 'Annual income (NOA)' : 'Annual bonus / variable income'}>
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
                            <p className="text-[12px] text-amber-600 flex items-center gap-1.5"><AlertTriangle size={12} /> Enter at least one borrower&apos;s age above to capture income.</p>
                        )
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

            {/* ── Year of purchase + current tenure ── */}
            {data.property_type && (
                <Section title="Tenure" icon={<CalendarRange size={15} />}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Question label="Year of purchase" required>
                            <FieldInput type="number" value={data.year_of_purchase ?? ''} placeholder="e.g. 2018"
                                onChange={v => update({ year_of_purchase: num(v) })} />
                        </Question>
                        <Question label="Current Tenure (remaining years on existing loan)">
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
                    </div>
                </Section>
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

                    {/* Tenure comparison — below tenure range */}
                    {computation.totalOutstanding > 0 && (() => {
                        const defaultT = data.current_tenure ?? t.max
                        const prefT1 = data.preferred_tenure_1 ?? defaultT
                        const prefT2 = data.preferred_tenure_2 ?? defaultT
                        return (
                            <TenureComparison
                                loan={computation.totalOutstanding}
                                ratePct={compRate}
                                rateLabel={compRateLabel}
                                lockinYears={compLockinYears}
                                tenure1={prefT1}
                                tenure2={prefT2}
                                onT1Change={v => update({ preferred_tenure_1: v || undefined })}
                                onT2Change={v => update({ preferred_tenure_2: v || undefined })}
                                grossIncome={grossForTdsr}
                                existingDebts={debtsForTdsr}
                                propertyUse={data.property_use}
                            />
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
    tenure1: number
    tenure2: number
    onT1Change: (v: number) => void
    onT2Change: (v: number) => void
    grossIncome: number | null
    existingDebts: number
    propertyUse?: 'own_stay' | 'investment'
}

function TenureComparison({ loan, ratePct, rateLabel, lockinYears, tenure1, tenure2, onT1Change, onT2Change, grossIncome, existingDebts, propertyUse }: TenureComparisonProps) {
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
                                    <input type="number" value={tenure1 || ''} onChange={e => onT1Change(parseFloat(e.target.value) || 0)}
                                        className="w-9 text-center text-sm font-bold text-[#052d4a] outline-none bg-transparent" placeholder="—" />
                                    <span className="text-[11px] text-slate-400">yrs</span>
                                </div>
                            </th>
                            <th className="px-4 py-2 text-right">
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Tenure 2</p>
                                <div className="inline-flex items-center gap-1 border border-slate-200 rounded-md px-2 py-1 bg-white">
                                    <input type="number" value={tenure2 || ''} onChange={e => onT2Change(parseFloat(e.target.value) || 0)}
                                        className="w-9 text-center text-sm font-bold text-[#052d4a] outline-none bg-transparent" placeholder="—" />
                                    <span className="text-[11px] text-slate-400">yrs</span>
                                </div>
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
