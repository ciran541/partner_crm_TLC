'use client'

import { ReactNode, useMemo, useState } from 'react'
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
} from '@/lib/insurance/purchaseCalc'
import { buildRemarks, nextActions, OTP_NOT_OBTAINED_REMARK, type PurchaseRemarks } from '@/lib/insurance/purchaseRemarks'
import { buildProposalText, type ProposalPackage } from '@/lib/insurance/purchaseProposal'
import { Question, FieldInput } from '@/components/insurance/workflow/WorkflowStep'
import Modal from '@/components/shared/Modal'
import type { PurchaseRecommendation } from '@/lib/insurance/purchaseRecommend'
import type { SoraRates } from '@/lib/insurance/sora'
import PurchasePackages from './PurchasePackages'
import PurchasePresentation from './PurchasePresentation'
import {
    Home, CheckCircle2, AlertTriangle, Info, Lightbulb, Save, FileText, Wallet,
    ArrowRight, ClipboardList, Copy, Printer, Circle,
    Presentation, MessageSquare,
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

    const meta = propertyMeta(data.property_type)
    const computation = useMemo(() => computePurchase(inputsFromWorkflow(data)), [data])
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
                sora_as_of: sora?.published_date ?? sora?.value_date ?? null,
                frozen_at: new Date().toISOString(),
            },
        })
    }

    const otpDateFields = otpFieldsFor(data.property_type)
    const selectedPkgId = (data.selected_package_snapshot?.id as string) ?? undefined

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
            </Section>

            {/* OTP */}
            {data.property_type && (
                <Section title="OTP from seller / developer" icon={<FileText size={15} />}>
                    <Question label="Have you obtained the OTP from seller/developer?" required>
                        <YesNo value={data.otp_obtained} onChange={v => update({ otp_obtained: v })} />
                    </Question>
                    {data.otp_obtained && otpDateFields.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-1">
                            {otpDateFields.map(f => (
                                <Question key={f.key} label={f.label}>
                                    <FieldInput type={f.type} value={(data.otp_dates?.[f.key] as string) ?? ''}
                                        onChange={v => update({ otp_dates: { ...data.otp_dates, [f.key]: v } })} />
                                </Question>
                            ))}
                        </div>
                    )}
                    {data.otp_obtained === false && (
                        <Question label="Roughly when do you intend to buy?">
                            <FieldInput type="date" value={data.intended_buy_date ?? ''}
                                onChange={v => update({ intended_buy_date: v })} />
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
                    {data.ipa_done && (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <Question label="Which bank?">
                                    <FieldInput value={data.ipa?.bank ?? ''} placeholder="e.g. DBS"
                                        onChange={v => update({ ipa: { ...data.ipa, bank: v } })} />
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
                                        onChange={v => update({ ipa: { ...data.ipa, tenure: num(v) } })} />
                                </Question>
                            </div>
                            <Question label="Tenure capped at age">
                                <PillSelect
                                    value={data.ipa?.age_cap ? String(data.ipa.age_cap) : undefined}
                                    onChange={v => update({ ipa: { ...data.ipa, age_cap: Number(v) as 65 | 75 } })}
                                    options={[{ value: '65', label: '65 (Option 1)' }, { value: '75', label: '75 (Option 2)' }]}
                                />
                            </Question>
                            <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
                                <Info size={12} className="mt-0.5 shrink-0" />
                                Income questions are skipped — results use the IPA amount and tenure, and show only the option matching the chosen age cap.
                            </p>
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

            {/* Income (only when no IPA) */}
            {data.property_type && data.ipa_done === false && (
                <Section title="Borrower Income" icon={<Wallet size={15} />}>
                    <Question label="Number of borrowers">
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
                        <div key={i} className="rounded-lg border border-slate-200 p-4 space-y-4">
                            <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                                {borrowers.length === 1 ? 'Borrower' : `Borrower ${i + 1}`}
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
                                <Question label={b.employment === 'self_employed' ? 'Annual Income (NOA)' : 'Annual Bonus / Variable Income'}>
                                    <FieldInput commas prefix="$" value={b.annual_variable ?? ''}
                                        onChange={v => updateBorrower(i, { annual_variable: num(v) })} />
                                </Question>
                                <Question label="Age">
                                    <FieldInput type="number" value={b.age ?? ''}
                                        onChange={v => updateBorrower(i, { age: num(v) })} />
                                </Question>
                                <Question label="Monthly Commitments">
                                    <FieldInput commas prefix="$" value={b.commitments ?? ''}
                                        onChange={v => updateBorrower(i, { commitments: num(v) })} />
                                </Question>
                            </div>
                        </div>
                    ))}
                </Section>
            )}

            {/* ── RESULTS ── */}
            {computation.ready ? (
                <>
                    <div className={`grid gap-4 ${computation.options.length > 1 ? 'md:grid-cols-2' : 'md:grid-cols-1'}`}>
                        {computation.options.map(opt => (
                            <OptionCard key={opt.key} opt={opt} ipa={!!data.ipa_done} price={data.property_price ?? 0} />
                        ))}
                    </div>

                    {/* Editable rate behind the Monthly Installment estimate */}
                    <div className="flex items-center gap-2 text-xs text-slate-500 px-1">
                        <span>Monthly instalment estimated at</span>
                        <input type="number" step="0.05" value={data.reference_rate ?? ''} placeholder={`${DEFAULT_REFERENCE_RATE}`}
                            onChange={e => update({ reference_rate: num(e.target.value) })}
                            className="w-16 px-2 py-1 rounded-md border border-slate-200 bg-white text-center font-medium text-slate-700 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12" />
                        <span>% p.a. — adjust to compare</span>
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
                    </Section>

                    {/* Total Liquidity Required */}
                    <LiquidityCard
                        options={computation.options}
                        miscFees={computation.bsd + computation.absd + computation.legalFee + computation.valuationFee}
                        price={data.property_price ?? 0}
                    />

                    {/* Remarks */}
                    <RemarksCard remarks={remarks} />

                    {/* OTP not obtained — shown just above the rate packages */}
                    {data.otp_obtained === false && (
                        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                            <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-[13px] text-amber-800 leading-relaxed">{OTP_NOT_OBTAINED_REMARK}</p>
                        </div>
                    )}

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
                            onSelect={onSelectPackage}
                        />
                    )}

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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
            <p className="text-[11px] text-slate-500 leading-tight">{label}</p>
            <p className="text-sm font-bold text-[#052d4a] mt-0.5">{value}</p>
            {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
        </div>
    )
}

function LiquidityCard({ options, miscFees, price }: { options: OptionResult[]; miscFees: number; price: number }) {
    if (!options.length || price <= 0) return null
    return (
        <Section title="Total Liquidity Required" icon={<Wallet size={15} />}>
            <p className="text-[11px] text-slate-400 -mt-1">
                Misc fees (BSD + ABSD + legal + valuation) = {money(miscFees)}
            </p>
            <div className={`grid gap-4 ${options.length > 1 ? 'md:grid-cols-2' : ''}`}>
                {options.map(opt => {
                    const matrixCashCpfPct = 1 - opt.ltvPct - opt.minCashPct
                    const matrixCashCpfDown = price * matrixCashCpfPct
                    const s1Total = opt.minCashDown + opt.cashCpfDown + miscFees
                    const s2Total = opt.pledge ? opt.pledge.pledgeFund + opt.minCashDown + matrixCashCpfDown + miscFees : null
                    const s3Total = opt.pledge ? opt.pledge.showFund + opt.minCashDown + matrixCashCpfDown + miscFees : null
                    return (
                        <div key={opt.key} className={`rounded-lg border p-4 space-y-3 ${opt.key === '1' ? 'border-sky-200 bg-sky-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                            <p className="text-xs font-bold text-[#052d4a]">Option {opt.key} — {pct(opt.ltvPct)} LTV</p>

                            <div className="space-y-1.5">
                                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">S1 — Without pledging / showing</p>
                                <Row label={<>Min Cash <span className="text-[#03a9e7]">({pct(opt.minCashPct)})</span></>} value={money(opt.minCashDown)} />
                                <Row label={<>Balance Cash / CPF <span className="text-[#03a9e7]">({pct(opt.cashCpfPct)})</span></>} value={money(opt.cashCpfDown)} />
                                <Row label="Misc Fees" value={money(miscFees)} muted />
                                <div className="border-t border-dashed border-slate-200 pt-1.5">
                                    <Row label="Total Required" value={money(s1Total)} strong />
                                </div>
                            </div>

                            {opt.pledge && s2Total !== null && s3Total !== null && (
                                <>
                                    <div className="border-t border-slate-200 pt-3 space-y-1.5">
                                        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">S2 — With pledging</p>
                                        <Row label="Pledged Funds (locked 4 yrs)" value={money(opt.pledge.pledgeFund)} />
                                        <Row label={<>Min Cash <span className="text-[#03a9e7]">({pct(opt.minCashPct)})</span></>} value={money(opt.minCashDown)} />
                                        <Row label={<>Cash / CPF <span className="text-[#03a9e7]">({pct(matrixCashCpfPct)})</span></>} value={money(matrixCashCpfDown)} />
                                        <Row label="Misc Fees" value={money(miscFees)} muted />
                                        <div className="border-t border-dashed border-slate-200 pt-1.5">
                                            <Row label="Total Required" value={money(s2Total)} strong />
                                        </div>
                                    </div>

                                    <div className="border-t border-slate-200 pt-3 space-y-1.5">
                                        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">S3 — With show funds</p>
                                        <Row label="Show Funds (unlocked)" value={money(opt.pledge.showFund)} />
                                        <Row label={<>Min Cash <span className="text-[#03a9e7]">({pct(opt.minCashPct)})</span></>} value={money(opt.minCashDown)} />
                                        <Row label={<>Cash / CPF <span className="text-[#03a9e7]">({pct(matrixCashCpfPct)})</span></>} value={money(matrixCashCpfDown)} />
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

function OptionCard({ opt, ipa, price }: { opt: OptionResult; ipa: boolean; price: number }) {
    const isOpt1 = opt.key === '1'
    // Use the actual LTV% of the real loan so all three rows add to 100%
    const actualLtvPct = price > 0 ? opt.finalLoan / price : opt.ltvPct
    return (
        <div className={`rounded-xl border-2 overflow-hidden ${isOpt1 ? 'border-[#03a9e7]/40' : 'border-slate-200'}`}>
            <div className={`px-4 py-3 ${isOpt1 ? 'bg-sky-50' : 'bg-slate-50'}`}>
                <p className="text-sm font-bold text-[#052d4a]">
                    Option {opt.key} — {pct(opt.ltvPct)} LTV
                    {opt.ltvCeiling > 0 && (
                        <span className="ml-2 text-[#03a9e7]">· max {money(opt.ltvCeiling)}</span>
                    )}
                </p>
                <p className="text-[11px] text-slate-500">
                    Tenure up to age {opt.ageCap} · max {opt.tenure} yrs at this rate
                </p>
            </div>
            <div className="p-4 space-y-2.5">
                {price > 0 && <Row label="Property Price" value={money(price)} />}
                <Row label={<>Maximum Bank Loan <span className="text-[#03a9e7] font-semibold">({pct(actualLtvPct)} LTV)</span></>} value={money(opt.finalLoan)} strong />
                <Row label="Loan Tenure" value={`${opt.tenure} years`} />
                <Row label="Monthly Installment" value={money(opt.installment)} />
                {!ipa && opt.incomeEligibility != null && (
                    <Row label="Income-based Eligibility" value={money(opt.incomeEligibility)} muted />
                )}
                <div className="border-t border-slate-100 pt-2.5 space-y-2.5">
                    <Row label={<>Minimum Cash Downpayment <span className="text-[#03a9e7] font-semibold">({pct(opt.minCashPct)})</span></>} value={money(opt.minCashDown)} />
                    <Row label={<>Balance Cash / CPF Downpayment <span className="text-[#03a9e7] font-semibold">({pct(opt.cashCpfPct)})</span></>} value={money(opt.cashCpfDown)} />
                </div>
                {opt.pledge && (
                    <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 space-y-1">
                        <p className="font-semibold flex items-center gap-1.5"><AlertTriangle size={13} /> Loan shortfall: {money(opt.pledge.shortfall)}</p>
                        <p>To reach the full {pct(opt.ltvPct)}, either pledge <span className="font-semibold">{money(opt.pledge.pledgeFund)}</span> (locked 4 yrs) or show <span className="font-semibold">{money(opt.pledge.showFund)}</span> in funds.</p>
                    </div>
                )}
                {!opt.pledge && !ipa && opt.incomeEligibility != null && opt.incomeEligibility >= opt.ltvCeiling && (
                    <div className="mt-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 flex items-start gap-2">
                        <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                        Income qualifies for the full {pct(opt.ltvPct)} loan — no pledge needed.
                    </div>
                )}
            </div>
        </div>
    )
}

function Row({ label, value, strong, muted }: { label: ReactNode; value: string; strong?: boolean; muted?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-3 text-sm">
            <span className={`${muted ? 'text-slate-400' : 'text-slate-600'} leading-tight`}>{label}</span>
            <span className={`shrink-0 ${strong ? 'text-base font-bold text-[#052d4a]' : muted ? 'text-slate-400' : 'font-semibold text-slate-800'}`}>{value}</span>
        </div>
    )
}

function RemarksCard({ remarks }: { remarks: PurchaseRemarks }) {
    const all = [...remarks.standard, ...remarks.propertyType]
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
