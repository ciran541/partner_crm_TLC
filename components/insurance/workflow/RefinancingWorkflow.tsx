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
import { caseDocumentsFromWorkflow, type CaseDocument } from '@/lib/insurance/caseDocuments'
import DocumentsToPrepare from './DocumentsToPrepare'
import ShareDocChecklist from './ShareDocChecklist'
import { monthlyInstallment, effectiveMonthlyIncome, tdsrAvailable, maxLoanFromPayment, STRESS_TEST_RATE } from '@/lib/insurance/loanCalc'
import { computeAmortization } from '@/lib/insurance/amortCalc'
import { type RateScheduleEntry } from '@/lib/types/rates'
import type { RefiProposalPackage } from '@/lib/insurance/refiProposal'
import { buildRefiProposalText } from '@/lib/insurance/refiProposal'
import type { RecommendedPackage } from '@/lib/insurance/rateRecommend'
import { promoSnapshot, type MatchedPromotion } from '@/lib/insurance/promotions'
import type { SoraRates } from '@/lib/insurance/sora'
import { Question, FieldInput, AgentNotesCard, Tip, TipGroup } from '@/components/insurance/workflow/WorkflowStep'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import Modal from '@/components/shared/Modal'
import PotentialSavings from './PotentialSavings'
import RefiPackages from './RefiPackages'
import RefiPresentation from './RefiPresentation'
import MultiBankSelect from './MultiBankSelect'
import {
    Building2, CheckCircle2, AlertTriangle, Info, Lightbulb, Save, Wallet, Receipt,
    ArrowRight, ClipboardList, CalendarClock, CalendarRange, Copy, Printer, Circle,
    Presentation, MessageSquare, Percent, Lock, Plus, Trash2, Mail,
} from 'lucide-react'

const pct = (frac: number, dp = 1) => `${(frac * 100).toFixed(dp)}%`

interface Props {
    data: RefinancingWorkflow
    onChange: (updated: RefinancingWorkflow) => void
    clientName?: string
    clientEmail?: string
    caseId?: string
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

const STAGE_ORDER = ['Touched Base', 'Pending Docs', 'IPA', 'Pending Approval', 'Pending Signature']
const SUBSIDY_PRESETS = ['0', '2000', '2500']

const money = (n: number) => `$${Math.floor(n).toLocaleString()}`
const num = (v: string) => (v.trim() === '' ? undefined : parseFloat(v.replace(/,/g, '')))

export default function RefinancingWorkflowPanel({
    data, onChange, clientName, clientEmail, caseId, embedded, saving, saved,
    currentStage, onStageAdvance, onSetFollowUp, followUpDate,
    hasClientName, onContinue,
}: Props) {
    const update = (patch: Partial<RefinancingWorkflow>) => onChange({ ...data, ...patch })
    const [proposalOpen, setProposalOpen] = useState(false)
    const [presentationOpen, setPresentationOpen] = useState(false)
    const [sendingReport, setSendingReport] = useState(false)
    const [reportSent, setReportSent] = useState(false)
    const [reportError, setReportError] = useState<string | null>(null)

    const handleSendReport = async () => {
        if (!caseId) return
        setSendingReport(true)
        setReportError(null)
        try {
            const res = await fetch(`/api/insurance/cases/${caseId}/send-report`, { method: 'POST' })
            const body = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(body.error ?? 'Failed to send report')
            setReportSent(true)
            setTimeout(() => setReportSent(false), 4000)
        } catch (e) {
            setReportError(e instanceof Error ? e.message : 'Failed to send report')
            setTimeout(() => setReportError(null), 5000)
        } finally {
            setSendingReport(false)
        }
    }
    const [customSubsidy, setCustomSubsidy] = useState(
        data.subsidy_return_amount != null && !SUBSIDY_PRESETS.includes(String(data.subsidy_return_amount)),
    )
    const [soraForAmort, setSoraForAmort] = useState<SoraRates | null>(null)
    const [preferredTenure2, setPreferredTenure2] = useState<number | undefined>()
    const [rawPrefTenure1, setRawPrefTenure1] = useState('')
    const [rawPrefTenure2, setRawPrefTenure2] = useState('')
    const [estEligTenure, setEstEligTenure] = useState<number | undefined>(undefined)
    const [estEligDraft, setEstEligDraft] = useState<string>('')
    const [rawRefiTenure, setRawRefiTenure] = useState('')
    const [rawEquityOutTenure, setRawEquityOutTenure] = useState('')
    const [rawEquityNewTenure, setRawEquityNewTenure] = useState('')
    const [preferredEquityAmortT2, setPreferredEquityAmortT2] = useState<number | undefined>()
    const [rawEquityAmortT1, setRawEquityAmortT1] = useState('')
    const [rawEquityAmortT2, setRawEquityAmortT2] = useState('')
    const [showCompare, setShowCompare] = useState(false)

    useEffect(() => {
        fetch('/api/insurance/rates')
            .then(r => r.json())
            .then(d => { if (d.sora) setSoraForAmort(d.sora) })
            .catch(() => {})
    }, [])

    const meta = refiPropertyMeta(data.property_type)
    const computation = useMemo(() => computeRefi(inputsFromWorkflow(data)), [data])
    const ageCheck = computation.ageCheck
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
        const newMeta = refiPropertyMeta(type)
        // Undisbursed only applies to BUC types
        if (!newMeta?.buc) patch.outstanding_undisbursed = undefined
        // Equity loan fields only where canEquityLoan
        if (!newMeta?.canEquityLoan) {
            patch.outstanding_equity_loan = undefined
            patch.current_equity_loan_tenure = undefined
            patch.equity_loan_amount = undefined
            patch.preferred_tenure_equity = undefined
            patch.preferred_tenure_equity_outstanding = undefined
        }
        // Decouple only where canDecouple
        if (!newMeta?.canDecouple) patch.decouple_now = undefined
        update(patch)
    }

    const toggleConsideration = (key: keyof NonNullable<RefinancingWorkflow['considerations']>) => {
        const c = { ...(data.considerations ?? {}) }
        c[key] = !c[key]
        update({ considerations: c })
    }

