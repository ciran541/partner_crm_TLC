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
import { Question, FieldInput } from '@/components/insurance/workflow/WorkflowStep'
import Modal from '@/components/shared/Modal'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import type { PurchaseRecommendation } from '@/lib/insurance/purchaseRecommend'
import type { SoraRates } from '@/lib/insurance/sora'
import PurchasePackages from './PurchasePackages'
import PurchasePresentation from './PurchasePresentation'
import {
    Home, CheckCircle2, AlertTriangle, Info, Save, FileText, Wallet, XCircle,
    ArrowRight, ClipboardList, Copy, Printer, Circle,
    Presentation, MessageSquare, Users,
} from 'lucide-react'

interface Props {
    data: PurchaseWorkflow
    onChange: (updated: PurchaseWorkflow) => void
    clientName?: string
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
    data, onChange, clientName, embedded, saving, saved, hasClientName, onContinue,
}: Props) {
    const update = (patch: Partial<PurchaseWorkflow>) => onChange({ ...data, ...patch })
    const [proposalOpen, setProposalOpen] = useState(false)
    const [presentationOpen, setPresentationOpen] = useState(false)
    const [rawPrefTenure, setRawPrefTenure] = useState('')
    const [liquidityOption, setLiquidityOption] = useState<'1' | '2'>('1')
    const [preferredTenure2, setPreferredTenure2] = useState<number | undefined>()
    const [rawPrefTenure2, setRawPrefTenure2] = useState('')
    const [adjustedLoans, setAdjustedLoans] = useState<Record<string, number | undefined>>({})

    const meta = propertyMeta(data.property_type)
    const computation = useMemo(() => computePurchase(inputsFromWorkflow(data)), [data])

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
                        options={PURCHASE_PROPERTY_TYPES.map(p => ({ value: p.value, label: p.label }))}
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

                    {/* Marriage question — only relevant for joint purchases; affects ABSD */}
                    {borrowers.length > 1 && (
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
                                        placeholder="5–35"
                                        onChange={v => update({ ipa: { ...data.ipa, tenure: num(v) } })}
                                        onBlur={() => {
                                            const n = data.ipa?.tenure
                                            if (n != null) update({ ipa: { ...data.ipa, tenure: Math.min(35, Math.max(5, n)) } })
                                        }} />
                                </Question>
                            </div>
                            <Question label="Tenure capped at age">
                                <PillSelect
                                    value={data.ipa?.age_cap ? String(data.ipa.age_cap) : undefined}
                                    onChange={v => update({ ipa: { ...data.ipa, age_cap: Number(v) as 65 | 75 } })}
                                    options={[{ value: '65', label: '65 (Option 1)' }, { value: '75', label: '75 (Option 2)' }]}
                                />
                            </Question>
                            {/* Reverse-engineered alternative option — derived from IPA data alone, no income entry needed */}
                            {data.property_price && data.ipa?.amount && data.ipa?.tenure && data.ipa?.age_cap && (() => {
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
                                                update({ ipa: { ...data.ipa, age_cap: altOpt.ageCap as 65 | 75, tenure: altTenure, amount: Math.round(altMaxFromTdsr) } })
                                            }}
                                            className="mt-0.5 text-[11px] font-semibold text-[#03a9e7] hover:text-[#0290c5] underline underline-offset-2"
                                        >
                                            Use this instead →
                                        </button>
                                    </div>
                                )
                            })()}
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
                                        onChange={v => updateBorrower(i, { age: num(v) })} />
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
                                    price={data.property_price ?? 0}
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
                        price={data.property_price ?? 0}
                        adjustedLoans={adjustedLoans}
                        rule={meta?.rule ?? 'tdsr'}
                    />

                    {/* Rate preference — just above the package list */}
                    <Section title="Rate Preference" icon={<Info size={15} />}>
                        {meta && !meta.buc ? (
                            <Question label="Do you prefer fixed or floating rates?">
                                <PillSelect
                                    value={data.rate_preference ?? 'either'}
                                    onChange={v => update({ rate_preference: v as 'fixed' | 'floating' | 'either' })}
                                    options={[
                                        { value: 'either', label: 'Both' },
                                        { value: 'fixed', label: 'Fixed' },
                                        { value: 'floating', label: 'Floating' },
                                    ]}
                                />
                            </Question>
                        ) : (
                            <p className="text-[12px] text-slate-500 flex items-start gap-1.5">
                                <Info size={13} className="mt-0.5 shrink-0 text-[#03a9e7]" />
                                Only floating rates are available until TOP — package suggestions are floating-only.
                            </p>
                        )}
                        <Tip>Interest rates can only be secured once the OTP from the seller has been obtained.</Tip>
                    </Section>

                    {/* Packages */}
                    {computation.options[0]?.finalLoan > 0 && (
                        <PurchasePackages
                            loan={computation.options[0].finalLoan}
                            tenureYears={computation.options[0].tenure}
                            propertyType={ratesPropertyType(data.property_type)}
                            bucOnly={!!meta?.buc}
                            preference={meta?.buc ? 'floating' : (data.rate_preference ?? 'either')}
                            selectedId={selectedPkgId}
                            excludeBank={data.ipa_done && data.ipa?.bank ? data.ipa.bank : undefined}
                            onSelect={onSelectPackage}
                        />
                    )}

                    {/* Monthly Instalment — tenure comparison tool */}
                    {(() => {
                        const selectedOpt = computation.options.find(o => o.key === liquidityOption) ?? computation.options[0]
                        if (!selectedOpt) return null
                        const rate = (pkg?.avg_rate_lockin_pct as number | undefined) ?? data.reference_rate ?? DEFAULT_REFERENCE_RATE
                        const t1 = data.preferred_tenure ?? selectedOpt.maxTenure
                        const t2 = preferredTenure2 ?? selectedOpt.maxTenure
                        const adjLoan = adjustedLoans[selectedOpt.key]
                        const fieldPlaceholder = selectedOpt.source === 'ipa' ? selectedOpt.ltvCeiling : selectedOpt.finalLoan
                        const loan = adjLoan ?? fieldPlaceholder
                        const lockinYears = pkg?.lockin_years as number | undefined
                        const m1 = monthlyInstallment(loan, rate, t1)
                        const m2 = monthlyInstallment(loan, rate, t2)
                        const i1 = lockinYears != null
                            ? interestOverPeriod(loan, rate, t1, lockinYears)
                            : Math.max(0, m1 * t1 * 12 - loan)
                        const i2 = lockinYears != null
                            ? interestOverPeriod(loan, rate, t2, lockinYears)
                            : Math.max(0, m2 * t2 * 12 - loan)
                        const inputCls = 'w-20 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12'
                        return (
                            <Section title="Monthly Instalment" icon={<Wallet size={15} />}>
                                {/* Rate source */}
                                {pkg?.avg_rate_lockin_pct != null ? (
                                    <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                                        <Info size={12} className="text-[#03a9e7]" />
                                        Based on <span className="font-semibold">{String(pkg.bank)}</span> @ {Number(pkg.avg_rate_lockin_pct).toFixed(2)}% avg lock-in rate
                                    </p>
                                ) : (
                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                        <span>No package selected — estimating at</span>
                                        <input type="number" step="0.05" value={data.reference_rate ?? ''} placeholder={`${DEFAULT_REFERENCE_RATE}`}
                                            onChange={e => update({ reference_rate: num(e.target.value) })}
                                            className="w-16 px-2 py-1 rounded-md border border-slate-200 bg-white text-center font-medium text-slate-700 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12" />
                                        <span>% p.a.</span>
                                    </div>
                                )}

                                {/* Tenure range header */}
                                <p className="text-xs text-slate-600">
                                    Tenure Range based off Option {selectedOpt.key}:{' '}
                                    <span className="font-semibold">5 – {selectedOpt.maxTenure} yrs</span>
                                </p>

                                {/* Two tenure inputs */}
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
                                    <div>
                                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Preferred Tenure 2</p>
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
                                    </div>
                                </div>

                                {/* Comparison table */}
                                <div className="rounded-lg border border-slate-200 overflow-hidden text-sm">
                                    <div className="grid grid-cols-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-50 border-b border-slate-200">
                                        <div className="px-3 py-2">Option {selectedOpt.key}</div>
                                        <div className="px-3 py-2 text-right border-l border-slate-200">Tenure 1 ({t1} yrs)</div>
                                        <div className="px-3 py-2 text-right border-l border-slate-200">Tenure 2 ({t2} yrs)</div>
                                    </div>
                                    <div className="grid grid-cols-3 border-b border-slate-100">
                                        <div className="px-3 py-2.5 text-slate-500">Monthly Instalment</div>
                                        <div className="px-3 py-2.5 text-right font-semibold text-[#052d4a] border-l border-slate-100">{money(m1)}<span className="text-slate-400 font-normal">/mo</span></div>
                                        <div className="px-3 py-2.5 text-right font-semibold text-[#052d4a] border-l border-slate-100">
                                            {money(m2)}<span className="text-slate-400 font-normal">/mo</span>
                                            {t1 !== t2 && <span className={`ml-1.5 text-[11px] font-semibold ${m2 < m1 ? 'text-emerald-600' : 'text-red-500'}`}>{m2 < m1 ? '↓' : '↑'}{money(Math.abs(m2 - m1))}</span>}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3">
                                        <div className="px-3 py-2.5 text-slate-500">
                                            {lockinYears != null ? `Interest (${lockinYears}-yr lock-in)` : 'Total Interest'}
                                        </div>
                                        <div className="px-3 py-2.5 text-right font-semibold text-slate-700 border-l border-slate-100">{money(i1)}</div>
                                        <div className="px-3 py-2.5 text-right font-semibold text-slate-700 border-l border-slate-100">
                                            {money(i2)}
                                            {t1 !== t2 && <span className={`ml-1.5 text-[11px] font-semibold ${i2 < i1 ? 'text-emerald-600' : 'text-red-500'}`}>{i2 < i1 ? '↓' : '↑'}{money(Math.abs(i2 - i1))}</span>}
                                        </div>
                                    </div>
                                </div>
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

    // Default breakdown to full LTV ceiling so client sees the best-case upfront.
    // For IPA path the ceiling is the max loan (75%/55%); for income path it's the income-eligible loan.
    const fieldPlaceholder = opt.source === 'ipa' ? opt.ltvCeiling : opt.finalLoan
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
}

function NextStepCard({
    actions, actionsDone, onToggleAction, onPresent, onOpenProposal,
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
            </div>

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
