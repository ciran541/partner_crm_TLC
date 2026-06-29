'use client'

import { ReactNode, useEffect, useMemo, useState } from 'react'
import type { PurchaseWorkflow, PurchaseBorrower } from '@/lib/types/workflow'
import {
    computePurchase,
    inputsFromWorkflow,
    PURCHASE_PROPERTY_TYPES,
    RESIDENCY_OPTIONS,
    propertyMeta,
    locksOutstandingToZero,
    restrictsForeigner,
    ratesPropertyType,
    DEFAULT_REFERENCE_RATE,
    type PurchasePropertyType,
    type OptionResult,
    type OutstandingLoans,
    type ServicingRule,
    type PledgeData,
    OPTION_MATRIX,
    computePledge,
} from '@/lib/insurance/purchaseCalc'
import { buildRemarks, nextActions, type PurchaseRemarks } from '@/lib/insurance/purchaseRemarks'
import { buildProposalText, type ProposalPackage } from '@/lib/insurance/purchaseProposal'
import { monthlyInstallment, maxLoanFromPayment, STRESS_TEST_RATE } from '@/lib/insurance/loanCalc'
import { computeAmortization } from '@/lib/insurance/amortCalc'
import { type RateScheduleEntry } from '@/lib/types/rates'
import { Question, FieldInput } from '@/components/insurance/workflow/WorkflowStep'
import Modal from '@/components/shared/Modal'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import type { PurchaseRecommendation } from '@/lib/insurance/purchaseRecommend'
import type { SoraRates } from '@/lib/insurance/sora'
import PurchasePackages from './PurchasePackages'
import PurchasePresentation from './PurchasePresentation'
import MultiBankSelect from './MultiBankSelect'
import {
    Home, CheckCircle2, AlertTriangle, Info, Save, FileText, Wallet, XCircle,
    ArrowRight, ClipboardList, Copy, Printer, Circle, Lock, Plus, Trash2,
    Presentation, MessageSquare, Users, Mail,
} from 'lucide-react'

const DEFAULT_RATE_SCHEDULE: RateScheduleEntry[] = [{ year: 1, type: 'fixed' }]
const AMORT_RATE_REFS = ['3M SORA', '1M SORA', 'Custom'] as const

interface Props {
    data: PurchaseWorkflow
    onChange: (updated: PurchaseWorkflow) => void
    clientName?: string
    clientEmail?: string
    caseId?: string
    embedded?: boolean
    saving?: boolean
    saved?: boolean
    // Whether the case already has a client name (drives the hand-off label)
    hasClientName?: boolean
    // Hands off to the internal tab to capture client details / set stage / close
    onContinue?: () => void
}

const money = (n: number) => `$${Math.floor(n).toLocaleString()}`
const pct = (frac: number) => {
    const v = frac * 100
    return Number.isInteger(v) ? `${v}%` : `${v.toFixed(2)}%`
}
const num = (v: string) => (v.trim() === '' ? undefined : parseFloat(v.replace(/,/g, '')))