    const onSelectPackage = (rec: RecommendedPackage, sora: SoraRates | null, promos: MatchedPromotion[]) => {
        update({
            promo_snapshot: promoSnapshot(promos),
            selected_package_snapshot: {
                id: rec.pkg.id,
                bank: rec.pkg.bank,
                category: rec.pkg.category,
                package_name: rec.pkg.package_name,
                lockin_years: rec.pkg.lockin_years,
                rate_schedule: rec.pkg.rate_schedule,
                features: rec.pkg.features,
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

    const actions = refiNextActions({
        buc: meta?.buc,
        considerations: data.considerations,
        selectedBank: data.selected_package_snapshot?.bank as string | undefined,
    })
    const actionsDone = data.next_actions_done ?? []
    const toggleAction = (a: string) => {
        const set = new Set(actionsDone)
        if (set.has(a)) set.delete(a); else set.add(a)
        update({ next_actions_done: [...set] })
    }

    // Documents to prepare — shown once a package (bank) is chosen.
    const documents: CaseDocument[] = data.selected_package_snapshot
        ? caseDocumentsFromWorkflow('Refinancing', data)
        : []
    const documentsDone = data.documents_done ?? []
    const toggleDocument = (id: string) => {
        const set = new Set(documentsDone)
        if (set.has(id)) set.delete(id); else set.add(id)
        update({ documents_done: [...set] })
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
                {data.property_type === 'landed' && (
                    <TipGroup>
                        <Tip>Has your landed property obtained its Certificate of Statutory Completion (CSC)? — Some ID contractors don&apos;t obtain CSC after works are done and the property is left at Temporary Occupation Permit (TOP) status. Without CSC, most banks will not finance; DBS/SCB are open to it for now.</Tip>
                    </TipGroup>
                )}
                <Question label="Year of purchase" required>
                    <FieldInput type="number" value={data.year_of_purchase ?? ''} placeholder="e.g. 2018"
                        onChange={v => update({ year_of_purchase: num(v) })} />
                    {ageCheck.yearError && (
                        <p className="mt-1.5 text-[12px] text-red-600 flex items-start gap-1.5">
                            <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {ageCheck.yearError}
                        </p>
                    )}
                </Question>
            </Section>

            {/* ── Current loan ── */}
            {data.property_type && (
                <Section title="Current Loan" icon={<Wallet size={15} />}>
                    {meta?.canEquityLoan ? (
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
                        <Question label={!meta?.isPrivate ? 'Current Financier' : 'Current Bank'}>
                            <InsuranceBankDropdown value={data.current_bank ?? ''} onChange={v => update({ current_bank: v })} showHdb={!meta?.isPrivate} />
                        </Question>
                        <Question label="Lock-in end date">
                            <div className="flex items-center gap-2">
                                <div className="flex-1">
                                    <FieldInput type="date" value={data.lockin_end_date ?? ''} onChange={v => update({ lockin_end_date: v })} />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => update({ lockin_end_date: undefined })}
                                    className={`shrink-0 px-2.5 py-2 text-[11px] font-bold rounded-lg border transition-colors ${
                                        !data.lockin_end_date
                                            ? 'bg-slate-700 border-slate-700 text-white'
                                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700'
                                    }`}
                                >
                                    N/A
                                </button>
                            </div>
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
                            {(() => {
                                const homeTenureCap = meta?.tenureCap ?? 35
                                return (
                                    <>
                                        <FieldInput type="number" value={data.current_tenure ?? ''} placeholder="e.g. 20"
                                            onChange={v => update({ current_tenure: num(v) })}
                                            onBlur={() => {
                                                if (data.current_tenure != null) {
                                                    update({ current_tenure: Math.max(5, Math.min(homeTenureCap, data.current_tenure)) })
                                                }
                                            }} />
                                        {data.current_tenure != null && (data.current_tenure < 5 || data.current_tenure > homeTenureCap) ? (
                                            <p className="text-[11px] text-red-500 mt-1">
                                                Must be 5 – {homeTenureCap} years for {meta?.isPrivate === false ? 'HDB' : 'private property'}
                                            </p>
                                        ) : (
                                            <p className="text-[11px] text-slate-400 mt-1">5 – {homeTenureCap} years for {meta?.isPrivate === false ? 'HDB' : 'private'}</p>
                                        )}
                                    </>
                                )
                            })()}
                        </Question>
                        {meta?.canEquityLoan && (data.outstanding_equity_loan ?? 0) > 0 && (
                            <Question label="Current Equity Loan Tenure (remaining years)">
                                <FieldInput type="number" value={data.current_equity_loan_tenure ?? ''} placeholder="e.g. 10"
                                    onChange={v => update({ current_equity_loan_tenure: num(v) })}
                                    onBlur={() => {
                                        if (data.current_equity_loan_tenure != null) {
                                            update({ current_equity_loan_tenure: Math.max(5, Math.min(35, data.current_equity_loan_tenure)) })
                                        }
                                    }} />
                                {data.current_equity_loan_tenure != null && (data.current_equity_loan_tenure < 5 || data.current_equity_loan_tenure > 35) ? (
                                    <p className="text-[11px] text-red-500 mt-1">Must be 5 – 35 years</p>
                                ) : (
                                    <p className="text-[11px] text-slate-400 mt-1">5 – 35 years (to age 75)</p>
                                )}
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
                            <div className={!meta?.canDecouple ? 'opacity-40 pointer-events-none select-none' : ''}>
                                <CheckRow
                                    label="Decouple"
                                    hint={!meta?.canDecouple
                                        ? 'Not applicable for HDB / EC within MOP'
                                        : data.property_type === 'incomplete_condo'
                                            ? 'Not applicable for certain banks (Incomplete Condo without TOP)'
                                            : undefined}
                                    checked={!!data.considerations?.decouple}
                                    onToggle={() => toggleConsideration('decouple')}
                                />
                            </div>
                            <div className={!meta?.canEquityLoan ? 'opacity-40 pointer-events-none select-none' : ''}>
                                <CheckRow
                                    label="Equity Loan"
                                    hint={!meta?.canEquityLoan
                                        ? 'Not applicable for HDB / EC within MOP / Incomplete Condo or EC without CSC'
                                        : undefined}
                                    checked={!!data.considerations?.equity_loan}
                                    onToggle={() => toggleConsideration('equity_loan')}
                                />
                            </div>
                        </div>
                    </Question>

                    {/* Decouple now? */}
                    {data.considerations?.decouple && meta?.canDecouple && (
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

                </Section>
            )}

            {/* ── Loan Structure & Available Equity ── */}
            {data.property_type && (() => {
                const totalLoan = (data.outstanding_disbursed ?? 0) + (data.outstanding_equity_loan ?? 0)
                const valuation = data.market_price ?? 0
                const cpfUsed = data.cpf_used ?? 0
                const loanPct = valuation > 0 ? totalLoan / valuation : 0
                const cpfPct = valuation > 0 ? cpfUsed / valuation : 0
                const equityPctRaw = 0.75 - loanPct - cpfPct   // raw headroom — can be negative; shown as-is
                const equityPct = Math.max(0, equityPctRaw)
                const equityAmt = equityPct * valuation
                const cashPct = Math.max(0, 1 - loanPct - cpfPct)
                const cashAmt = cashPct * valuation
                const equityEligible = equityAmt >= 50_000
                const hasInputs = valuation > 0 && totalLoan > 0
                return (
                    <Section title="Loan Structure & Available Equity" icon={<Building2 size={15} />}>
                        <Question label="Total CPF accrued by all owner(s)">
                            <FieldInput commas prefix="$" value={data.cpf_used ?? ''} placeholder="e.g. 100,000"
                                onChange={v => update({ cpf_used: num(v) })} />
                        </Question>

                        {hasInputs ? (
                            <>
                                {/* Purple — Property Ownership Structure (all property types) */}
                                <div className="rounded-xl border border-[#03a9e7]/30 overflow-hidden">
                                    <div className="px-4 py-3 bg-sky-50/70 border-b border-[#03a9e7]/15">
                                        <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">Property Ownership Structure</p>
                                    </div>
                                    <div className="p-4 space-y-3">
                                        <OwnershipBar
                                            loanPct={loanPct}
                                            cpfPct={cpfPct}
                                            cashPct={cashPct}
                                            loanAmt={totalLoan}
                                            cpfAmt={cpfUsed}
                                            cashAmt={cashAmt}
                                        />
                                    </div>
                                </div>

                                {/* Orange — Available Equity + loan offer (only for eligible types) */}
                                {meta?.canEquityLoan && (
                                    <div className="space-y-2">
                                        <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">Available Equity</p>
                                        <p className="text-sm text-slate-600">
                                            75% − {pct(loanPct)} (loan) − {pct(cpfPct)} (CPF)
                                            {' '}= <span className={`font-bold ${equityPctRaw > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{pct(equityPctRaw)}</span>
                                        </p>
                                        {equityPctRaw <= 0 ? (
                                            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                                                <AlertTriangle size={13} className="text-red-500 shrink-0 mt-0.5" />
                                                <p className="text-[12px] text-red-800">Not eligible for equity loan — combined loan and CPF already reach 75% of property value.</p>
                                            </div>
                                        ) : !equityEligible ? (
                                            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                                                <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
                                                <p className="text-[12px] text-amber-800">
                                                    Available equity {money(equityAmt)} — below $50,000 minimum for an equity loan.
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                                                    <CheckCircle2 size={13} className="text-emerald-600 shrink-0 mt-0.5" />
                                                    <p className="text-[12px] text-emerald-800 font-semibold">
                                                        Available Equity: {money(equityAmt)} — eligible for an equity loan.
                                                    </p>
                                                </div>
                                                <Question label="Would you like to take up an equity loan?">
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex-1">
                                                            <FieldInput commas prefix="$"
                                                                value={data.equity_loan_amount ?? ''}
                                                                placeholder={`max ${money(equityAmt)}`}
                                                                onChange={v => {
                                                                    const n = num(v)
                                                                    update({ equity_loan_amount: n !== undefined ? Math.min(n, equityAmt) : undefined })
                                                                }} />
                                                        </div>
                                                        <button type="button"
                                                            onClick={() => update({ equity_loan_amount: Math.floor(equityAmt) })}
                                                            className="text-[11px] font-semibold text-[#03a9e7] hover:text-[#0290c5] bg-sky-50 hover:bg-sky-100 px-2.5 py-2 rounded-md shrink-0 transition-colors">
                                                            Max
                                                        </button>
                                                    </div>
                                                </Question>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        ) : (
                            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                                <Info size={12} /> Enter market price and outstanding loan above to see the property structure.
                            </p>
                        )}
                    </Section>
                )
            })()}

            {/* ── Borrowers & age ── */}
            {data.property_type && (
                <Section title="Borrower(s) & Age" icon={<CalendarRange size={15} />}>
                    <Question label="Age of all borrower(s)">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {borrowers.map((b, i) => (
                                <div key={i}>
                                    <label className={`text-[11px] ${ageCheck.invalid.includes(i) ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                                        Borrower {i + 1}{ageCheck.invalid.includes(i) && ageCheck.minAge != null ? ` · min ${ageCheck.minAge}` : ''}
                                    </label>
                                    <FieldInput type="number" value={b.age ?? ''} placeholder="0"
                                        onChange={v => updateBorrower(i, { age: num(v) })}
                                        onBlur={() => { if (b.age != null && b.age > 0) { if (b.age < 21) updateBorrower(i, { age: 21 }); else if (b.age > 75) updateBorrower(i, { age: 75 }) } }} />
                                </div>
                            ))}
                        </div>
                        {ageCheck.invalid.length > 0 && (
                            <p className="mt-2 text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
                                <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {ageCheck.error}
                            </p>
                        )}
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
            {data.property_type && !ageCheck.error && grossForTdsr != null && grossForTdsr > 0 && (() => {
                const availableTdsr = Math.max(grossForTdsr * 0.55 - debtsForTdsr, 0)
                const msrCap = meta?.useMsr ? grossForTdsr * 0.30 : null
                const effectiveAvailForHomeLoan = msrCap != null ? Math.min(availableTdsr, msrCap) : availableTdsr

                // Est. Loan Eligibility (binding = min of TDSR and MSR for home loan)
                const estEligMax = meta?.tenureCap ?? 35
                const effectiveEstEligTenure = estEligTenure ?? estEligMax
                const estEligLoan = effectiveAvailForHomeLoan > 0 && effectiveEstEligTenure > 0
                    ? maxLoanFromPayment(effectiveAvailForHomeLoan, STRESS_TEST_RATE * 100, effectiveEstEligTenure)
                    : 0

                // Refinancing TDSR: each loan as its own block
                const refiLoan = (data.outstanding_disbursed ?? 0)
                const refiTenureMax = t?.max ?? (meta?.tenureCap ?? 35)
                const refiTenureMin = t?.min ?? 5
                const refiTenure = data.preferred_tenure_refi != null
                    ? Math.max(refiTenureMin, Math.min(refiTenureMax, data.preferred_tenure_refi))
                    : refiTenureMax
                const refiStress = refiLoan > 0 && refiTenure > 0
                    ? monthlyInstallment(refiLoan, STRESS_TEST_RATE * 100, refiTenure)
                    : 0
                const refiPassTdsr = refiStress <= availableTdsr
                const refiPassMsr = msrCap != null ? refiStress <= msrCap : true
                const refiPass = refiStress > 0 ? (refiPassTdsr && refiPassMsr) : null

                // Outstanding equity loan — separate card
                const equityOutstandingLoan = meta?.canEquityLoan ? (data.outstanding_equity_loan ?? 0) : 0
                const equityMaxTenureByAge = computation.ageForTenure != null
                    ? Math.max(5, Math.min(35, Math.floor(75 - computation.ageForTenure)))
                    : 35
                const equityOutTenureMax = equityMaxTenureByAge
                const equityOutTenureMin = 5
                const equityOutstandingTenure = data.preferred_tenure_equity_outstanding != null
                    ? Math.max(equityOutTenureMin, Math.min(equityOutTenureMax, data.preferred_tenure_equity_outstanding))
                    : equityOutTenureMax
                const equityOutstandingStress = equityOutstandingLoan > 0 && equityOutstandingTenure > 0
                    ? monthlyInstallment(equityOutstandingLoan, STRESS_TEST_RATE * 100, equityOutstandingTenure)
                    : 0
                const balanceAfterHomeLoan = availableTdsr - refiStress
                const equityOutstandingPass = equityOutstandingStress > 0 ? equityOutstandingStress <= balanceAfterHomeLoan : null

                // New equity loan TDSR
                const newEquityLoan = data.equity_loan_amount ?? 0
                const equityTenureMax = equityMaxTenureByAge
                const equityTenureMin = 5
                const preferredEquityTenure = data.preferred_tenure_equity != null
                    ? Math.max(equityTenureMin, Math.min(equityTenureMax, data.preferred_tenure_equity))
                    : equityTenureMax
                const equityNewStress = newEquityLoan > 0 && preferredEquityTenure > 0
                    ? monthlyInstallment(newEquityLoan, STRESS_TEST_RATE * 100, preferredEquityTenure)
                    : 0
                const balanceAfterRefi = availableTdsr - refiStress - equityOutstandingStress
                const equityPass = newEquityLoan > 0 && equityNewStress > 0 ? equityNewStress <= balanceAfterRefi : null

                const showEquityBlock = newEquityLoan > 0

                // Pledge computation — shortfall → pledgeFund (lock 4 yrs) / showFund (liquid)
                const pledgeFromShortfall = (shortfall: number, tenure: number) => {
                    if (shortfall <= 1 || tenure <= 0) return null
                    const r = STRESS_TEST_RATE / 12
                    const n = tenure * 12
                    const payment = shortfall * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
                    const pledgeFund = (payment * 48) / 0.55
                    const showFund = pledgeFund / 0.30
                    return pledgeFund > 1 ? { pledgeFund, showFund } : null
                }
                const refiPledge = refiPass === false
                    ? pledgeFromShortfall(Math.max(0, refiLoan - maxLoanFromPayment(availableTdsr, STRESS_TEST_RATE * 100, refiTenure)), refiTenure)
                    : null
                const equityOutPledge = equityOutstandingPass === false
                    ? pledgeFromShortfall(Math.max(0, equityOutstandingLoan - maxLoanFromPayment(Math.max(0, balanceAfterHomeLoan), STRESS_TEST_RATE * 100, equityOutstandingTenure)), equityOutstandingTenure)
                    : null
                const equityNewPledge = equityPass === false
                    ? pledgeFromShortfall(Math.max(0, newEquityLoan - maxLoanFromPayment(Math.max(0, balanceAfterRefi), STRESS_TEST_RATE * 100, preferredEquityTenure)), preferredEquityTenure)
                    : null

                return (
                    <Section title="TDSR Assessment" icon={<Percent size={15} />}>
                        {/* Est. Loan Eligibility + Available TDSR */}
                        <div className="rounded-lg border border-[#03a9e7]/20 bg-sky-50/40 px-4 py-3 flex items-start justify-between gap-4 flex-wrap">
                            <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Est. Loan Eligibility</p>
                                <p className="text-xl font-bold text-[#052d4a]">{money(estEligLoan)}</p>
                                <p className="text-[11px] text-slate-400">based on {effectiveEstEligTenure} yrs</p>
                                <div className="flex items-center gap-1.5 mt-1.5">
                                    <input
                                        type="number"
                                        value={estEligDraft}
                                        placeholder={String(estEligMax)}
                                        onChange={e => setEstEligDraft(e.target.value)}
                                        onBlur={e => {
                                            const v = parseInt(e.target.value, 10)
                                            const clamped = isNaN(v) ? undefined : Math.max(1, Math.min(estEligMax, v))
                                            setEstEligTenure(clamped)
                                            setEstEligDraft(clamped != null ? String(clamped) : '')
                                        }}
                                        className="w-16 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 outline-none focus:border-[#03a9e7]"
                                    />
                                    <span className="text-[11px] text-slate-400">yrs</span>
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                                    Available TDSR{msrCap != null && msrCap < availableTdsr ? <span className="ml-1.5 text-amber-600">· MSR binding</span> : ''}
                                </p>
                                <p className="text-xl font-bold text-[#052d4a]">{money(effectiveAvailForHomeLoan)}</p>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                    {money(grossForTdsr)} × 55%{debtsForTdsr > 0 ? ` − ${money(debtsForTdsr)} commitments` : ''}
                                    {msrCap != null ? ` · MSR cap ${money(msrCap)} (30%)` : ''}
                                    {computation.usingIwaa && computation.iwaa != null ? ` · IWAA ${Math.ceil(computation.iwaa)} yrs` : computation.averageAge != null ? ` · Age ${Math.ceil(computation.averageAge)} yrs` : ''}
                                </p>
                            </div>
                        </div>

                        {/* TDSR Breakdown sub-header */}
                        <div className="flex items-center gap-3">
                            <div className="flex-1 border-t border-slate-200" />
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">TDSR Breakdown</p>
                            <div className="flex-1 border-t border-slate-200" />
                        </div>

                        {/* Home Loan TDSR block */}
                        {refiStress > 0 && (
                            <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 space-y-3">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Refinancing — Home Loan</p>
                                        <p className="text-2xl font-bold text-[#052d4a]">{money(refiLoan)}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">TDSR Required</p>
                                        <p className="text-lg font-bold text-[#052d4a]">{money(refiStress)}</p>
                                        <p className="text-[11px] text-slate-400">at {refiTenure} yrs, 4% stress</p>
                                    </div>
                                </div>

                                {/* Tenure range + preferred tenure input */}
                                <div className="space-y-1.5">
                                    <p className="text-[11px] text-slate-400">
                                        Tenure range: {refiTenureMin} – {refiTenureMax} yrs (to age 75)
                                    </p>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="number"
                                            value={rawRefiTenure !== '' ? rawRefiTenure : (data.preferred_tenure_refi != null ? String(data.preferred_tenure_refi) : '')}
                                            placeholder={String(refiTenureMax)}
                                            onChange={e => setRawRefiTenure(e.target.value)}
                                            onBlur={() => {
                                                const v = parseInt(rawRefiTenure, 10)
                                                setRawRefiTenure('')
                                                update({ preferred_tenure_refi: isNaN(v) ? undefined : Math.max(refiTenureMin, Math.min(refiTenureMax, v)) })
                                            }}
                                            className="w-20 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12"
                                        />
                                        <span className="text-xs text-slate-500">years — adjust to explore TDSR required</span>
                                    </div>
                                </div>

                                {refiPass !== null && (
                                    <div className={`rounded-lg border px-3 py-2.5 flex items-center gap-2 ${refiPass ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                                        {refiPass
                                            ? <><CheckCircle2 size={14} className="text-emerald-600" /><span className="text-sm font-bold text-emerald-700">TDSR{msrCap != null ? ' / MSR' : ''} Pass</span></>
                                            : <><AlertTriangle size={14} className="text-red-500" />
                                                <span className="text-sm font-bold text-red-600">
                                                    {!refiPassTdsr ? 'TDSR Fail' : 'MSR Fail'}
                                                </span>
                                                <span className="ml-auto text-[11px] font-semibold text-red-600">
                                                    shortfall: {money(refiStress - effectiveAvailForHomeLoan)}
                                                </span></>
                                        }
                                    </div>
                                )}
                                {refiPass === false && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
                                        <p className="text-[12px] font-semibold text-amber-800">Potential Remedies</p>
                                        <p className="text-[12px] text-amber-700 leading-relaxed">
                                            {!refiPassMsr
                                                ? 'MSR cap of 30% binding — income needs to increase or loan needs to be paid down to qualify.'
                                                : data.property_use === 'investment'
                                                    ? 'Bank will require client to pay down 3% of outstanding loan and/or show some funds to prove repayment ability.'
                                                    : 'Client may qualify for TDSR Waiver with most banks — to double check with banker.'}
                                        </p>
                                        {refiPledge && (
                                            <p className="text-[12px] text-amber-900">
                                                <span className="font-semibold">Pledge {money(refiPledge.pledgeFund)}</span> (locked 4 yrs)
                                                {' '}or <span className="font-semibold">Show {money(refiPledge.showFund)}</span> in funds.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Outstanding Equity Loan TDSR block */}
                        {equityOutstandingLoan > 0 && equityOutstandingStress > 0 && (
                            <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 space-y-3">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Outstanding Equity Loan</p>
                                        <p className="text-2xl font-bold text-[#052d4a]">{money(equityOutstandingLoan)}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">TDSR Required</p>
                                        <p className="text-lg font-bold text-[#052d4a]">{money(equityOutstandingStress)}</p>
                                        <p className="text-[11px] text-slate-400">at {equityOutstandingTenure} yrs, 4% stress</p>
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <p className="text-[11px] text-slate-400">
                                        Tenure range: {equityOutTenureMin} – {equityOutTenureMax} yrs (to age 75)
                                    </p>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="number"
                                            value={rawEquityOutTenure !== '' ? rawEquityOutTenure : (data.preferred_tenure_equity_outstanding != null ? String(data.preferred_tenure_equity_outstanding) : '')}
                                            placeholder={String(equityOutTenureMax)}
                                            onChange={e => setRawEquityOutTenure(e.target.value)}
                                            onBlur={() => {
                                                const v = parseInt(rawEquityOutTenure, 10)
                                                setRawEquityOutTenure('')
                                                update({ preferred_tenure_equity_outstanding: isNaN(v) ? undefined : Math.max(equityOutTenureMin, Math.min(equityOutTenureMax, v)) })
                                            }}
                                            className="w-20 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12"
                                        />
                                        <span className="text-xs text-slate-500">years — adjust to explore TDSR required</span>
                                    </div>
                                </div>
                                {equityOutstandingPass !== null && (
                                    <div className={`rounded-lg border px-3 py-2.5 flex items-center gap-2 ${equityOutstandingPass ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                                        {equityOutstandingPass
                                            ? <><CheckCircle2 size={14} className="text-emerald-600" /><span className="text-sm font-bold text-emerald-700">TDSR Pass</span></>
                                            : <><AlertTriangle size={14} className="text-red-500" /><span className="text-sm font-bold text-red-600">TDSR Fail</span>
                                                <span className="ml-auto text-[11px] font-semibold text-red-600">shortfall: {money(equityOutstandingStress - balanceAfterHomeLoan)}</span></>
                                        }
                                    </div>
                                )}
                                {equityOutstandingPass === false && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
                                        <p className="text-[12px] font-semibold text-amber-800">Potential Remedies</p>
                                        <p className="text-[12px] text-amber-700 leading-relaxed">Pledge or show funds required to pass TDSR for the outstanding equity loan.</p>
                                        {equityOutPledge && (
                                            <p className="text-[12px] text-amber-900">
                                                <span className="font-semibold">Pledge {money(equityOutPledge.pledgeFund)}</span> (locked 4 yrs)
                                                {' '}or <span className="font-semibold">Show {money(equityOutPledge.showFund)}</span> in funds.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* New equity loan TDSR block */}
                        {showEquityBlock && (
                            <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 space-y-3">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">New Equity Loan</p>
                                        <p className="text-2xl font-bold text-[#052d4a]">{money(newEquityLoan)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">TDSR Required</p>
                                        <p className="text-lg font-bold text-[#052d4a]">{money(equityNewStress)}</p>
                                        <p className="text-[11px] text-slate-400">at {preferredEquityTenure} yrs, 4% stress</p>
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <p className="text-[11px] text-slate-400">Tenure range: {equityTenureMin} – {equityTenureMax} yrs (to age 75)</p>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="number"
                                            value={rawEquityNewTenure !== '' ? rawEquityNewTenure : (data.preferred_tenure_equity != null ? String(data.preferred_tenure_equity) : '')}
                                            placeholder={String(equityTenureMax)}
                                            onChange={e => setRawEquityNewTenure(e.target.value)}
                                            onBlur={() => {
                                                const v = parseInt(rawEquityNewTenure, 10)
                                                setRawEquityNewTenure('')
                                                update({ preferred_tenure_equity: isNaN(v) ? undefined : Math.max(equityTenureMin, Math.min(equityTenureMax, v)) })
                                            }}
                                            className="w-20 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12"
                                        />
                                        <span className="text-xs text-slate-500">years — adjust to explore TDSR required</span>
                                    </div>
                                </div>
                                {equityPass !== null && (
                                    <div className={`rounded-lg border px-3 py-2.5 flex items-center gap-2 ${equityPass ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                                        {equityPass
                                            ? <><CheckCircle2 size={14} className="text-emerald-600" /><span className="text-sm font-bold text-emerald-700">TDSR Pass</span></>
                                            : <><AlertTriangle size={14} className="text-red-500" /><span className="text-sm font-bold text-red-600">TDSR Fail</span>
                                                <span className="ml-auto text-[11px] font-semibold text-red-600">shortfall: {money(equityNewStress - balanceAfterRefi)}</span></>
                                        }
                                    </div>
                                )}
                                {equityPass === false && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
                                        <p className="text-[12px] font-semibold text-amber-800">Potential Remedies</p>
                                        <p className="text-[12px] text-amber-700 leading-relaxed">Pledge or show funds required to pass TDSR for the new equity loan.</p>
                                        {equityNewPledge && (
                                            <p className="text-[12px] text-amber-900">
                                                <span className="font-semibold">Pledge {money(equityNewPledge.pledgeFund)}</span> (locked 4 yrs)
                                                {' '}or <span className="font-semibold">Show {money(equityNewPledge.showFund)}</span> in funds.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {refiStress === 0 && (
                            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                                <Info size={12} /> Enter outstanding loan amount and tenure to see TDSR required.
                            </p>
                        )}

                        {/* Summary pledge/show — shown when any loan fails TDSR */}
                        {(() => {
                            const entries = [
                                { label: 'Refinancing — Home Loan',    pledge: refiPledge },
                                { label: 'Outstanding Equity Loan',    pledge: equityOutPledge },
                                { label: 'New Equity Loan',            pledge: equityNewPledge },
                            ].filter((e): e is { label: string; pledge: { pledgeFund: number; showFund: number } } => e.pledge != null)
                            if (!entries.length) return null
                            const totalPledge = entries.reduce((s, e) => s + e.pledge.pledgeFund, 0)
                            const totalShow   = entries.reduce((s, e) => s + e.pledge.showFund, 0)
                            return (
                                <div className="card p-5 space-y-3">
                                    <p className="text-sm font-bold text-[#052d4a] uppercase tracking-wide">Summary to Pass TDSR</p>
                                    <div className="space-y-1.5">
                                        {entries.map(({ label, pledge }) => (
                                            <div key={label} className="flex items-center justify-between text-[12px] text-slate-600">
                                                <span className="font-medium text-slate-500">{label}</span>
                                                <span>
                                                    Pledge <span className="font-semibold text-[#052d4a]">{money(pledge.pledgeFund)}</span>
                                                    {' '}or Show <span className="font-semibold text-[#052d4a]">{money(pledge.showFund)}</span>
                                                </span>
                                            </div>
                                        ))}
                                        {entries.length > 1 && (
                                            <div className="border-t border-slate-200 pt-2 flex items-center justify-between">
                                                <span className="text-[12px] font-semibold text-slate-600">Combined</span>
                                                <span className="text-[13px] font-bold text-[#052d4a]">
                                                    Pledge {money(totalPledge)} (locked 4 yrs) or Show {money(totalShow)} in funds
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )
                        })()}
                    </Section>
                )
            })()}

            {/* ── Packages ── */}
            {computation.totalOutstanding > 0 && data.property_type && !ageCheck.error && (
                <RefiPackages
                    loan={computation.totalOutstanding}
                    tenureYears={t?.max ?? meta?.tenureCap ?? 30}
                    propertyType={ratesPropertyType(data.property_type)}
                    includeBuc={!!meta?.buc}
                    currentRatePct={data.current_rate}
                    clawbackAmount={computation.subsidyClawback}
                    priorityBanks={data.priority_client ? data.priority_banks : undefined}
                    currentBank={data.current_bank}
                    selectedId={selectedPkgId}
                    caseId={caseId}
                    clientEmail={clientEmail}
                    clientName={clientName}
                    onSelect={onSelectPackage}
                />
            )}

            {/* ── Potential Savings (current rate vs selected package) ── */}
            {computation.totalOutstanding > 0 && data.property_type && !ageCheck.error && (
                <PotentialSavings
                    currentRatePct={data.current_rate}
                    newRatePct={(data.selected_package_snapshot?.year1_rate ?? data.selected_package_snapshot?.avg_rate_lockin_pct) as number | null | undefined}
                    newBank={data.selected_package_snapshot?.bank as string | undefined}
                    homeLoan={data.outstanding_disbursed ?? 0}
                    equityLoan={meta?.canEquityLoan ? (data.outstanding_equity_loan ?? 0) : 0}
                />
            )}

            {/* ── RESULTS ── */}
            {ageCheck.error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2.5">
                    <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
                    <p className="text-[13px] text-red-800 leading-relaxed">
                        <span className="font-semibold">Calculation stopped.</span> {ageCheck.error}
                    </p>
                </div>
            ) : t?.error ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2.5">
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-[13px] text-amber-800 leading-relaxed">{t.error}</p>
                </div>
            ) : computation.ready && t ? (
                <>


                    {/* Monthly Instalment */}
                    {computation.totalOutstanding > 0 && (() => {
                        const homeLoanAmt = data.outstanding_disbursed ?? 0
                        const equityLoanAmt = (data.outstanding_equity_loan ?? 0) + (data.equity_loan_amount ?? 0)
                        const isMix = homeLoanAmt > 0 && equityLoanAmt > 0

                        // Home loan tenure range (property + age based)
                        const homeClamp = (v: number) => Math.min(Math.max(v, t.min), t.max)
                        const homeT1 = homeClamp(data.preferred_tenure_1 ?? t.max)
                        const homeT2 = homeClamp(preferredTenure2 ?? t.max)

                        // Equity loan tenure range (age based, capped at 35-year absolute max)
                        const equityMaxT = computation.ageForTenure != null
                            ? Math.max(5, Math.min(35, Math.floor(75 - computation.ageForTenure)))
                            : 35
                        const equityMinT = 5
                        const equityClamp = (v: number) => Math.min(Math.max(v, equityMinT), equityMaxT)
                        const equityT1 = equityClamp(data.preferred_equity_amort_tenure_1 ?? equityMaxT)
                        const equityT2 = equityClamp(preferredEquityAmortT2 ?? equityMaxT)

                        // Single-loan path uses home loan variables (equity-only not a typical scenario here)
                        const singleLoan = computation.totalOutstanding
                        const t1 = homeT1
                        const t2 = homeT2
                        const clamp = homeClamp
                        const defaultT = t.max

                        // Amortization rows
                        const homeAmort1 = homeLoanAmt > 0 ? computeAmortization(homeLoanAmt, homeT1, activeSchedule, soraForAmort) : []
                        const homeAmort2 = homeLoanAmt > 0 ? computeAmortization(homeLoanAmt, homeT2, activeSchedule, soraForAmort) : []
                        const equityAmort1 = equityLoanAmt > 0 ? computeAmortization(equityLoanAmt, equityT1, activeSchedule, soraForAmort) : []
                        const equityAmort2 = equityLoanAmt > 0 ? computeAmortization(equityLoanAmt, equityT2, activeSchedule, soraForAmort) : []
                        const singleAmort1 = computeAmortization(singleLoan, t1, activeSchedule, soraForAmort)
                        const singleAmort2 = computeAmortization(singleLoan, t2, activeSchedule, soraForAmort)

                        const effectiveLockin = (lockinYears != null && lockinYears > 0) ? lockinYears : null
                        const schedExplicitYears = activeSchedule.filter(e => !e.thereafter && e.year != null).length
                        const breakdownYears = effectiveLockin ?? (schedExplicitYears > 0 ? schedExplicitYears : 3)
                        const inputCls = 'w-20 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12'
                        const fmt2 = (n: number | null) => n != null ? `$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
                        const money2 = (n: number) => { const r = Math.round(n); return r < 0 ? `-$${(-r).toLocaleString()}` : `$${r.toLocaleString()}` }

                        // Single-path values (non-mix)
                        const m1 = singleAmort1[0]?.instalment ?? null
                        const m2 = singleAmort2[0]?.instalment ?? null
                        const i1 = effectiveLockin != null ? (singleAmort1.find(r => r.year === effectiveLockin)?.cumulativeInterest ?? null) : null
                        const i2 = effectiveLockin != null ? (singleAmort2.find(r => r.year === effectiveLockin)?.cumulativeInterest ?? null) : null
                        const lockInCards = effectiveLockin != null
                            ? Array.from({ length: effectiveLockin }, (_, i) => ({
                                year: i + 1,
                                value: singleAmort1.find(r => r.year === i + 1)?.cumulativeInterest ?? null,
                                instalment: singleAmort1.find(r => r.year === i + 1)?.instalment ?? null,
                            }))
                            : []

                        // Mixed-path per-loan values
                        const homeM1 = homeAmort1[0]?.instalment ?? null
                        const homeM2 = homeAmort2[0]?.instalment ?? null
                        const homeI1 = effectiveLockin != null ? (homeAmort1.find(r => r.year === effectiveLockin)?.cumulativeInterest ?? null) : null
                        const homeI2 = effectiveLockin != null ? (homeAmort2.find(r => r.year === effectiveLockin)?.cumulativeInterest ?? null) : null
                        const homeLockInCards = effectiveLockin != null
                            ? Array.from({ length: effectiveLockin }, (_, i) => ({
                                year: i + 1,
                                value: homeAmort1.find(r => r.year === i + 1)?.cumulativeInterest ?? null,
                                instalment: homeAmort1.find(r => r.year === i + 1)?.instalment ?? null,
                            }))
                            : []
                        const equityM1 = equityAmort1[0]?.instalment ?? null
                        const equityM2 = equityAmort2[0]?.instalment ?? null
                        const equityI1 = effectiveLockin != null ? (equityAmort1.find(r => r.year === effectiveLockin)?.cumulativeInterest ?? null) : null
                        const equityI2 = effectiveLockin != null ? (equityAmort2.find(r => r.year === effectiveLockin)?.cumulativeInterest ?? null) : null
                        const equityLockInCards = effectiveLockin != null
                            ? Array.from({ length: effectiveLockin }, (_, i) => ({
                                year: i + 1,
                                value: equityAmort1.find(r => r.year === i + 1)?.cumulativeInterest ?? null,
                                instalment: equityAmort1.find(r => r.year === i + 1)?.instalment ?? null,
                            }))
                            : []

                        const renderLockInCards = (cards: { year: number; value: number | null; instalment: number | null }[]) => (
                            <div className="flex gap-2 flex-wrap">
                                {cards.map(({ year, value, instalment }, i) => {
                                    const isLast = i === cards.length - 1
                                    return isLast ? (
                                        <div key={year} className="flex-1 min-w-[120px] rounded-xl border-2 border-[#052d4a] bg-[#052d4a] text-white px-4 py-3">
                                            <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">Total Int · Yr {year}</p>
                                            <p className="text-xl font-black mt-0.5">{value != null ? money2(value) : '—'}</p>
                                            {instalment != null && <p className="text-[11px] opacity-60 mt-0.5">{money2(instalment)}</p>}
                                        </div>
                                    ) : (
                                        <div key={year} className="flex-1 min-w-[100px] rounded-xl border border-slate-200 bg-white px-4 py-3">
                                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Int · Yr {year}</p>
                                            <p className="text-lg font-black text-[#052d4a] mt-0.5">{value != null ? money2(value) : '—'}</p>
                                            {instalment != null && <p className="text-[11px] text-slate-400 mt-0.5">{money2(instalment)}</p>}
                                        </div>
                                    )
                                })}
                            </div>
                        )

                        const renderComparisonTable = (
                            lv1: number | null, lv2: number | null,
                            iv1: number | null, iv2: number | null,
                            ta: number, tb: number,
                            rows1: ReturnType<typeof computeAmortization>,
                            rows2: ReturnType<typeof computeAmortization>,
                        ) => {
                            const lockin = breakdownYears
                            const ti1 = lv1 != null ? lv1 * lockin * 12 : null
                            const ti2 = lv2 != null ? lv2 * lockin * 12 : null
                            const ol1 = rows1.find(r => r.year === lockin)?.balance ?? null
                            const ol2 = rows2.find(r => r.year === lockin)?.balance ?? null
                            const dc = (d: number) => d > 0 ? 'text-red-500' : d < 0 ? 'text-emerald-600' : 'text-slate-400'
                            const ds = (d: number) => d >= 0 ? '+' : '−'
                            const f = fmt2
                            const diffCols: { v1: number | null; v2: number | null; sfx: string }[] = [
                                { v1: lv1, v2: lv2, sfx: ' /mth' },
                                { v1: ti1, v2: ti2, sfx: '' },
                                { v1: ol1, v2: ol2, sfx: '' },
                                { v1: iv1, v2: iv2, sfx: '' },
                            ]
                            return (
                                <div className="rounded-xl border border-slate-200 overflow-hidden">
                                    <div className="table-scroll">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-200">
                                                <th className="px-3 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Tenure (Yrs)</th>
                                                <th className="px-3 py-2.5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">Monthly Instalment</th>
                                                <th className="px-3 py-2.5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                                    Total Instalment<br />
                                                    <span className="font-normal normal-case tracking-normal text-slate-400">Paid over {lockin} yr{lockin > 1 ? 's' : ''}</span>
                                                </th>
                                                <th className="px-3 py-2.5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                                    Outstanding Loan<br />
                                                    <span className="font-normal normal-case tracking-normal text-slate-400">After {lockin} yr{lockin > 1 ? 's' : ''}</span>
                                                </th>
                                                <th className="px-3 py-2.5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                                    Total Interest<br />
                                                    <span className="font-normal normal-case tracking-normal text-slate-400">Paid over {lockin} yr{lockin > 1 ? 's' : ''}</span>
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr className="border-b border-slate-100 bg-sky-50/30">
                                                <td className="px-3 py-3">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="w-1.5 h-4 rounded-full bg-[#03a9e7] shrink-0" />
                                                        <span className="font-bold text-[#052d4a]">{ta}</span>
                                                        <span className="text-xs text-slate-400 ml-0.5">yrs</span>
                                                        <span className="text-[10px] font-bold text-[#03a9e7] bg-sky-100 px-1.5 py-0.5 rounded-full ml-1">Primary</span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3 text-right font-bold text-[#052d4a]">{lv1 != null ? f(lv1) : '—'}</td>
                                                <td className="px-3 py-3 text-right font-bold text-[#052d4a]">{ti1 != null ? f(ti1) : '—'}</td>
                                                <td className="px-3 py-3 text-right font-bold text-[#052d4a]">{ol1 != null ? f(ol1) : '—'}</td>
                                                <td className="px-3 py-3 text-right font-bold text-[#052d4a]">{iv1 != null ? f(iv1) : '—'}</td>
                                            </tr>
                                            {showCompare && (
                                                <tr className="border-b border-slate-100">
                                                    <td className="px-3 py-3">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="w-1.5 h-4 rounded-full bg-slate-300 shrink-0" />
                                                            <span className="font-bold text-slate-700">{tb}</span>
                                                            <span className="text-xs text-slate-400 ml-0.5">yrs</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3 text-right font-semibold text-slate-700">{lv2 != null ? f(lv2) : '—'}</td>
                                                    <td className="px-3 py-3 text-right font-semibold text-slate-700">{ti2 != null ? f(ti2) : '—'}</td>
                                                    <td className="px-3 py-3 text-right font-semibold text-slate-700">{ol2 != null ? f(ol2) : '—'}</td>
                                                    <td className="px-3 py-3 text-right font-semibold text-slate-700">{iv2 != null ? f(iv2) : '—'}</td>
                                                </tr>
                                            )}
                                            {showCompare && lv1 != null && lv2 != null && (
                                                <tr className="bg-slate-50/60 border-t-2 border-slate-200">
                                                    <td className="px-3 py-2.5"><span className="text-xs font-black text-slate-500 uppercase tracking-wider">Difference</span></td>
                                                    {diffCols.map((col, idx) => (
                                                        <td key={idx} className="px-3 py-2.5 text-right">
                                                            {col.v1 != null && col.v2 != null ? (() => {
                                                                const diff = col.v2 - col.v1
                                                                return (
                                                                    <span className={`font-bold ${dc(diff)}`}>
                                                                        {ds(diff)}{f(Math.abs(diff)).slice(1)}{col.sfx && <span className="text-[11px] font-medium">{col.sfx}</span>}
                                                                    </span>
                                                                )
                                                            })() : <span className="text-slate-300 text-xs">—</span>}
                                                        </td>
                                                    ))}
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                    </div>
                                </div>
                            )
                        }

                        const renderAmortTables = (rows1: ReturnType<typeof computeAmortization>, rows2: ReturnType<typeof computeAmortization>, ta: number, tb: number) => (
                            <>
                                {[
                                    { rows: rows1, tv: ta, label: 'Tenure 1' },
                                    ...(showCompare ? [{ rows: rows2, tv: tb, label: 'Tenure 2' }] : []),
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
                            </>
                        )

                        return (
                            <Section title="Amortization" icon={<Wallet size={15} />}>

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

                                {/* ── MIXED: home loan + equity loan split ── */}
                                {isMix ? (
                                    <>
                                        {/* ── Home Loan card ── */}
                                        <div className="rounded-xl border border-sky-200 overflow-hidden">
                                            <div className="bg-sky-50 border-b border-sky-100 px-4 py-3">
                                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">Home Loan Tenure Planner</p>
                                                <p className="text-lg font-black text-[#052d4a]">Home Loan — {money2(homeLoanAmt)}</p>
                                            </div>
                                            <div className="p-4 space-y-3">
                                                {homeLockInCards.length > 0 && (
                                                    <div className="space-y-2">
                                                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Interest Paid during Lock-in</p>
                                                        {renderLockInCards(homeLockInCards)}
                                                    </div>
                                                )}
                                                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                                                    Tenure Range: {t.min} – {t.max} yrs
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="space-y-1">
                                                        <label className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">Preferred Tenure 1</label>
                                                        <div className="flex items-center gap-2">
                                                            <input type="number" min={t.min} max={t.max}
                                                                value={rawPrefTenure1 !== '' ? rawPrefTenure1 : (data.preferred_tenure_1 != null ? String(data.preferred_tenure_1) : '')}
                                                                placeholder={String(t.max)}
                                                                onChange={e => setRawPrefTenure1(e.target.value)}
                                                                onBlur={() => {
                                                                    const parsed = parseInt(rawPrefTenure1, 10)
                                                                    setRawPrefTenure1('')
                                                                    update({ preferred_tenure_1: isNaN(parsed) ? undefined : homeClamp(parsed) })
                                                                }}
                                                                className={inputCls} />
                                                            <span className="text-xs text-slate-500">yrs</span>
                                                        </div>
                                                        {data.preferred_tenure_1 == null && <p className="text-[11px] text-slate-400">Defaults to max tenure</p>}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 uppercase tracking-wide font-semibold cursor-pointer select-none">
                                                            <input type="checkbox" checked={showCompare} onChange={e => setShowCompare(e.target.checked)}
                                                                className="rounded border-slate-300 accent-[#03a9e7]" />
                                                            {showCompare ? 'Preferred Tenure 2' : 'Compare Tenure'}
                                                        </label>
                                                        {showCompare && (
                                                            <div className="flex items-center gap-2">
                                                                <input type="number" min={t.min} max={t.max}
                                                                    value={rawPrefTenure2 !== '' ? rawPrefTenure2 : (preferredTenure2 != null ? String(preferredTenure2) : '')}
                                                                    placeholder={String(t.max)}
                                                                    onChange={e => setRawPrefTenure2(e.target.value)}
                                                                    onBlur={() => {
                                                                        const parsed = parseInt(rawPrefTenure2, 10)
                                                                        setRawPrefTenure2('')
                                                                        setPreferredTenure2(isNaN(parsed) ? undefined : homeClamp(parsed))
                                                                    }}
                                                                    className={inputCls} />
                                                                <span className="text-xs text-slate-500">yrs</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                {renderComparisonTable(homeM1, homeM2, homeI1, homeI2, homeT1, homeT2, homeAmort1, homeAmort2)}
                                                {renderAmortTables(homeAmort1, homeAmort2, homeT1, homeT2)}
                                            </div>
                                        </div>

                                        {/* ── Equity Loan card ── */}
                                        <div className="rounded-xl border border-violet-200 overflow-hidden">
                                            <div className="bg-violet-50 border-b border-violet-100 px-4 py-3">
                                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">Equity Loan Tenure Planner</p>
                                                <p className="text-lg font-black text-[#052d4a]">Equity Loan — {money2(equityLoanAmt)}</p>
                                            </div>
                                            <div className="p-4 space-y-3">
                                                {equityLockInCards.length > 0 && (
                                                    <div className="space-y-2">
                                                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Interest Paid during Lock-in</p>
                                                        {renderLockInCards(equityLockInCards)}
                                                    </div>
                                                )}
                                                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                                                    Tenure Range: {equityMinT} – {equityMaxT} yrs
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="space-y-1">
                                                        <label className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">Preferred Tenure 1</label>
                                                        <div className="flex items-center gap-2">
                                                            <input type="number" min={equityMinT} max={equityMaxT}
                                                                value={rawEquityAmortT1 !== '' ? rawEquityAmortT1 : (data.preferred_equity_amort_tenure_1 != null ? String(data.preferred_equity_amort_tenure_1) : '')}
                                                                placeholder={String(equityMaxT)}
                                                                onChange={e => setRawEquityAmortT1(e.target.value)}
                                                                onBlur={() => {
                                                                    const parsed = parseInt(rawEquityAmortT1, 10)
                                                                    setRawEquityAmortT1('')
                                                                    update({ preferred_equity_amort_tenure_1: isNaN(parsed) ? undefined : equityClamp(parsed) })
                                                                }}
                                                                className={inputCls} />
                                                            <span className="text-xs text-slate-500">yrs</span>
                                                        </div>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 uppercase tracking-wide font-semibold cursor-pointer select-none">
                                                            <input type="checkbox" checked={showCompare} onChange={e => setShowCompare(e.target.checked)}
                                                                className="rounded border-slate-300 accent-[#03a9e7]" />
                                                            {showCompare ? 'Preferred Tenure 2' : 'Compare Tenure'}
                                                        </label>
                                                        {showCompare && (
                                                            <div className="flex items-center gap-2">
                                                                <input type="number" min={equityMinT} max={equityMaxT}
                                                                    value={rawEquityAmortT2 !== '' ? rawEquityAmortT2 : (preferredEquityAmortT2 != null ? String(preferredEquityAmortT2) : '')}
                                                                    placeholder={String(equityMaxT)}
                                                                    onChange={e => setRawEquityAmortT2(e.target.value)}
                                                                    onBlur={() => {
                                                                        const parsed = parseInt(rawEquityAmortT2, 10)
                                                                        setRawEquityAmortT2('')
                                                                        setPreferredEquityAmortT2(isNaN(parsed) ? undefined : equityClamp(parsed))
                                                                    }}
                                                                    className={inputCls} />
                                                                <span className="text-xs text-slate-500">yrs</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                {renderComparisonTable(equityM1, equityM2, equityI1, equityI2, equityT1, equityT2, equityAmort1, equityAmort2)}
                                                {renderAmortTables(equityAmort1, equityAmort2, equityT1, equityT2)}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    /* ── SINGLE LOAN (home-only or equity-only) ── */
                                    <>
                                        {/* Per-year interest cards */}
                                        {lockInCards.length > 0 && renderLockInCards(lockInCards)}

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
                                                {data.preferred_tenure_1 == null && <p className="text-[11px] text-slate-400">Defaults to max tenure</p>}
                                            </div>
                                            <div className="space-y-1">
                                                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 uppercase tracking-wide font-semibold cursor-pointer select-none">
                                                    <input type="checkbox" checked={showCompare} onChange={e => setShowCompare(e.target.checked)}
                                                        className="rounded border-slate-300 accent-[#03a9e7]" />
                                                    {showCompare ? 'Preferred Tenure 2' : 'Compare Tenure'}
                                                </label>
                                                {showCompare && (
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
                                                )}
                                            </div>
                                        </div>

                                        {/* Comparison table */}
                                        {renderComparisonTable(m1, m2, i1, i2, t1, t2, singleAmort1, singleAmort2)}

                                        {/* Year-by-year breakdown — both tenures */}
                                        {renderAmortTables(singleAmort1, singleAmort2, t1, t2)}
                                    </>
                                )}

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
                        <Section title="Cost of Simple Refinancing" icon={<Receipt size={15} />}>
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
                        documents={documents}
                        documentsDone={documentsDone}
                        onToggleDocument={toggleDocument}
                        caseId={caseId}
                        clientName={clientName}
                        followUpDate={followUpDate}
                        onSetFollowUp={onSetFollowUp}
                        onPresent={() => setPresentationOpen(true)}
                        onOpenProposal={() => setProposalOpen(true)}
                        clientEmail={clientEmail}
                        onSendReport={handleSendReport}
                        sendingReport={sendingReport}
                        reportSent={reportSent}
                        reportError={reportError}
                    />
                </>
            ) : (
                <div className="card p-8 text-center text-sm text-slate-400">
                    Enter the property type, outstanding loan, borrower age(s) and year of purchase to see the tenure range and packages.
                </div>
            )}

            {/* Agent notes — internal, per-case */}
            <AgentNotesCard value={data.agent_notes} onChange={v => update({ agent_notes: v })} />

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
                    sora={soraForAmort}
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

// Input-driven warnings only (e.g. tenure errors). The static/dynamic advisory
// bullets that used to live here are being woven into the workflow steps instead.
function RemarksCard({ remarks }: { remarks: RefiRemarks }) {
    if (!remarks.alerts.length) return null
    return (
        <div className="space-y-3">
            {remarks.alerts.map((a, i) => (
                <div key={i} className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-[13px] text-amber-800 leading-relaxed">{a}</p>
                </div>
            ))}
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
    documents: CaseDocument[]
    documentsDone: string[]
    onToggleDocument: (id: string) => void
    caseId?: string
    clientName?: string
    followUpDate?: string
    onSetFollowUp?: (date: string) => void
    onPresent: () => void
    onOpenProposal: () => void
    clientEmail?: string
    onSendReport: () => void
    sendingReport: boolean
    reportSent: boolean
    reportError: string | null
}

function NextStepCard({
    embedded, currentStage, suggestedStage, onStageAdvance,
    actions, actionsDone, onToggleAction, documents, documentsDone, onToggleDocument,
    caseId, clientName,
    followUpDate, onSetFollowUp, onPresent, onOpenProposal,
    clientEmail, onSendReport, sendingReport, reportSent, reportError,
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
                <button
                    type="button"
                    onClick={onSendReport}
                    disabled={!clientEmail || sendingReport}
                    title={!clientEmail ? 'Add client email in case details first' : `Send PDF report to ${clientEmail}`}
                    className={`text-sm px-4 py-2 rounded-lg border font-semibold flex items-center gap-2 transition-colors ${
                        reportSent
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : !clientEmail
                                ? 'border-slate-200 text-slate-300 cursor-not-allowed bg-white'
                                : 'border-slate-200 text-slate-600 hover:bg-slate-50 bg-white'
                    }`}
                >
                    <Mail size={15} />
                    {sendingReport ? 'Sending…' : reportSent ? 'Sent!' : 'Email to client'}
                </button>
                {documents.length > 0 && (
                    <ShareDocChecklist caseId={caseId} clientName={clientName} clientEmail={clientEmail} />
                )}
                {embedded && suggestedStage && onStageAdvance && (
                    <button type="button" onClick={() => onStageAdvance(suggestedStage)}
                        className="text-sm px-4 py-2 rounded-lg border border-[#03a9e7] text-[#03a9e7] font-semibold hover:bg-sky-50 flex items-center gap-2">
                        Advance to {suggestedStage} <ArrowRight size={14} />
                    </button>
                )}
            </div>
            {reportError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{reportError}</p>
            )}
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

            <DocumentsToPrepare documents={documents} done={documentsDone} onToggle={onToggleDocument} />

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
                <div className="table-scroll">
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
                    <button key={t} type="button" onClick={() => onChange(
                            t === 'floating'
                                ? { type: 'floating', reference: '3M SORA', spread: entry.spread ?? 1.00 }
                                : { type: 'fixed' }
                        )}
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
                    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs shrink-0">
                        {REFI_AMORT_RATE_REFS.map(r => (
                            <button key={r} type="button"
                                onClick={() => onChange(r !== 'Custom' ? { reference: r, rate: undefined } : { reference: r })}
                                className={`px-2.5 py-1 font-semibold transition-colors ${(entry.reference ?? '3M SORA') === r ? 'bg-[#052d4a] text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                                {r}
                            </button>
                        ))}
                    </div>
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