export default function PurchaseWorkflowPanel({
    data, onChange, clientName, clientEmail, caseId, embedded, saving, saved, hasClientName, onContinue,
}: Props) {
    const update = (patch: Partial<PurchaseWorkflow>) => onChange({ ...data, ...patch })
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
    const [rawPrefTenure, setRawPrefTenure] = useState('')
    const [liquidityOption, setLiquidityOption] = useState<'1' | '2'>('1')
    const [preferredTenure2, setPreferredTenure2] = useState<number | undefined>()
    const [rawPrefTenure2, setRawPrefTenure2] = useState('')
    const [showCompare, setShowCompare] = useState(false)
    const [adjustedLoans, setAdjustedLoans] = useState<Record<string, number | undefined>>({})
    const [soraForAmort, setSoraForAmort] = useState<SoraRates | null>(null)

    useEffect(() => {
        fetch('/api/insurance/rates')
            .then(r => r.json())
            .then(d => { if (d.sora) setSoraForAmort(d.sora) })
            .catch(() => {})
    }, [])

    const meta = propertyMeta(data.property_type)
    const isBuc = data.property_type === 'new_launch_condo' || data.property_type === 'ec_new_launch'
    const isDps = data.property_type === 'ec_new_launch' && data.ec_payment_scheme === 'dps'
    const effectivePrice = isDps && data.property_price ? Math.round(data.property_price * 1.03) : (data.property_price ?? 0)
    const computation = useMemo(() => {
        const inputs = inputsFromWorkflow(
            isDps && data.property_price
                ? { ...data, property_price: Math.round(data.property_price * 1.03) }
                : data,
        )
        return computePurchase(inputs)
    }, [data, isDps])

    // Auto-switch liquidity view away from a blocked income option
    useEffect(() => {
        if (!computation.ready || computation.options.length < 2) return
        const pref = data.preferred_tenure
        const currentBlocked = computation.options.find(
            o => o.key === liquidityOption && o.source !== 'ipa' && pref != null && pref > o.maxTenure,
        )
        if (currentBlocked) {
            const other = computation.options.find(
                o => o.key !== liquidityOption && !(o.source !== 'ipa' && pref != null && pref > o.maxTenure),
            )
            if (other) setLiquidityOption(other.key as '1' | '2')
        }
    }, [data.preferred_tenure, computation.options, computation.ready, liquidityOption])
    const remarks = useMemo<PurchaseRemarks>(() => buildRemarks({
        propertyType: data.property_type,
        otpObtained: data.otp_obtained,
        sellingExisting: data.selling_existing,
        sellAtTop: data.sell_at_top,
        residency: computation.absdResidency,
        outstanding: data.outstanding_housing_loans,
        bsd: computation.bsd,
        absd: computation.absd,
    }), [data, computation])

    // ── Property type change: enforce restrictions ──
    const setPropertyType = (type: PurchasePropertyType) => {
        const patch: Partial<PurchaseWorkflow> = { property_type: type }
        if (locksOutstandingToZero(type)) patch.outstanding_housing_loans = '0'
        if (restrictsForeigner(type) && data.borrowers?.some(b => b.residency === 'foreigner')) {
            patch.borrowers = data.borrowers.map(b => b.residency === 'foreigner' ? { ...b, residency: 'singaporean' } : b)
        }
        update(patch)
    }

    // ── Borrowers ──
    const defaultBorrower: PurchaseBorrower = { employment: 'employed', residency: 'singaporean' }
    const borrowers = data.borrowers ?? [defaultBorrower]
    const setBorrowerCount = (n: 1 | 2 | 3 | 4) => {
        update({ borrowers: Array.from({ length: n }, (_, i) => borrowers[i] ?? defaultBorrower) })
    }
    const updateBorrower = (i: number, patch: Partial<PurchaseBorrower>) => {
        const next = borrowers.map((b, idx) => idx === i ? { ...b, ...patch } : b)
        update({ borrowers: next })
    }

    const foreignerBlocked = restrictsForeigner(data.property_type)
    const outstandingLocked = locksOutstandingToZero(data.property_type)

    const onSelectPackage = (rec: PurchaseRecommendation, sora: SoraRates | null) => {
        update({
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
                avg_rate_lockin_pct: rec.projection.avgRateLockinPct ?? null,
                sora_as_of: sora?.published_date ?? sora?.value_date ?? null,
                frozen_at: new Date().toISOString(),
            },
        })
    }

    const otpDateFields = otpFieldsFor(data.property_type)
    const selectedPkgId = (data.selected_package_snapshot?.id as string) ?? undefined
    const pkg = data.selected_package_snapshot as Record<string, unknown> | undefined

    // ── Next-step derived values ──
    const proposalText = useMemo(() => buildProposalText({
        clientName,
        propertyLabel: meta?.label ?? 'Property',
        price: data.property_price ?? 0,
        computation,
        selectedPackage: data.selected_package_snapshot as ProposalPackage | undefined,
    }), [clientName, meta, data.property_price, computation, data.selected_package_snapshot])

    const actions = nextActions(data.property_type)
    const actionsDone = data.next_actions_done ?? []
    const toggleAction = (a: string) => {
        const set = new Set(actionsDone)
        if (set.has(a)) set.delete(a); else set.add(a)
        update({ next_actions_done: [...set] })
    }

    const updateScheduleRow = (idx: number, patch: Partial<RateScheduleEntry>) => {
        const s = data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE
        update({ manual_rate_schedule: s.map((e, i) => i === idx ? { ...e, ...patch } : e) })
    }
    const addScheduleYear = () => {
        const s = data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE
        const maxYear = Math.max(0, ...s.filter(e => e.year != null).map(e => e.year!))
        const thereafterIdx = s.findIndex(e => e.thereafter)
        const newEntry: RateScheduleEntry = { year: maxYear + 1, type: 'fixed' }
        const next = thereafterIdx >= 0
            ? [...s.slice(0, thereafterIdx), newEntry, ...s.slice(thereafterIdx)]
            : [...s, newEntry]
        update({ manual_rate_schedule: next })
    }
    const addScheduleThereafter = () => {
        const s = data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE
        if (s.some(e => e.thereafter)) return
        update({ manual_rate_schedule: [...s, { thereafter: true, type: 'fixed' }] })
    }
    const removeScheduleRow = (idx: number) => {
        const s = data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE
        if (s.length > 1) update({ manual_rate_schedule: s.filter((_, i) => i !== idx) })
    }

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-lg font-bold text-[#052d4a] flex items-center gap-2">
                        <Home size={18} className="text-[#03a9e7]" /> New Purchase — Loan Eligibility
                    </h2>
                    <p className="text-sm text-slate-500">
                        {clientName ? <>Advising <span className="font-medium text-slate-700">{clientName}</span>. </> : null}
                        Capture only what applies — options, stamp duty and remarks update live.
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

            {/* ── INPUTS ── */}
            <Section title="Property" icon={<Home size={15} />}>
                <Question label="Property Type" required>
                    <PillSelect
                        value={data.property_type}
                        onChange={v => setPropertyType(v as PurchasePropertyType)}
                        options={PURCHASE_PROPERTY_TYPES.map(p => ({
                                value: p.value,
                                label: (p.value === 'new_launch_condo' || p.value === 'ec_new_launch')
                                    ? `${p.label} (No TOP yet)`
                                    : p.label,
                            }))}
                    />
                    {meta && (
                        <p className="text-[11px] text-slate-400 mt-1.5">
                            {meta.rule === 'tdsr' ? 'Assessed on TDSR (55%).'
                                : meta.rule === 'msr' ? 'Assessed on MSR (30%).'
                                    : 'Assessed on both TDSR (55%) and MSR (30%) — the lower binds.'}
                        </p>
                    )}
                </Question>

                <Question label="Purchase Price / Valuation" required>
                    <FieldInput commas prefix="$" value={data.property_price ?? ''} placeholder="e.g. 1,500,000"
                        onChange={v => update({ property_price: num(v) })} />
                </Question>
                {isResale(data.property_type) && (
                    <TipGroup>
                        <Tip>Valuations are determined by HDB directly, you can submit a valuation request to HDB after obtaining the OTP from seller.</Tip>
                        <Tip>The maximum Loan-To-Valuation (LTV) is based on the purchase price or valuation, whichever is lower.</Tip>
                        {data.property_type === 'resale_landed' && (
                            <Tip>Double-check with the seller(s) whether the landed property has obtained its Certificate of Statutory Completion (CSC) or only Temporary Occupation Permit (TOP) — some ID contractors don't obtain CSC after works are done. Without CSC, most banks will not finance; DBS/SCB are open to it for now.</Tip>
                        )}
                    </TipGroup>
                )}
                {(data.property_type === 'new_launch_condo' || data.property_type === 'ec_new_launch') && (
                    <Question label="Expected TOP Year">
                        <FieldInput type="text" value={data.otp_dates?.top_year ?? ''} placeholder="e.g. 2030"
                            onChange={v => update({ otp_dates: { ...data.otp_dates, top_year: v } })} />
                        {(() => {
                            const yr = data.otp_dates?.top_year ? parseInt(data.otp_dates.top_year) : NaN
                            const yrs = !isNaN(yr) ? Math.max(1, yr - new Date().getFullYear()) : null
                            return yrs != null && (
                                <p className="text-[11px] text-[#03a9e7] mt-1 flex items-center gap-1">
                                    <Info size={11} /> {yrs} year{yrs !== 1 ? 's' : ''} to TOP — used as interest period in the amortisation below.
                                </p>
                            )
                        })()}
                    </Question>
                )}
            </Section>

            {/* OTP */}
            {data.property_type && (
                <Section title="OTP from seller / developer" icon={<FileText size={15} />}>
                    <Question label="Have you obtained the OTP from seller/developer?" required>
                        <YesNo value={data.otp_obtained} onChange={v => update({ otp_obtained: v })} />
                    </Question>
                    {data.otp_obtained && (
                        isResale(data.property_type) ? (
                            <>
                                <Question label="Option Expiry Date">
                                    <FieldInput type="date" value={data.otp_dates?.option_expiry ?? ''}
                                        onChange={v => update({ otp_dates: { ...data.otp_dates, option_expiry: v } })} />
                                </Question>
                                <TipGroup>
                                    <Tip>You need to have a valid letter of offer from the bank before exercising the option.</Tip>
                                    <Tip>Law firm has to be under the bank's panel.</Tip>
                                </TipGroup>
                                <Question label="Expected Purchase Completion Date">
                                    <FieldInput type="date" value={data.otp_dates?.completion ?? ''}
                                        onChange={v => update({ otp_dates: { ...data.otp_dates, completion: v } })} />
                                </Question>
                                <TipGroup>
                                    <Tip>Most banks have a 6 months validity period for their letter of offer.</Tip>
                                    <Tip>Law firms will generally require 5–8 weeks to disburse the mortgage loan.</Tip>
                                </TipGroup>
                            </>
                        ) : otpDateFields.length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-1">
                                {otpDateFields.map(f => (
                                    <Question key={f.key} label={f.label}>
                                        <FieldInput type={f.type} value={(data.otp_dates?.[f.key] as string) ?? ''}
                                            onChange={v => update({ otp_dates: { ...data.otp_dates, [f.key]: v } })} />
                                    </Question>
                                ))}
                            </div>
                        )
                    )}
                    {data.otp_obtained === false && (
                        <Question label="Roughly when do you intend to buy?">
                            <FieldInput type="date" value={data.intended_buy_date ?? ''}
                                onChange={v => update({ intended_buy_date: v })} />
                        </Question>
                    )}
                </Section>
            )}

            {/* Buyer Profile — residency, age, count; before IPA for ABSD + IWAA */}
            {data.property_type && (
                <Section title="Buyer Profile" icon={<Users size={15} />}
                    subtitle="Residency drives ABSD rate.">
                    <Question label="Number of owners">
                        <PillSelect
                            value={String(borrowers.length)}
                            onChange={v => setBorrowerCount(Number(v) as 1 | 2 | 3 | 4)}
                            options={[
                                { value: '1', label: 'Solo' },
                                { value: '2', label: 'Joint (2)' },
                                { value: '3', label: 'Joint (3)' },
                                { value: '4', label: 'Joint (4)' },
                            ]}
                        />
                    </Question>
                    {borrowers.map((b, i) => (
                        <div key={i} className="rounded-lg border border-slate-200 p-4">
                            <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-3">
                                {borrowers.length === 1 ? 'Owner' : `Owner ${i + 1}`}
                            </p>
                            <Question label="Residency">
                                <PillSelect
                                    value={b.residency ?? 'singaporean'}
                                    onChange={v => updateBorrower(i, { residency: v as PurchaseBorrower['residency'] })}
                                    options={RESIDENCY_OPTIONS.map(r => ({
                                        value: r.value, label: r.label,
                                        disabled: r.value === 'foreigner' && foreignerBlocked,
                                    }))}
                                />
                            </Question>
                        </div>
                    ))}

                    {/* Marriage question — only relevant for joint (2); 3+ owners can't all be a married couple */}
                    {borrowers.length === 2 && (
                        <Question label="Are the co-owners a married couple?">
                            <YesNo value={data.married} onChange={v => update({ married: v })} />
                            {data.married !== undefined && (() => {
                                const hasSC = borrowers.some(b => (b.residency ?? 'singaporean') === 'singaporean')
                                const hasPR = borrowers.some(b => b.residency === 'pr')
                                const hasForeigner = borrowers.some(b => b.residency === 'foreigner')
                                if (data.married && hasSC && (hasPR || hasForeigner)) {
                                    return (
                                        <p className="text-[11px] text-emerald-700 mt-1.5 flex items-start gap-1.5">
                                            <Info size={12} className="shrink-0 mt-0.5 text-emerald-500" />
                                            Married couple with SC — SC ABSD rates apply (remission available). ABSD is paid upfront and refunded after meeting conditions.
                                        </p>
                                    )
                                }
                                if (!data.married && hasSC && (hasPR || hasForeigner)) {
                                    return (
                                        <p className="text-[11px] text-amber-700 mt-1.5 flex items-start gap-1.5">
                                            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                                            Unmarried co-owners — {hasForeigner ? 'foreigner (60%)' : 'PR (5%/30%/35%)'} ABSD rate applies to the full purchase price.
                                        </p>
                                    )
                                }
                                return null
                            })()}
                        </Question>
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

            {/* IPA */}
            {data.property_type && (
                <Section title="In-Principle Approval (IPA)" icon={<CheckCircle2 size={15} />}>
                    <Question label="Have you done an IPA with any bank before?" required>
                        <YesNo value={data.ipa_done} onChange={v => update({ ipa_done: v })} />
                    </Question>
                    <Tip>An IPA is free, non-obligatory and has a validity period of 1 month.</Tip>
                    {data.ipa_done && (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <Question label="Which bank?">
                                    <InsuranceBankDropdown
                                        value={data.ipa?.bank ?? ''}
                                        onChange={v => update({ ipa: { ...data.ipa, bank: v } })}
                                        showHdb={data.property_type === 'resale_hdb' || data.property_type === 'bto'}
                                    />
                                </Question>
                                <Question label="When was the IPA done?">
                                    <FieldInput type="date" value={data.ipa?.date ?? ''}
                                        onChange={v => update({ ipa: { ...data.ipa, date: v } })} />
                                </Question>
                                <Question label="IPA Amount">
                                    <FieldInput commas prefix="$" value={data.ipa?.amount ?? ''}
                                        onChange={v => update({ ipa: { ...data.ipa, amount: num(v) } })} />
                                </Question>
                                <Question label="Tenure (years)">
                                    <FieldInput type="number" value={data.ipa?.tenure ?? ''}
                                        placeholder={meta?.hdbClass ? '5–30' : '5–35'}
                                        onChange={v => update({ ipa: { ...data.ipa, tenure: num(v) } })}
                                        onBlur={() => {
                                            const n = data.ipa?.tenure
                                            if (n != null) {
                                                const maxTenure = meta?.hdbClass ? 30 : 35
                                                const opt1Max   = meta?.hdbClass ? 25 : 30
                                                const clamped   = Math.min(maxTenure, Math.max(5, n))
                                                const ageCap    = clamped > opt1Max ? 75 : (data.ipa?.age_cap ?? undefined)
                                                update({ ipa: { ...data.ipa, tenure: clamped, ...(ageCap != null ? { age_cap: ageCap as 65 | 75 } : {}) } })
                                            }
                                        }} />
                                </Question>
                            </div>
                            {(() => {
                                const opt1Max = meta?.hdbClass ? 25 : 30
                                const forceOpt2 = (data.ipa?.tenure ?? 0) > opt1Max
                                return (
                                    <Question label="Tenure capped at age">
                                        <PillSelect
                                            value={data.ipa?.age_cap ? String(data.ipa.age_cap) : undefined}
                                            onChange={v => update({ ipa: { ...data.ipa, age_cap: Number(v) as 65 | 75 } })}
                                            options={[
                                                { value: '65', label: '65 (Option 1)', disabled: forceOpt2 },
                                                { value: '75', label: '75 (Option 2)' },
                                            ]}
                                        />
                                        {forceOpt2 && (
                                            <p className="text-[11px] text-amber-600 mt-1">
                                                Tenure {data.ipa?.tenure} yrs — Option 1 (age cap 65) not available. Only Option 2 applies.
                                            </p>
                                        )}
                                    </Question>
                                )
                            })()}
                            {/* Once "Use this instead" has switched options, offer a Reset back to the originally-entered
                                IPA instead of reverse-engineering a second (lossy) time. */}
                            {data.ipa?.original && (data.ipa.original.amount != null || data.ipa.original.tenure != null) ? (
                                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 space-y-1.5">
                                    <p className="text-[11px] font-bold text-[#052d4a]">
                                        Original IPA (Option {data.ipa.original.age_cap === 65 ? '1' : '2'}, age cap {data.ipa.original.age_cap})
                                    </p>
                                    <p className="text-sm text-slate-700">
                                        <span className="font-semibold">{money(data.ipa.original.amount ?? 0)}</span>{' '}
                                        over <span className="font-semibold">{data.ipa.original.tenure} years</span>
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAdjustedLoans({})
                                            const o = data.ipa!.original!
                                            update({ ipa: { ...data.ipa, amount: o.amount, tenure: o.tenure, age_cap: o.age_cap, original: undefined } })
                                        }}
                                        className="mt-0.5 text-[11px] font-semibold text-slate-500 hover:text-slate-700 underline underline-offset-2"
                                    >
                                        ↺ Reset to original IPA
                                    </button>
                                </div>
                            ) : (
                            /* Reverse-engineered alternative option — derived from IPA data alone, no income entry needed */
                            data.property_price && data.ipa?.amount && data.ipa?.tenure && data.ipa?.age_cap && (() => {
                                const outstanding = (outstandingLocked ? '0' : (data.outstanding_housing_loans ?? '0')) as OutstandingLoans
                                const [opt1, opt2] = OPTION_MATRIX[outstanding]
                                const ipaKey = data.ipa.age_cap === 65 ? '1' : '2'
                                const altOpt = ipaKey === '1' ? opt2 : opt1
                                // Reverse-engineer IWAA from the bank's IPA: ageCap − tenure = implied IWAA
                                const impliedIwaa = data.ipa.age_cap - data.ipa.tenure
                                const isHdb = meta?.hdbClass ?? false
                                const altTenure = Math.max(0, Math.min(altOpt.ageCap - impliedIwaa, isHdb ? altOpt.tenureHdb : altOpt.tenureCondoEC))
                                const altLtvLabel = `${Math.round(altOpt.ltvPct * 100)}%`
                                // TDSR reverse-engineering: the IPA loan + tenure at 4% stress test tells us
                                // exactly what monthly capacity the bank accepted. Apply that to Option 2's tenure.
                                const stressPayment = monthlyInstallment(data.ipa.amount, STRESS_TEST_RATE * 100, data.ipa.tenure)
                                const altMaxFromTdsr = maxLoanFromPayment(stressPayment, STRESS_TEST_RATE * 100, altTenure)
                                if (altTenure <= 0 || altMaxFromTdsr <= 0) return null
                                return (
                                    <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-4 space-y-1.5">
                                        <p className="text-[11px] font-bold text-[#052d4a]">
                                            Client may also opt for Option {altOpt.key} ({altLtvLabel} LTV, age cap {altOpt.ageCap})
                                        </p>
                                        <p className="text-sm text-slate-700">
                                            Est. Loan Eligibility:{' '}
                                            <span className="font-semibold">{money(altMaxFromTdsr)}</span>{' '}
                                            over <span className="font-semibold">{altTenure} years</span>
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setAdjustedLoans({})
                                                const original = data.ipa?.original ?? {
                                                    amount: data.ipa!.amount,
                                                    tenure: data.ipa!.tenure,
                                                    age_cap: data.ipa!.age_cap as 65 | 75,
                                                }
                                                update({ ipa: { ...data.ipa, age_cap: altOpt.ageCap as 65 | 75, tenure: altTenure, amount: Math.round(altMaxFromTdsr), original } })
                                            }}
                                            className="mt-0.5 text-[11px] font-semibold text-[#03a9e7] hover:text-[#0290c5] underline underline-offset-2"
                                        >
                                            Use this instead →
                                        </button>
                                    </div>
                                )
                            })()
                            )}
                        </>
                    )}
                </Section>
            )}

            {/* Number of Mortgage Loans */}
            {data.property_type && (
                <Section title="Number of Mortgage Loan(s)" icon={<Wallet size={15} />}>
                    <Question label='Select "1" if the mortgage loan for your next purchase will be the only housing loan' required>
                        <PillSelect
                            value={data.outstanding_housing_loans}
                            onChange={v => update({ outstanding_housing_loans: v as OutstandingLoans })}
                            options={[
                                { value: '0', label: '1' },
                                { value: '1', label: '2', disabled: outstandingLocked },
                                { value: '2plus', label: '3 or more', disabled: outstandingLocked },
                            ]}
                        />
                    </Question>
                    {outstandingLocked && (
                        <p className="text-[11px] text-amber-600 flex items-center gap-1.5">
                            <AlertTriangle size={12} /> HDB / BTO / EC New Launch can only be a first housing loan — select 1.
                        </p>
                    )}
                    <TipGroup>
                        <Tip>This will impact Loan-To-Valuation (LTV).</Tip>
                    </TipGroup>
                </Section>
            )}

            {/* Number of Residential Properties */}
            {data.property_type && (
                <Section title="Number of Residential Properties Owned" icon={<Home size={15} />}>
                    <Question label='Select "1" if the next property purchase will be your Only Residential Property.' required>
                        <PillSelect
                            value={data.residential_properties_owned}
                            onChange={v => update({ residential_properties_owned: v as '1' | '2' | '3plus' })}
                            options={[
                                { value: '1', label: '1' },
                                { value: '2', label: '2' },
                                { value: '3plus', label: '3 or more' },
                            ]}
                        />
                    </Question>
                    <Tip>This will impact Additional Buyer&apos;s Stamp Duty (ABSD).</Tip>
                </Section>
            )}

            {/* Plans (optional — personalizes the remarks) */}
            {data.property_type && (
                <Section title="Plans (optional)" icon={<Info size={15} />}>
                    <Question label="Are you selling an existing property to fund this purchase?">
                        <YesNo value={data.selling_existing} onChange={v => update({ selling_existing: v })} />
                    </Question>
                    {data.selling_existing && (
                        <Question label="Do you require a bridging loan?">
                            <YesNo value={data.bridging_loan} onChange={v => update({ bridging_loan: v })} />
                            <p className="text-[11px] text-slate-400 mt-1.5 flex items-start gap-1.5">
                                <Info size={12} className="mt-0.5 shrink-0" />
                                A bridging loan is recommended if your sales proceeds cannot make it in time to fund the down-payment on your purchase completion date.
                            </p>
                            <TipGroup>
                                <Tip>It will be a floating rate charged on a pro-rated daily basis.</Tip>
                                <Tip>Banks will require sale OTP before you can apply for a bridging loan.</Tip>
                            </TipGroup>
                        </Question>
                    )}
                    {data.property_type === 'new_launch_condo' && (
                        <Question label="Do you intend to sell at TOP?">
                            <YesNo value={data.sell_at_top} onChange={v => update({ sell_at_top: v })} />
                        </Question>
                    )}
                    {data.property_type === 'ec_new_launch' && (
                        <Question label="Will you be on the Progressive (PPS) or Deferred (DPS) Payment Scheme?">
                            <PillSelect
                                value={data.ec_payment_scheme}
                                onChange={v => update({ ec_payment_scheme: v as 'pps' | 'dps' })}
                                options={[
                                    { value: 'pps', label: 'PPS — Progressive' },
                                    { value: 'dps', label: 'DPS — Deferred' },
                                ]}
                            />
                        </Question>
                    )}
                </Section>
            )}

            {/* Income — only when IPA not done; residency + count come from Buyer Profile above */}
            {data.property_type && data.ipa_done === false && (
                <Section title="Borrower Income" icon={<Wallet size={15} />}>
                    {borrowers.map((b, i) => (
                        <div key={i} className="rounded-lg border border-slate-200 p-4 space-y-4">
                            <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                                {borrowers.length === 1 ? 'Borrower' : `Borrower ${i + 1}`}
                            </p>
                            <Question label="Employment">
                                <PillSelect
                                    value={b.employment ?? 'employed'}
                                    onChange={v => updateBorrower(i, { employment: v as 'employed' | 'self_employed' })}
                                    options={[{ value: 'employed', label: 'Employed' }, { value: 'self_employed', label: 'Self-Employed' }]}
                                />
                            </Question>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <Question label="Age">
                                    <FieldInput type="number" value={b.age ?? ''}
                                        onChange={v => updateBorrower(i, { age: num(v) })}
                                        onBlur={() => { if (b.age != null && b.age > 0) { if (b.age < 21) updateBorrower(i, { age: 21 }); else if (b.age > 75) updateBorrower(i, { age: 75 }) } }} />
                                </Question>
                                {b.employment !== 'self_employed' && (
                                    <Question label="Monthly Basic Salary">
                                        <FieldInput commas prefix="$" value={b.basic_salary ?? ''}
                                            onChange={v => updateBorrower(i, { basic_salary: num(v) })} />
                                    </Question>
                                )}
                                <Question label={b.employment === 'self_employed' ? 'Annual Income (NOA)' : 'Annual Bonus / Variable Income'}>
                                    <FieldInput commas prefix="$" value={b.annual_variable ?? ''}
                                        onChange={v => updateBorrower(i, { annual_variable: num(v) })} />
                                </Question>
                                <Question label="Monthly Commitments">
                                    <FieldInput commas prefix="$" value={b.commitments ?? ''}
                                        onChange={v => updateBorrower(i, { commitments: num(v) })} />
                                </Question>
                            </div>
                        </div>
                    ))}

                    {/* IWAA + Tenure Range + Preferred Tenure — shown once ages are entered */}
                    {computation.weightedAge != null && computation.tenureRange && (
                        <div className="rounded-lg border border-[#03a9e7]/20 bg-sky-50/30 p-4 space-y-4">
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">IWAA</p>
                                    <p className="text-base font-bold text-[#052d4a]">{computation.weightedAge} yrs</p>
                                    <p className="text-[10px] text-slate-400">Income-weighted avg age</p>
                                </div>
                                <div>
                                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Option 1 Tenure</p>
                                    <p className="text-base font-bold text-[#052d4a]">{computation.tenureRange.opt1} yrs</p>
                                    <p className="text-[10px] text-slate-400">Max (age cap 65) · 75% LTV</p>
                                </div>
                                <div>
                                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Option 2 Tenure</p>
                                    <p className="text-base font-bold text-[#052d4a]">{computation.tenureRange.opt2} yrs</p>
                                    <p className="text-[10px] text-slate-400">Max (age cap 75) · 55% LTV</p>
                                </div>
                            </div>
                            {(() => {
                                const maxT = Math.max(computation.tenureRange.opt1, computation.tenureRange.opt2)
                                return (
                                    <div>
                                        <p className="text-xs font-semibold text-slate-600 mb-1.5">
                                            Preferred Tenure
                                            <span className="font-normal text-slate-400 ml-1.5">(5–{maxT} yrs)</span>
                                        </p>
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="number"
                                                min={5}
                                                max={maxT}
                                                value={rawPrefTenure !== '' ? rawPrefTenure : data.preferred_tenure != null ? String(data.preferred_tenure) : ''}
                                                placeholder={String(maxT)}
                                                onChange={e => setRawPrefTenure(e.target.value)}
                                                onBlur={() => {
                                                    const parsed = parseInt(rawPrefTenure, 10)
                                                    setRawPrefTenure('')
                                                    if (!isNaN(parsed) && parsed > 0) {
                                                        update({ preferred_tenure: Math.max(5, Math.min(maxT, parsed)) })
                                                    } else if (rawPrefTenure === '') {
                                                        update({ preferred_tenure: undefined })
                                                    }
                                                }}
                                                className="w-24 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12"
                                            />
                                            <span className="text-xs text-slate-500">yrs</span>
                                        </div>
                                    </div>
                                )
                            })()}
                        </div>
                    )}
                </Section>
            )}

            {/* ── RESULTS ── */}
            {computation.ready ? (
                <>
                    <div className={`grid gap-4 ${computation.options.length > 1 ? 'md:grid-cols-2' : 'md:grid-cols-1'}`}>
                        {computation.options.map(opt => {
                            // IPA options are never blocked — the bank already validated the tenure.
                            // Income-computed options are blocked when preferred tenure exceeds their max.
                            const blocked = opt.source !== 'ipa' && data.preferred_tenure != null && data.preferred_tenure > opt.maxTenure
                            return (
                                <OptionCard
                                    key={opt.key}
                                    opt={opt}
                                    ipaBank={opt.source === 'ipa' ? (data.ipa?.bank ?? undefined) : undefined}
                                    price={effectivePrice}
                                    selectable={computation.options.length > 1}
                                    selected={liquidityOption === opt.key}
                                    onSelect={() => setLiquidityOption(opt.key as '1' | '2')}
                                    blocked={blocked}
                                    preferredTenure={data.preferred_tenure}
                                    adjustedLoan={adjustedLoans[opt.key]}
                                    onAdjustLoan={v => setAdjustedLoans(prev => ({ ...prev, [opt.key]: v }))}
                                    rule={meta?.rule ?? 'tdsr'}
                                />
                            )
                        })}
                    </div>

                    {/* Stamp duty + fees */}
                    <Section title="Stamp Duty & Estimated Fees" icon={<FileText size={15} />}>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <Stat label="Buyer's Stamp Duty" value={money(computation.bsd)} />
                            <Stat
                                label={`ABSD (${computation.absdRatePct % 1 === 0 ? computation.absdRatePct : computation.absdRatePct.toFixed(1)}%)`}
                                value={money(computation.absd)}
                                hint={computation.absdResidency === 'foreigner' ? 'Foreigner rate' : computation.absdResidency === 'pr' ? 'PR rate' : 'Citizen rate'}
                            />
                            <Stat label="Legal Fee (est.)" value={money(computation.legalFee)} />
                            <Stat label="Valuation Fee (est.)" value={money(computation.valuationFee)} />
                        </div>
                        <Tip>BSD and ABSD (if applicable) must be paid in cash to IRAS, with optional reimbursement from CPF on completion. In practice, CPF cannot disburse monies to IRAS within the 2-week BSD/ABSD deadline.</Tip>
                    </Section>

                    <LiquidityCard
                        options={computation.options.length > 1 ? computation.options.filter(o => o.key === liquidityOption) : computation.options}
                        miscFees={computation.bsd + computation.absd + computation.legalFee + computation.valuationFee}
                        price={effectivePrice}
                        adjustedLoans={adjustedLoans}
                        rule={meta?.rule ?? 'tdsr'}
                    />

                    {/* Packages — priced + filtered for the SELECTED option's loan. The loan
                        size is the agent's "how much loan does the client actually require?"
                        amount (adjustedLoans), falling back to the option's bank-approved base.
                        Option 1 vs Option 2 are different loan sizes, so they recommend
                        different packages (min-loan tiers differ). */}
                    {(() => {
                        const selectedOpt = computation.options.find(o => o.key === liquidityOption) ?? computation.options[0]
                        if (!selectedOpt || selectedOpt.finalLoan <= 0) return null
                        const pkgLoan = adjustedLoans[selectedOpt.key] ?? selectedOpt.finalLoan
                        if (pkgLoan <= 0) return null
                        return (
                            <PurchasePackages
                                loan={pkgLoan}
                                tenureYears={selectedOpt.tenure}
                                propertyType={ratesPropertyType(data.property_type)}
                                bucOnly={!!meta?.buc}
                                priorityBanks={data.priority_client ? data.priority_banks : undefined}
                                selectedId={selectedPkgId}
                                excludeBank={data.ipa_done && data.ipa?.bank ? data.ipa.bank : undefined}
                                onSelect={onSelectPackage}
                            />
                        )
                    })()}

                    {/* BUC Progressive Payment Scheme — New Launch Condo and EC New Launch */}
                    {isBuc && (() => {
                        const selectedOpt = computation.options.find(o => o.key === liquidityOption) ?? computation.options[0]
                        if (!selectedOpt) return null
                        const ltvPct = selectedOpt.ltvPct
                        type StageSource = 'cash' | 'cashcpf' | 'bank'
                        const stages: Array<{ label: string; pct: number; source: StageSource }> = isDps ? [
                            { label: 'OTP / Booking Fee', pct: 0.05, source: 'cash' },
                            { label: 'S&P Signing (within 8 weeks)', pct: 0.15, source: 'cashcpf' },
                            { label: 'TOP — Bank loan (disbursed in full)', pct: ltvPct, source: 'bank' },
                            { label: 'TOP — Buyer balance (cash / CPF)', pct: Math.max(0, 0.80 - ltvPct), source: 'cashcpf' },
                        ] : [
                            { label: 'OTP / Booking Fee', pct: 0.05, source: 'cash' },
                            { label: 'S&P Exercise (within 8 weeks)', pct: 0.20, source: 'cashcpf' },
                            { label: 'Foundation', pct: 0.10, source: 'bank' },
                            { label: 'Reinforced Concrete Framework', pct: 0.10, source: 'bank' },
                            { label: 'Partition Walls', pct: 0.05, source: 'bank' },
                            { label: 'Roofing', pct: 0.05, source: 'bank' },
                            { label: 'Windows, Doors, Plumbing & Drains', pct: 0.05, source: 'bank' },
                            { label: 'Roads & Car Parks', pct: 0.05, source: 'bank' },
                            { label: 'Vacant Possession (TOP)', pct: 0.25, source: 'bank' },
                            { label: 'CSC / Legal Completion', pct: 0.10, source: 'bank' },
                        ]
                        const buyerTotal = stages.filter(s => s.source !== 'bank').reduce((sum, s) => sum + s.pct, 0)
                        const bankTotal = stages.filter(s => s.source === 'bank').reduce((sum, s) => sum + s.pct, 0)
                        const additionalBuyer = Math.max(0, (1 - ltvPct) - (isDps ? 0.20 : 0.25))
                        const sourceLabel = (s: StageSource) => s === 'cash' ? 'Cash only' : s === 'cashcpf' ? 'Cash / CPF' : 'Bank'
                        const sourceBadgeCls = (s: StageSource) =>
                            s === 'bank' ? 'bg-[#03a9e7]/10 text-[#03a9e7]'
                            : s === 'cash' ? 'bg-amber-50 text-amber-700'
                            : 'bg-slate-100 text-slate-600'
                        return (
                            <Section title={isDps ? 'BUC Progressive Payment — DPS' : 'BUC Progressive Payment — PPS'} icon={<Wallet size={15} />}>
                                {isDps && effectivePrice !== (data.property_price ?? 0) && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-1">
                                        <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                                            <Info size={13} className="shrink-0 text-amber-600" /> DPS — 3% Premium Applied
                                        </p>
                                        <p className="text-xs text-amber-700">
                                            Effective price: <span className="font-bold">{money(effectivePrice)}</span>
                                            {data.property_price ? <> (base {money(data.property_price)} + {money(effectivePrice - data.property_price)} DPS premium)</> : null}
                                        </p>
                                    </div>
                                )}
                                <div className="rounded-lg border border-slate-200 overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-200">
                                                <th className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Stage</th>
                                                <th className="px-3 py-2.5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider w-12">%</th>
                                                <th className="px-3 py-2.5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">Amount</th>
                                                <th className="px-3 py-2.5 text-center text-[11px] font-bold text-slate-500 uppercase tracking-wider">Source</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {stages.map((stage, i) => (
                                                <tr key={i} className={`border-b border-slate-50 last:border-b-0 ${stage.source === 'bank' ? 'bg-sky-50/30' : 'bg-white'}`}>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${stage.source === 'bank' ? 'bg-[#03a9e7]' : 'bg-amber-400'}`} />
                                                            <span className="text-sm text-slate-700">{stage.label}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3 text-right font-semibold text-slate-600">{Math.round(stage.pct * 100)}%</td>
                                                    <td className="px-3 py-3 text-right font-bold text-[#052d4a]">
                                                        {effectivePrice > 0 ? money(Math.round(effectivePrice * stage.pct)) : '—'}
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${sourceBadgeCls(stage.source)}`}>
                                                            {sourceLabel(stage.source)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr className="border-t-2 border-slate-200 bg-slate-50/80">
                                                <td className="px-4 py-3 text-sm font-bold text-slate-600">Total</td>
                                                <td className="px-3 py-3 text-right text-sm font-bold text-[#052d4a]">100%</td>
                                                <td className="px-3 py-3 text-right text-sm font-bold text-[#052d4a]">{effectivePrice > 0 ? money(effectivePrice) : '—'}</td>
                                                <td />
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                                <div className="flex gap-5 flex-wrap">
                                    <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                                        <span className="text-xs text-slate-600">Buyer: <span className="font-bold">{Math.round(buyerTotal * 100)}%</span>{effectivePrice > 0 ? <> · {money(Math.round(effectivePrice * buyerTotal))}</> : null}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-[#03a9e7] shrink-0" />
                                        <span className="text-xs text-slate-600">Bank: <span className="font-bold">{Math.round(bankTotal * 100)}%</span>{effectivePrice > 0 ? <> · {money(Math.round(effectivePrice * bankTotal))}</> : null}</span>
                                    </div>
                                </div>
                                {!isDps && additionalBuyer > 0.001 && (
                                    <Tip>For this option ({Math.round(ltvPct * 100)}% LTV), buyer pays an additional {Math.round(additionalBuyer * 100)}% ({effectivePrice > 0 ? money(Math.round(effectivePrice * additionalBuyer)) : '—'}) spread across the construction stages alongside the bank.</Tip>
                                )}
                                {isDps ? (
                                    <Tip>DPS: no construction-stage payments — full outstanding balance (bank loan + buyer balance) is settled at TOP.</Tip>
                                ) : (
                                    <Tip>PPS: the bank disburses progressively at each milestone; interest is charged only on the amount disbursed — no principal repayment until TOP.</Tip>
                                )}
                            </Section>
                        )
                    })()}

                    {/* Monthly Instalment — embedded amortisation calculator — non-BUC only */}
                    {!isBuc && (() => {
                        const selectedOpt = computation.options.find(o => o.key === liquidityOption) ?? computation.options[0]
                        if (!selectedOpt) return null
                        const hasPkg = pkg != null
                        const pkgSchedule = pkg?.rate_schedule as RateScheduleEntry[] | undefined
                        const activeSchedule: RateScheduleEntry[] = (hasPkg && pkgSchedule?.length)
                            ? pkgSchedule
                            : (data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE)
                        const topYearRaw = data.otp_dates?.top_year ? parseInt(data.otp_dates.top_year) : NaN
                        const bucYears = isBuc && !isNaN(topYearRaw) ? Math.max(1, topYearRaw - new Date().getFullYear()) : null
                        const lockinYears = bucYears ?? (pkg?.lockin_years as number | undefined) ?? data.reference_lockin_years
                        const t1 = data.preferred_tenure ?? selectedOpt.maxTenure
                        const t2 = preferredTenure2 ?? selectedOpt.maxTenure
                        const adjLoan = adjustedLoans[selectedOpt.key]
                        const fieldPlaceholder = selectedOpt.finalLoan
                        const loan = adjLoan ?? fieldPlaceholder
                        const hasThereafter = activeSchedule.some(e => e.thereafter)

                        const amortRows1 = computeAmortization(loan, t1, activeSchedule, soraForAmort)
                        const amortRows2 = computeAmortization(loan, t2, activeSchedule, soraForAmort)

                        const m1 = amortRows1[0]?.instalment ?? null
                        const m2 = amortRows2[0]?.instalment ?? null
                        const i1 = lockinYears != null ? (amortRows1.find(r => r.year === lockinYears)?.cumulativeInterest ?? null) : null
                        const i2 = lockinYears != null ? (amortRows2.find(r => r.year === lockinYears)?.cumulativeInterest ?? null) : null

                        const lockInCards = lockinYears != null
                            ? Array.from({ length: lockinYears }, (_, i) => ({
                                year: i + 1,
                                value: amortRows1.find(r => r.year === i + 1)?.cumulativeInterest ?? null,
                                instalment: amortRows1.find(r => r.year === i + 1)?.instalment ?? null,
                              }))
                            : []

                        const inputCls = 'w-20 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12'
                        return (
                            <Section title="Amortization" icon={<Wallet size={15} />}>

                                {/* Live SORA rates */}
                                {soraForAmort && (soraForAmort.comp_sora_1m != null || soraForAmort.comp_sora_3m != null) && (
                                    <div className="flex items-center gap-3 flex-wrap">
                                        {soraForAmort.comp_sora_1m != null && (
                                            <div className="flex items-baseline gap-1.5">
                                                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">1M SORA</span>
                                                <span className="text-base font-black text-[#052d4a]">{soraForAmort.comp_sora_1m.toFixed(4)}%</span>
                                            </div>
                                        )}
                                        {soraForAmort.comp_sora_1m != null && soraForAmort.comp_sora_3m != null && (
                                            <span className="w-px h-5 bg-slate-200 shrink-0" />
                                        )}
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
                                        {lockinYears != null && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#03a9e7] bg-sky-50 border border-sky-100 px-2 py-0.5 rounded-full">
                                                <Lock size={9} /> {isBuc ? `${lockinYears} yrs to TOP` : `${lockinYears}-yr lock-in`}
                                            </span>
                                        )}
                                        {hasPkg && (
                                            <button type="button"
                                                onClick={() => update({ selected_package_snapshot: undefined })}
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
                                                <RateRow key={idx}
                                                    entry={entry} label={`Year ${entry.year}`} isLockin
                                                    onChange={patch => updateScheduleRow(schedIdx, patch)}
                                                    onRemove={() => removeScheduleRow(schedIdx)}
                                                    canRemove={(data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE).length > 1}
                                                    refId={`amort-refs-${idx}`}
                                                />
                                            )
                                        })}

                                        {hasThereafter && (
                                            <div className="flex items-center gap-3 px-3 py-1.5 bg-slate-50 border-t border-b border-slate-100">
                                                <div className="flex-1 h-px bg-slate-200" />
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Out of lock-in</span>
                                                <div className="flex-1 h-px bg-slate-200" />
                                            </div>
                                        )}

                                        {activeSchedule.filter(e => e.thereafter).map((entry, idx) => {
                                            const schedIdx = activeSchedule.indexOf(entry)
                                            return hasPkg ? (
                                                <div key={`thereafter-${idx}`} className="flex items-center gap-2 px-3 py-2.5 bg-slate-50/60">
                                                    <div className="w-1 h-7 rounded-full shrink-0 bg-slate-200" />
                                                    <span className="w-20 shrink-0 text-xs font-bold text-slate-400">Thereafter</span>
                                                    <span className="text-xs font-semibold text-slate-600">
                                                        {entry.type === 'fixed'
                                                            ? `${entry.rate?.toFixed(2) ?? '—'}% fixed`
                                                            : `${entry.reference ?? ''} + ${entry.spread?.toFixed(2) ?? '—'}%`}
                                                    </span>
                                                </div>
                                            ) : (
                                                <RateRow key={`thereafter-${idx}`}
                                                    entry={entry} label="Thereafter" isLockin={false}
                                                    onChange={patch => updateScheduleRow(schedIdx, patch)}
                                                    onRemove={() => removeScheduleRow(schedIdx)}
                                                    canRemove={(data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE).length > 1}
                                                    refId={`amort-refs-thereafter-${idx}`}
                                                />
                                            )
                                        })}
                                    </div>

                                    {!hasPkg && (
                                        <div className="flex gap-2 mt-2">
                                            <button type="button" onClick={addScheduleYear}
                                                className="flex items-center gap-1 text-xs font-semibold text-[#03a9e7] hover:bg-sky-50 px-2.5 py-1.5 rounded-lg transition-colors">
                                                <Plus size={12} /> Add Year
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Lock-in years — editable for non-BUC; BUC derives it from TOP year */}
                                {isBuc ? (
                                    lockinYears != null && (
                                        <p className="text-[11px] text-[#03a9e7] flex items-center gap-1">
                                            <Info size={11} className="shrink-0" />
                                            Interest calculated over {lockinYears} year{lockinYears !== 1 ? 's' : ''} to TOP — update Expected TOP Year above to change.
                                        </p>
                                    )
                                ) : (
                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                        <Lock size={11} className="text-[#03a9e7] shrink-0" />
                                        <span className="shrink-0">Lock-in period:</span>
                                        <input type="number" min={1} max={10}
                                            value={data.reference_lockin_years ?? ''}
                                            placeholder={pkg?.lockin_years != null ? String(pkg.lockin_years) : 'yrs'}
                                            onChange={e => update({ reference_lockin_years: num(e.target.value) })}
                                            className="w-14 px-2 py-1 rounded-md border border-slate-200 bg-white text-center font-medium text-slate-700 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12" />
                                        <span>yrs</span>
                                        {hasPkg && pkg.lockin_years != null && data.reference_lockin_years == null && (
                                            <span className="text-[11px] text-slate-400">(from package)</span>
                                        )}
                                    </div>
                                )}

                                {/* Per-year interest cards */}
                                {lockInCards.length > 0 && (
                                    <div className="flex gap-2 flex-wrap">
                                        {lockInCards.map(({ year, value, instalment }, i) => {
                                            const isLast = i === lockInCards.length - 1
                                            if (isLast) {
                                                return (
                                                    <div key={year} className="flex-1 min-w-[120px] rounded-xl p-3.5 text-white"
                                                        style={{ background: 'linear-gradient(135deg, #052d4a 0%, #0a4a7a 100%)' }}>
                                                        <p className="text-[10px] font-bold text-sky-300 uppercase tracking-wide">Total Int · Yr {year}</p>
                                                        <p className="text-lg font-black mt-1">{value != null ? money(value) : '—'}</p>
                                                        {instalment != null && <p className="text-[10px] text-sky-200/80 mt-0.5">{money(instalment)}</p>}
                                                    </div>
                                                )
                                            }
                                            return (
                                                <div key={year} className="flex-1 min-w-[100px] card p-3">
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Int · Yr {year}</p>
                                                    <p className="text-base font-bold text-[#052d4a] mt-0.5">{value != null ? money(value) : '—'}</p>
                                                    {instalment != null && <p className="text-[10px] text-slate-400 mt-0.5">{money(instalment)}</p>}
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}

                                {/* Tenure range header */}
                                <p className="text-xs text-slate-600">
                                    Tenure Range based off Option {selectedOpt.key}:{' '}
                                    <span className="font-semibold">5 – {selectedOpt.maxTenure} yrs</span>
                                </p>

                                {/* Tenure inputs */}
                                <div className="grid grid-cols-2 gap-5">
                                    <div>
                                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Preferred Tenure 1</p>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="number" min={5} max={selectedOpt.maxTenure}
                                                value={rawPrefTenure !== '' ? rawPrefTenure : t1}
                                                onChange={e => setRawPrefTenure(e.target.value)}
                                                onBlur={() => {
                                                    const parsed = parseInt(rawPrefTenure, 10)
                                                    setRawPrefTenure('')
                                                    if (!isNaN(parsed) && parsed > 0) {
                                                        update({ preferred_tenure: Math.max(5, Math.min(selectedOpt.maxTenure, parsed)) })
                                                    }
                                                }}
                                                className={inputCls}
                                            />
                                            <span className="text-xs text-slate-400">yrs</span>
                                        </div>
                                        <p className="text-[10px] text-slate-400 mt-1">Synced with preferred tenure above</p>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide cursor-pointer select-none">
                                            <input type="checkbox" checked={showCompare} onChange={e => setShowCompare(e.target.checked)}
                                                className="rounded border-slate-300 accent-[#03a9e7]" />
                                            {showCompare ? 'Preferred Tenure 2' : 'Compare Tenure'}
                                        </label>
                                        {showCompare && (
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number" min={5} max={selectedOpt.maxTenure}
                                                    value={rawPrefTenure2 !== '' ? rawPrefTenure2 : (preferredTenure2 != null ? preferredTenure2 : '')}
                                                    placeholder={String(selectedOpt.maxTenure)}
                                                    onChange={e => setRawPrefTenure2(e.target.value)}
                                                    onBlur={() => {
                                                        const parsed = parseInt(rawPrefTenure2, 10)
                                                        setRawPrefTenure2('')
                                                        if (!isNaN(parsed) && parsed > 0) {
                                                            setPreferredTenure2(Math.max(5, Math.min(selectedOpt.maxTenure, parsed)))
                                                        }
                                                    }}
                                                    className={inputCls}
                                                />
                                                <span className="text-xs text-slate-400">yrs</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Comparison table */}
                                {(() => {
                                    const lockin = lockinYears ?? 0
                                    const f = (n: number | null) => n != null ? `$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
                                    const ti1 = m1 != null && lockin > 0 ? m1 * lockin * 12 : null
                                    const ti2 = m2 != null && lockin > 0 ? m2 * lockin * 12 : null
                                    const ol1 = lockin > 0 ? (amortRows1.find(r => r.year === lockin)?.balance ?? null) : null
                                    const ol2 = lockin > 0 ? (amortRows2.find(r => r.year === lockin)?.balance ?? null) : null
                                    const dc = (d: number) => d > 0 ? 'text-red-500' : d < 0 ? 'text-emerald-600' : 'text-slate-400'
                                    const ds = (d: number) => d >= 0 ? '+' : '−'
                                    const diffCols: { v1: number | null; v2: number | null; sfx: string }[] = [
                                        { v1: m1, v2: m2, sfx: ' /mth' },
                                        { v1: ti1, v2: ti2, sfx: '' },
                                        { v1: ol1, v2: ol2, sfx: '' },
                                        { v1: i1, v2: i2, sfx: '' },
                                    ]
                                    return (
                                        <div className="rounded-lg border border-slate-200 overflow-hidden">
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
                                                            <span className="font-normal normal-case tracking-normal text-slate-400">{isBuc ? `Pre-TOP ${lockin} yr${lockin > 1 ? 's' : ''}` : `Paid over ${lockin} yr${lockin > 1 ? 's' : ''}`}</span>
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr className="border-b border-slate-100 bg-sky-50/30">
                                                        <td className="px-3 py-3">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="w-1.5 h-4 rounded-full bg-[#03a9e7] shrink-0" />
                                                                <span className="font-bold text-[#052d4a]">{t1}</span>
                                                                <span className="text-xs text-slate-400 ml-0.5">yrs</span>
                                                                <span className="text-[10px] font-bold text-[#03a9e7] bg-sky-100 px-1.5 py-0.5 rounded-full ml-1">Primary</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-3 text-right font-bold text-[#052d4a]">{m1 != null ? f(m1) : '—'}</td>
                                                        <td className="px-3 py-3 text-right font-bold text-[#052d4a]">{ti1 != null ? f(ti1) : '—'}</td>
                                                        <td className="px-3 py-3 text-right font-bold text-[#052d4a]">{ol1 != null ? f(ol1) : '—'}</td>
                                                        <td className="px-3 py-3 text-right font-bold text-[#052d4a]">{i1 != null ? f(i1) : '—'}</td>
                                                    </tr>
                                                    {showCompare && (
                                                        <tr className="border-b border-slate-100">
                                                            <td className="px-3 py-3">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="w-1.5 h-4 rounded-full bg-slate-300 shrink-0" />
                                                                    <span className="font-bold text-slate-700">{t2}</span>
                                                                    <span className="text-xs text-slate-400 ml-0.5">yrs</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-3 text-right font-semibold text-slate-700">{m2 != null ? f(m2) : '—'}</td>
                                                            <td className="px-3 py-3 text-right font-semibold text-slate-700">{ti2 != null ? f(ti2) : '—'}</td>
                                                            <td className="px-3 py-3 text-right font-semibold text-slate-700">{ol2 != null ? f(ol2) : '—'}</td>
                                                            <td className="px-3 py-3 text-right font-semibold text-slate-700">{i2 != null ? f(i2) : '—'}</td>
                                                        </tr>
                                                    )}
                                                    {showCompare && m1 != null && m2 != null && (
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
                                    )
                                })()}

                                {/* Year-by-Year Breakdown — lock-in period, both tenures */}
                                {lockinYears != null && [
                                    { rows: amortRows1, t: t1, label: 'Tenure 1' },
                                    ...(showCompare ? [{ rows: amortRows2, t: t2, label: 'Tenure 2' }] : []),
                                ].map(({ rows, t, label }) => rows.length > 0 && (
                                    <div key={label} className="rounded-lg border border-slate-200 overflow-hidden">
                                        <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                                            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Year-by-Year Breakdown</span>
                                            <span className="text-[11px] text-slate-400">{isBuc ? 'Pre-TOP' : 'Lock-in'} · {label} ({t} yrs)</span>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-xs">
                                                <thead>
                                                    <tr className="border-b border-slate-100 bg-slate-50/60">
                                                        <th className="px-3 py-2 text-left font-semibold text-slate-400 uppercase tracking-wide w-10">Yr</th>
                                                        <th className="px-3 py-2 text-left font-semibold text-slate-400 uppercase tracking-wide">Rate</th>
                                                        <th className="px-3 py-2 text-right font-semibold text-slate-400 uppercase tracking-wide">Monthly</th>
                                                        <th className="px-3 py-2 text-right font-semibold text-slate-400 uppercase tracking-wide">Prin /mo</th>
                                                        <th className="px-3 py-2 text-right font-semibold text-slate-400 uppercase tracking-wide">Int /mo</th>
                                                        <th className="px-3 py-2 text-right font-semibold text-slate-400 uppercase tracking-wide">Int (yr)</th>
                                                        <th className="px-3 py-2 text-right font-semibold text-slate-400 uppercase tracking-wide">Balance</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {rows.filter(r => r.year <= lockinYears).map(row => {
                                                        const hasData = row.instalment != null
                                                        const isLastLockin = row.year === lockinYears
                                                        const fmt2 = (n: number | null) => n != null ? `$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
                                                        return (
                                                            <tr key={row.year} className={`border-b border-slate-50 last:border-b-0 ${isLastLockin ? 'bg-sky-50/50' : 'bg-white'}`}>
                                                                <td className="py-2.5 pl-0 pr-3">
                                                                    <div className="flex items-center gap-0 h-full">
                                                                        <div className="w-1 self-stretch rounded-r mr-2.5 bg-[#03a9e7]" />
                                                                        <span className="font-bold text-[#03a9e7]">{row.year}</span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-3 py-2.5">
                                                                    {hasData
                                                                        ? <span className="inline-block font-bold px-2 py-0.5 rounded-full bg-sky-100 text-[#03a9e7]">{row.rate!.toFixed(2)}%</span>
                                                                        : <span className="text-slate-200">—</span>}
                                                                </td>
                                                                <td className="px-3 py-2.5 text-right font-semibold text-slate-700">{fmt2(row.instalment)}</td>
                                                                <td className="px-3 py-2.5 text-right text-slate-500">{fmt2(row.monthPrincipal)}</td>
                                                                <td className="px-3 py-2.5 text-right text-slate-500">{fmt2(row.monthInterest)}</td>
                                                                <td className="px-3 py-2.5 text-right text-slate-500">{fmt2(row.yearInterest)}</td>
                                                                <td className="px-3 py-2.5 text-right">
                                                                    {hasData ? (
                                                                        isLastLockin
                                                                            ? <span className="font-black text-[#052d4a] bg-sky-100 border border-sky-200 px-2 py-0.5 rounded-full">{fmt2(row.balance)}</span>
                                                                            : <span className="font-semibold text-slate-700">{fmt2(row.balance)}</span>
                                                                    ) : <span className="text-slate-200">—</span>}
                                                                </td>
                                                            </tr>
                                                        )
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ))}

                                <Tip>A shorter tenure will result in a higher income requirement to pass TDSR.</Tip>
                            </Section>
                        )
                    })()}

                    {/* Next step — client-facing only (Present / Chat summary / client checklist).
                        Pipeline stage + follow-up live on the internal Overview tab. */}
                    <NextStepCard
                        actions={actions}
                        actionsDone={actionsDone}
                        onToggleAction={toggleAction}
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
                    Enter the property type, price{data.ipa_done ? ' and IPA details' : ' and borrower income'} to see the financing options.
                </div>
            )}

            {/* Hand-off — leaves the client-facing advisory and goes to the internal
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
                <PurchasePresentation
                    clientName={clientName}
                    propertyLabel={meta?.label ?? 'Property'}
                    propertyType={data.property_type}
                    price={data.property_price ?? 0}
                    referenceRate={data.reference_rate ?? DEFAULT_REFERENCE_RATE}
                    computation={computation}
                    remarks={remarks}
                    selectedPackage={data.selected_package_snapshot as ProposalPackage | undefined}
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

// ─── OTP date fields per property type ────────────────────────────────────────
/** Interest paid over the first `periodYears` of a loan (for lock-in cost display). */
function interestOverPeriod(loan: number, annualRatePct: number, tenureYears: number, periodYears: number): number {
    if (loan <= 0 || tenureYears <= 0 || annualRatePct <= 0) return 0
    const m = monthlyInstallment(loan, annualRatePct, tenureYears)
    const k = Math.min(Math.round(periodYears), Math.round(tenureYears)) * 12
    const n = Math.round(tenureYears) * 12
    const r = annualRatePct / 100 / 12
    const principalPaid = loan * (Math.pow(1 + r, k) - 1) / (Math.pow(1 + r, n) - 1)
    return Math.max(0, m * k - principalPaid)
}

const RESALE_TYPES: PurchasePropertyType[] = ['resale_condo', 'resale_landed', 'resale_hdb']
function isResale(type?: PurchasePropertyType | string): boolean {
    return RESALE_TYPES.includes(type as PurchasePropertyType)
}

type OtpFieldKey = 'option_expiry' | 'completion' | 'top_year' | 'snp_date' | 'key_collection_year'
function otpFieldsFor(type?: PurchasePropertyType): { key: OtpFieldKey; label: string; type: string }[] {
    if (!type) return []
    if (type === 'resale_condo' || type === 'resale_hdb' || type === 'resale_landed') {
        return [
            { key: 'option_expiry', label: 'Option Expiry Date', type: 'date' },
            { key: 'completion', label: 'Expected Purchase Completion Date', type: 'date' },
        ]
    }
    if (type === 'new_launch_condo' || type === 'ec_new_launch') {
        return [
            { key: 'top_year', label: 'Expected TOP Year', type: 'text' },
            { key: 'snp_date', label: 'Expected S&P Exercise Date', type: 'date' },
        ]
    }
    if (type === 'bto') {
        return [{ key: 'key_collection_year', label: 'Expected Key Collection Year', type: 'text' }]
    }
    return []
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, icon, subtitle, children }: { title: string; icon?: ReactNode; subtitle?: string; children: ReactNode }) {
    return (
        <div className="card p-5 space-y-4">
            <div>
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    {icon && <span className="text-[#03a9e7]">{icon}</span>}{title}
                </p>
                {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
            </div>
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
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${opt.disabled ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
            <p className="text-[11px] text-slate-500 leading-tight">{label}</p>
            <p className="text-sm font-bold text-[#052d4a] mt-0.5">{value}</p>
            {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
        </div>
    )
}

function LiquidityCard({ options, miscFees, price, adjustedLoans, rule }: {
    options: OptionResult[]
    miscFees: number
    price: number
    adjustedLoans?: Record<string, number | undefined>
    rule?: ServicingRule
}) {
    if (!options.length || price <= 0) return null
    const fmtFrac = (frac: number) => {
        const v = frac * 100
        return `${Number.isInteger(v) ? v : v.toFixed(1)}%`
    }
    return (
        <Section title="Total Liquidity Required" icon={<Wallet size={15} />}>
            <p className="text-[11px] text-slate-400 -mt-1">
                Misc fees (BSD + ABSD + legal + valuation) = {money(miscFees)}
            </p>
            <div className={`grid gap-4 ${options.length > 1 ? 'md:grid-cols-2' : ''}`}>
                {options.map(opt => {
                    // S2/S3 target: if user adjusted loan to a higher amount, bridge from base to target;
                    // otherwise default to the full LTV ceiling (original behaviour).
                    const adjLoan = adjustedLoans?.[opt.key]
                    const hasAdjustment = adjLoan != null && adjLoan > opt.finalLoan
                    const s2s3Target = hasAdjustment ? adjLoan! : opt.ltvCeiling
                    const s2s3Balance = Math.max(0, price - s2s3Target - opt.minCashDown)
                    const s2s3BalancePct = price > 0 ? s2s3Balance / price : 0
                    const s2s3LtvPct = price > 0 ? s2s3Target / price : opt.ltvPct
                    const s2s3Pledge: PledgeData | null = hasAdjustment && rule
                        ? computePledge(adjLoan! - opt.finalLoan, opt.tenure, rule)
                        : opt.pledge

                    // S1: always the original bank-approved / income-computed loan (fixed)
                    const s1Total = opt.minCashDown + opt.cashCpfDown + miscFees
                    const s2Total = s2s3Pledge ? s2s3Pledge.pledgeFund + opt.minCashDown + s2s3Balance + miscFees : null
                    const s3Total = s2s3Pledge ? s2s3Pledge.showFund + opt.minCashDown + s2s3Balance + miscFees : null

                    return (
                        <div key={opt.key} className={`rounded-lg border p-4 space-y-3 ${opt.key === '1' ? 'border-sky-200 bg-sky-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                            <p className="text-xs font-bold text-[#052d4a]">Option {opt.key} — {pct(opt.ltvPct)} LTV</p>

                            {/* S1 — fixed: the base loan from IPA / income (no pledging) */}
                            <div className="space-y-1.5">
                                <p className="text-[11px] font-semibold text-red-500 uppercase tracking-wide">S1 — Without pledging / showing</p>
                                <p className="text-sm font-semibold text-[#052d4a] pb-0.5">
                                    No Pledging/Showing to get {money(opt.finalLoan)} loan (<span className="text-[#03a9e7]">{fmtFrac(price > 0 ? opt.finalLoan / price : opt.ltvPct)}</span>)
                                </p>
                                <Row label={<>Min Cash <span className="text-[#03a9e7]">({fmtFrac(opt.minCashPct)})</span></>} value={money(opt.minCashDown)} />
                                <Row label={<>Balance Cash / CPF <span className="text-[#03a9e7]">({fmtFrac(opt.cashCpfPct)})</span></>} value={money(opt.cashCpfDown)} />
                                <Row label="Misc Fees" value={money(miscFees)} muted />
                                <div className="border-t border-dashed border-slate-200 pt-1.5">
                                    <Row label="Total Required" value={money(s1Total)} strong />
                                </div>
                            </div>

                            {s2s3Pledge && s2Total !== null && s3Total !== null && (
                                <>
                                    {/* S2 — pledge to reach target (adjusted or full LTV) */}
                                    <div className="border-t border-slate-200 pt-3 space-y-1.5">
                                        <p className="text-[11px] font-semibold text-red-500 uppercase tracking-wide">S2 — With pledging</p>
                                        <Row
                                            label={<>Pledging of Funds to get {money(s2s3Target)} Loan (<span className="text-[#03a9e7]">{fmtFrac(s2s3LtvPct)}</span>)</>}
                                            value={money(s2s3Pledge.pledgeFund)}
                                            highlight
                                        />
                                        <Row label={<>Min Cash <span className="text-[#03a9e7]">({fmtFrac(opt.minCashPct)})</span></>} value={money(opt.minCashDown)} />
                                        <Row label={<>Cash / CPF <span className="text-[#03a9e7]">({fmtFrac(s2s3BalancePct)})</span></>} value={money(s2s3Balance)} />
                                        <Row label="Misc Fees" value={money(miscFees)} muted />
                                        <div className="border-t border-dashed border-slate-200 pt-1.5">
                                            <Row label="Total Required" value={money(s2Total)} strong />
                                        </div>
                                    </div>

                                    {/* S3 — show funds to reach target */}
                                    <div className="border-t border-slate-200 pt-3 space-y-1.5">
                                        <p className="text-[11px] font-semibold text-red-500 uppercase tracking-wide">S3 — With show funds</p>
                                        <Row
                                            label={<>Showing of Funds to get {money(s2s3Target)} Loan (<span className="text-[#03a9e7]">{fmtFrac(s2s3LtvPct)}</span>)</>}
                                            value={money(s2s3Pledge.showFund)}
                                            highlight
                                        />
                                        <Row label={<>Min Cash <span className="text-[#03a9e7]">({fmtFrac(opt.minCashPct)})</span></>} value={money(opt.minCashDown)} />
                                        <Row label={<>Cash / CPF <span className="text-[#03a9e7]">({fmtFrac(s2s3BalancePct)})</span></>} value={money(s2s3Balance)} />
                                        <Row label="Misc Fees" value={money(miscFees)} muted />
                                        <div className="border-t border-dashed border-slate-200 pt-1.5">
                                            <Row label="Total Required" value={money(s3Total)} strong />
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )
                })}
            </div>
        </Section>
    )
}

function OptionCard({ opt, ipaBank, price, selectable, selected, onSelect, blocked, preferredTenure, adjustedLoan, onAdjustLoan, rule }: {
    opt: OptionResult; ipaBank?: string; price: number
    selectable?: boolean; selected?: boolean; onSelect?: () => void
    blocked?: boolean; preferredTenure?: number
    adjustedLoan?: number
    onAdjustLoan?: (v: number | undefined) => void
    rule?: ServicingRule
}) {
    const [rawLoan, setRawLoan] = useState('')
    const isIpa = opt.source === 'ipa'
    const isOpt1 = opt.key === '1'
    const ltvPctLabel = `${Math.round(opt.ltvPct * 100)}%`
    const minCashPctNum = Math.round(opt.minCashPct * 100)
    const fmtPct = (n: number) => `${n % 1 === 0 ? n : n.toFixed(1)}%`
    const minCashPctLabel = fmtPct(minCashPctNum)

    // Default to the bank-approved / income-eligible loan. For IPA this is the IPA amount;
    // agent can hit Max to bump to the full LTV ceiling.
    const fieldPlaceholder = opt.finalLoan
    const effectiveLoan = adjustedLoan ?? fieldPlaceholder
    const isAdjusted = adjustedLoan != null && Math.round(adjustedLoan) !== Math.round(fieldPlaceholder)
    const actualLtvPctNum = price > 0
        ? Math.round(effectiveLoan / price * 1000) / 10
        : Math.round(opt.ltvPct * 100)
    const balancePctNum = Math.round((100 - minCashPctNum - actualLtvPctNum) * 10) / 10
    const actualLtvPctLabel = fmtPct(actualLtvPctNum)
    const balancePctLabel = fmtPct(balancePctNum)
    const effectiveBalance = price > 0 ? Math.max(0, price - effectiveLoan - opt.minCashDown) : opt.cashCpfDown

    // Bridge from IPA-approved base to whatever is shown (field value or LTV ceiling default).
    const bridgeAmount = Math.max(0, effectiveLoan - opt.finalLoan)
    const bridgePledge: PledgeData | null = bridgeAmount > 1 && rule
        ? computePledge(bridgeAmount, opt.tenure, rule)
        : null

    const borderClass = blocked
        ? 'border-slate-200'
        : selected
            ? 'border-emerald-500 ring-2 ring-emerald-500/20'
            : isOpt1 ? 'border-[#03a9e7]/30' : 'border-slate-200'

    return (
        <div
            className={`rounded-xl border shadow-sm overflow-hidden transition-all ${borderClass} ${selectable && !blocked ? 'cursor-pointer' : ''}`}
            onClick={selectable && !blocked ? onSelect : undefined}
        >
            {/* Header */}
            <div className={`px-5 py-4 border-b ${blocked ? 'flex flex-col items-start gap-1.5' : 'flex items-center justify-between gap-2'} ${blocked ? 'bg-slate-100 border-slate-200'
                : isOpt1 ? 'bg-sky-50/70 border-[#03a9e7]/15' : 'bg-slate-50 border-slate-100'
                }`}>
                <div className="flex items-center gap-2 min-w-0">
                    <p className={`text-sm font-bold ${blocked ? 'text-slate-400' : 'text-[#052d4a]'}`}>
                        Option {opt.key} (Loan-To-Valuation {ltvPctLabel})
                    </p>
                    {isIpa
                        ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#03a9e7]/10 text-[#03a9e7] border border-[#03a9e7]/30 shrink-0">
                            IPA{ipaBank ? ` · ${ipaBank}` : ''}
                          </span>
                        : null
                    }
                </div>
                {selectable && (
                    blocked
                        ? <span className="text-[11px] font-semibold text-amber-600 flex items-center gap-1.5"><XCircle size={13} className="shrink-0" /> Preferred {preferredTenure} yrs exceeds {opt.maxTenure} yr max</span>
                        : selected
                            ? <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 shrink-0"><CheckCircle2 size={13} /> Selected for liquidity</span>
                            : <span className="text-[11px] text-slate-400 shrink-0">Click to view liquidity</span>
                )}
            </div>

            <div className={`px-5 py-4 space-y-5 ${blocked ? 'opacity-40 pointer-events-none select-none' : ''}`}>
                {/* Payment Structure */}
                <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Payment Structure</p>
                    <div className="space-y-1.5">
                        <PayStructureLine>
                            Min <Blue>{minCashPctLabel}</Blue> cash downpayment
                        </PayStructureLine>
                        <PayStructureLine>
                            Tenor is capped at age <Blue>{opt.ageCap}</Blue> and cannot exceed <Blue>{opt.maxTenure} years</Blue>
                        </PayStructureLine>
                        <PayStructureLine>
                            Loan is capped at <Blue>{ltvPctLabel}</Blue> of purchase price or valuation, whichever is <Blue>lower</Blue>
                        </PayStructureLine>
                    </div>
                </div>

                {/* Tenure + Eligibility */}
                <div className="border-t border-dashed border-slate-200 pt-4 space-y-2">
                    <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-500">Tenure</span>
                        <span className="font-semibold text-slate-700">{opt.tenure} yrs</span>
                    </div>
                    {!isIpa && opt.incomeEligibility != null && (
                        <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-slate-500">Estimated Loan Eligibility</span>
                            <span className="font-semibold text-emerald-600">{money(opt.incomeEligibility)}</span>
                        </div>
                    )}
                </div>

                {/* Breakdown */}
                <div className="space-y-3 border-t border-slate-200 pt-4">
                    {price > 0 && (
                        <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-slate-500">Property Price</span>
                            <span className="font-medium text-slate-700">{money(price)}</span>
                        </div>
                    )}
                    <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-500">
                            Min Cash Downpayment <span className="text-[#03a9e7] font-semibold">({minCashPctLabel})</span>
                        </span>
                        <span className="font-semibold text-[#03a9e7]">{money(opt.minCashDown)}</span>
                    </div>
                    {/* LTV — updates when agent enters an actual loan requirement below */}
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-[15px] font-semibold text-slate-700">
                            Loan-To-Valuation <span className="text-[#03a9e7]">({actualLtvPctLabel})</span>
                        </span>
                        <span className="text-[15px] font-bold text-[#03a9e7]">{money(effectiveLoan)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-500">
                            Balance Cash / CPF <span className="text-[#03a9e7] font-semibold">({balancePctLabel})</span>
                        </span>
                        <span className="font-semibold text-[#03a9e7]">{money(effectiveBalance)}</span>
                    </div>
                </div>

                {/* Actual loan requirement — dedicated field + pledge/show info */}
                <div className="border-t border-slate-200 pt-4 space-y-3">
                    <div className="space-y-1.5">
                        <p className="text-[12px] font-semibold text-slate-600">How much loan does the client actually require?</p>
                        <div className="flex items-center gap-1.5">
                            <span className="text-sm text-slate-500 shrink-0">$</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={rawLoan !== '' ? rawLoan : isAdjusted ? Math.round(effectiveLoan).toLocaleString() : ''}
                                placeholder={Math.round(fieldPlaceholder).toLocaleString()}
                                onFocus={e => {
                                    const val = String(Math.round(effectiveLoan))
                                    setRawLoan(val)
                                    const el = e.currentTarget
                                    requestAnimationFrame(() => el.select())
                                }}
                                onChange={e => setRawLoan(e.target.value.replace(/[^\d,]/g, ''))}
                                onBlur={() => {
                                    const parsed = parseInt(rawLoan.replace(/,/g, ''), 10)
                                    setRawLoan('')
                                    if (!isNaN(parsed) && parsed >= 0) {
                                        const clamped = Math.min(Math.round(opt.ltvCeiling), parsed)
                                        onAdjustLoan?.(clamped === Math.round(fieldPlaceholder) ? undefined : clamped)
                                    } else if (rawLoan === '') {
                                        onAdjustLoan?.(undefined)
                                    }
                                }}
                                disabled={blocked}
                                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 transition-all disabled:opacity-50"
                            />
                            {Math.round(effectiveLoan) < Math.round(opt.ltvCeiling) && !blocked && (
                                <button type="button"
                                    onClick={() => { onAdjustLoan?.(Math.round(opt.ltvCeiling)); setRawLoan('') }}
                                    className="text-[11px] font-semibold text-[#03a9e7] hover:text-[#0290c5] bg-sky-50 hover:bg-sky-100 px-2 py-1 rounded-md shrink-0 transition-colors">
                                    Max
                                </button>
                            )}
                            {isAdjusted && (
                                <button type="button"
                                    onClick={() => { onAdjustLoan?.(undefined); setRawLoan('') }}
                                    className="text-[11px] text-slate-400 hover:text-slate-700 shrink-0 underline">
                                    Reset
                                </button>
                            )}
                        </div>
                        <p className="text-[11px] text-slate-400">
                            Bank-approved base: {money(opt.finalLoan)} · Max {ltvPctLabel} LTV: {money(opt.ltvCeiling)}
                        </p>
                    </div>

                    {/* Pledge/show — always references effectiveLoan (field value or LTV ceiling default). */}
                    {bridgePledge ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 space-y-1.5">
                            <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                                <AlertTriangle size={12} className="shrink-0" />
                                {isAdjusted
                                    ? <>Shortfall Loan Amount: {money(bridgeAmount)}</>
                                    : <>At {ltvPctLabel} ({money(effectiveLoan)})</>
                                }
                            </p>
                            {isAdjusted && effectiveLoan <= opt.finalLoan + 1 ? (
                                <p className="text-xs text-emerald-700">
                                    No pledging needed — within bank-approved {money(opt.finalLoan)}.
                                </p>
                            ) : (
                                <p className="text-xs text-amber-700 leading-relaxed">
                                    {isAdjusted ? <>For {money(effectiveLoan)} ({actualLtvPctLabel}): </> : <>Either </>}
                                    pledge <span className="font-semibold">{money(bridgePledge.pledgeFund)}</span> (locked 4 yrs){' '}
                                    or show <span className="font-semibold">{money(bridgePledge.showFund)}</span> in funds.
                                </p>
                            )}
                        </div>
                    ) : !isIpa && opt.incomeEligibility != null && opt.incomeEligibility >= opt.ltvCeiling ? (
                        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 flex items-start gap-2">
                            <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-500" />
                            Income qualifies for the full {ltvPctLabel} loan — no pledge needed.
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    )
}

// ── Rate row for the embedded amortisation schedule ──────────────────────────

const rateRowInp = 'px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/10 bg-white transition-colors'

function RateRow({
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
                        className={`${rateRowInp} w-20`} />
                    <span className="text-xs text-slate-400">%</span>
                </div>
            ) : (
                <div className="flex items-center gap-1.5 flex-1 flex-wrap">
                    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs shrink-0">
                        {AMORT_RATE_REFS.map(r => (
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
                                className={`${rateRowInp} w-16`} />
                            <span className="text-xs text-slate-400">%</span>
                        </>
                    )}
                    <span className="text-xs text-slate-400">+</span>
                    <input type="number" step="0.01" value={entry.spread ?? ''} placeholder="0.35"
                        onChange={e => onChange({ spread: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                        className={`${rateRowInp} w-16`} />
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

function PayStructureLine({ children }: { children: ReactNode }) {
    return (
        <div className="flex items-start gap-2 text-[12px] text-slate-600 leading-snug">
            <span className="w-1 h-1 rounded-full bg-slate-400 shrink-0 mt-1.5" />
            <span>{children}</span>
        </div>
    )
}

function Blue({ children }: { children: ReactNode }) {
    return <span className="text-[#03a9e7] font-semibold">{children}</span>
}

function Row({ label, value, strong, muted, highlight }: { label: ReactNode; value: string; strong?: boolean; muted?: boolean; highlight?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-3 text-sm">
            <span className={`${muted ? 'text-slate-400' : highlight ? 'font-semibold text-[#052d4a]' : 'text-slate-600'} leading-tight`}>{label}</span>
            <span className={`shrink-0 ${strong ? 'text-base font-bold text-[#052d4a]' : muted ? 'text-slate-400' : highlight ? 'font-bold text-[#052d4a]' : 'font-semibold text-slate-800'}`}>{value}</span>
        </div>
    )
}

function Tip({ children }: { children: ReactNode }) {
    return (
        <p className="text-[12px] text-slate-500 flex items-start gap-1.5 leading-relaxed">
            <Info size={12} className="shrink-0 mt-0.5 text-[#03a9e7]" />
            <span>{children}</span>
        </p>
    )
}

function TipGroup({ children }: { children: ReactNode }) {
    return <div className="space-y-1.5 mt-1">{children}</div>
}

// ─── Next step ────────────────────────────────────────────────────────────────

interface NextStepProps {
    actions: string[]
    actionsDone: string[]
    onToggleAction: (a: string) => void
    onPresent: () => void
    onOpenProposal: () => void
    clientEmail?: string
    onSendReport: () => void
    sendingReport: boolean
    reportSent: boolean
    reportError: string | null
}

function NextStepCard({
    actions, actionsDone, onToggleAction, onPresent, onOpenProposal,
    clientEmail, onSendReport, sendingReport, reportSent, reportError,
}: NextStepProps) {
    return (
        <div className="rounded-xl border-2 border-[#052d4a]/15 bg-gradient-to-b from-slate-50 to-white p-5 space-y-4">
            <p className="text-sm font-bold text-[#052d4a] flex items-center gap-2">
                <ArrowRight size={16} className="text-[#03a9e7]" /> Next step
            </p>

            {/* Primary actions — client-facing deliverables */}
            <div className="flex flex-wrap gap-2.5">
                <button type="button" onClick={onPresent}
                    className="btn-primary text-sm px-4 py-2 flex items-center gap-2">
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
            </div>
            {reportError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{reportError}</p>
            )}

            {/* Checklist — what the CLIENT should do next */}
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
                                    <button type="button" onClick={() => onToggleAction(a)}
                                        className="flex items-start gap-2.5 text-left w-full group">
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
