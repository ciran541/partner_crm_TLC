'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
    computeDecouple,
    inputsFromDecoupleWorkflow,
    DEFAULT_REFERENCE_RATE,
    MIN_TENURE,
    AGE_CAP_REFI,
    AGE_CAP_PURCHASE,
    SUBSIDY_PRESETS,
    DECOUPLE_PROPERTY_TYPES,
} from '@/lib/insurance/decoupleCalc'
import type { DecoupleWorkflow, DecoupleBorrower } from '@/lib/types/workflow'
import type { DecouplePledge } from '@/lib/insurance/decoupleCalc'
import { maxLoanFromPayment, monthlyInstallment, tdsrAvailable, STRESS_TEST_RATE } from '@/lib/insurance/loanCalc'
import { computeAmortization } from '@/lib/insurance/amortCalc'
import { type RecommendedPackage } from '@/lib/insurance/rateRecommend'
import { type SoraRates } from '@/lib/insurance/sora'
import { type RateScheduleEntry } from '@/lib/types/rates'
import RefiPackages from './RefiPackages'
import { Question, FieldInput } from '@/components/insurance/workflow/WorkflowStep'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import {
    Home, CheckCircle2, AlertTriangle, Info, Save,
    ArrowRight, ExternalLink, Users, Building2, Percent,
    Wallet, CalendarRange, Lock, Plus, Trash2,
} from 'lucide-react'

interface Props {
    data: DecoupleWorkflow
    onChange: (updated: DecoupleWorkflow) => void
    clientName?: string
    embedded?: boolean
    saving?: boolean
    saved?: boolean
    hasClientName?: boolean
    onContinue?: () => void
}

const money = (n: number) => {
    const r = Math.round(n)
    return r < 0 ? `-$${(-r).toLocaleString()}` : `$${r.toLocaleString()}`
}
const pct = (frac: number, dp = 1) => `${(frac * 100).toFixed(dp)}%`
const num = (v: string | number) => {
    const s = String(v).trim()
    if (s === '') return undefined
    const n = parseFloat(s.replace(/,/g, ''))
    return isNaN(n) ? undefined : n
}

export default function DecouplingWorkflowPanel({
    data, onChange, clientName, embedded, saving, saved, hasClientName, onContinue,
}: Props) {
    const update = (patch: Partial<DecoupleWorkflow>) => onChange({ ...data, ...patch })
    const [customSubsidy, setCustomSubsidy] = useState(
        data.subsidy_return_amount != null && !SUBSIDY_PRESETS.includes(String(data.subsidy_return_amount)),
    )
    const [loanDraft, setLoanDraft] = useState<string | null>(null)
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

    const computation = useMemo(() => computeDecouple(inputsFromDecoupleWorkflow(data)), [data])
    const { scenario } = computation

    const sellerPct = 100 - (data.buyer_share ?? 50)
    const buyerPctStr = `${data.buyer_share ?? ''}%`
    const sellerPctStr = `${sellerPct}%`

    // Single borrower only
    const defaultBorrower: DecoupleBorrower = { employment: 'employed' }
    const borrowers = data.borrowers?.length ? [data.borrowers[0]] : [defaultBorrower]
    const updateBorrower = (patch: Partial<DecoupleBorrower>) => {
        update({ borrowers: [{ ...borrowers[0], ...patch }] })
    }

    const showIncome = scenario !== null && scenario !== 'S4'
    const showTdsr = showIncome && computation.grossMonthlyIncome > 0

    // Est. Loan Eligibility — local tenure exploration, top of TDSR Assessment card
    const [estEligTenure, setEstEligTenure] = useState<number | undefined>(undefined)
    const [estEligDraft, setEstEligDraft] = useState<string>('')
    React.useEffect(() => { setEstEligTenure(undefined); setEstEligDraft('') }, [scenario])
    const effectiveEstEligTenure = estEligTenure ?? 35
    const estEligLoan = computation.availableTdsr > 0 && effectiveEstEligTenure > 0
        ? maxLoanFromPayment(computation.availableTdsr, STRESS_TEST_RATE * 100, effectiveEstEligTenure)
        : 0

    // Rate Preference + Packages + Tenure Comparison
    const selectedPkgId = (data.selected_package_snapshot?.id as string) ?? undefined
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
                frozen_at: new Date().toISOString(),
                sora_as_of: sora?.published_date ?? sora?.value_date ?? null,
            },
        })
    }
    // Loan + tenure to price packages against (scenario-dependent)
    const pkgLoan = scenario === 'S1' ? computation.buyerLoanLiability : computation.bankLoan75
    const pkgTenureMin = scenario === 'S1' ? computation.refiTenureMin : computation.purchaseTenureMin
    const pkgTenure = scenario === 'S1' ? computation.refiTenureMax : computation.purchaseTenureMax
    const pkgPropertyType: 'landed' | 'private_condo' = data.property_type === 'landed' ? 'landed' : 'private_condo'
    const pkgIncludeBuc = data.property_type === 'incompleted_condo'
    // Rate source for tenure comparison (mirrors refi pattern)
    const snapshotRate = data.selected_package_snapshot?.avg_rate_lockin_pct as number | undefined
    const compRate: number | null = snapshotRate ?? data.current_rate ?? null
    const compRateLabel: string | null = snapshotRate != null
        ? `${(data.selected_package_snapshot?.bank as string | undefined) ?? 'selected package'} @ ${snapshotRate.toFixed(2)}% avg lock-in`
        : data.current_rate != null ? `current rate ${data.current_rate}% p.a.` : null
    const compLockinYears: number = ((data.selected_package_snapshot?.lockin_years as number | undefined) ?? 2) || 1

    // Rate schedule for amortisation (package wins over manual)
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

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-lg font-bold text-[#052d4a] flex items-center gap-2">
                        <Building2 size={18} className="text-[#03a9e7]" /> Decoupling — Advisory
                    </h2>
                    <p className="text-sm text-slate-500">
                        {clientName ? <>Advising <span className="font-medium text-slate-700">{clientName}</span>. </> : null}
                        Capture property and ownership details — results update live.
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

            {/* ── 1. PROPERTY DETAILS ── */}
            <Section title="Property Details" icon={<Home size={15} />}>
                <Question label="Property Type" required>
                    <PillSelect
                        value={data.property_type}
                        onChange={v => update({ property_type: v as DecoupleWorkflow['property_type'] })}
                        options={DECOUPLE_PROPERTY_TYPES.map(t => ({ value: t.value, label: t.label }))}
                    />
                </Question>

                <Question label="Property Valuation" required>
                    <FieldInput commas prefix="$" value={data.property_valuation ?? ''} placeholder="e.g. 1,500,000"
                        onChange={v => update({ property_valuation: num(v) })} />
                </Question>

                <Question label="Year of Purchase" required>
                    <FieldInput type="number" value={data.year_of_purchase ?? ''} placeholder="e.g. 2022"
                        onChange={v => update({ year_of_purchase: num(v) })} />
                    <p className="text-[11px] text-slate-400 flex items-start gap-1.5 mt-1">
                        <Info size={11} className="mt-0.5 shrink-0" />
                        For exact SSD, check{' '}
                        <a href="https://www.iras.gov.sg/taxes/stamp-duty/for-property/selling-or-disposing-property/seller's-stamp-duty-(ssd)-for-residential-property"
                            target="_blank" rel="noopener noreferrer"
                            className="text-[#03a9e7] underline inline-flex items-center gap-0.5">
                            IRAS <ExternalLink size={10} />
                        </a>
                    </p>
                </Question>

                <Question label="Property Use" required>
                    <PillSelect
                        value={data.property_use}
                        onChange={v => update({ property_use: v as DecoupleWorkflow['property_use'] })}
                        options={[
                            { value: 'own_stay', label: 'Own-Stay' },
                            { value: 'investment', label: 'Investment' },
                        ]}
                    />
                </Question>
            </Section>

            {/* ── 2. OWNERSHIP ── */}
            <Section title="Ownership" icon={<Users size={15} />}>
                <div className="grid grid-cols-2 gap-4">
                    <Question label="Buyer's Share (%)" required>
                        <FieldInput type="number" value={data.buyer_share ?? ''} placeholder="e.g. 50"
                            onChange={v => {
                                const n = num(v)
                                if (n === undefined) { update({ buyer_share: undefined }); return }
                                update({ buyer_share: Math.max(1, Math.min(99, Math.round(n))) })
                            }} />
                    </Question>
                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">
                            Seller's Share (auto)
                        </label>
                        <div className="px-3 py-2.5 text-sm rounded-lg border border-slate-100 bg-slate-50 font-semibold text-slate-500">
                            {data.buyer_share ? `${sellerPct}%` : '—'}
                        </div>
                    </div>
                </div>
                {data.buyer_share && (
                    <p className="text-[11px] text-slate-400">
                        Buyer currently holds <span className="font-semibold text-slate-600">{buyerPctStr}</span>.
                        They will acquire seller's <span className="font-semibold text-slate-600">{sellerPctStr}</span> share to become sole owner.
                    </p>
                )}

                <Question label="Residency" required>
                    <PillSelect
                        value={data.residency}
                        onChange={v => update({ residency: v as DecoupleWorkflow['residency'] })}
                        options={[
                            { value: 'singaporean', label: 'Singapore Citizen' },
                            { value: 'pr', label: 'PR' },
                            { value: 'foreigner', label: 'Foreigner' },
                        ]}
                    />
                </Question>

                <Question label="Does the buyer require financing for the part-purchase?" required>
                    <YesNo value={data.requires_financing} onChange={v => update({ requires_financing: v })} />
                    {data.requires_financing === false && (
                        <p className="text-[11px] text-slate-400 flex items-start gap-1.5 mt-1">
                            <Info size={11} className="mt-0.5 shrink-0" />
                            Buyer pays for seller's share in cash / CPF only. Existing loan is refinanced in buyer's name.
                        </p>
                    )}
                    {data.requires_financing === true && (
                        <p className="text-[11px] text-slate-400 flex items-start gap-1.5 mt-1">
                            <Info size={11} className="mt-0.5 shrink-0" />
                            Buyer takes a new 75% LTV loan on the seller's share, on top of existing loan liability.
                        </p>
                    )}
                </Question>

                {/* Scenario badge */}
                {scenario && (
                    <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2.5 flex items-center gap-2">
                        <Info size={13} className="text-[#03a9e7] shrink-0" />
                        <p className="text-[12px] text-slate-600">
                            <span className="font-bold text-[#052d4a]">{scenario}:&nbsp;</span>
                            {scenario === 'S1' && 'No new financing · Has outstanding mortgage — refi TDSR only'}
                            {scenario === 'S2' && 'New financing · No outstanding mortgage — purchase TDSR only'}
                            {scenario === 'S3' && 'New financing · Has outstanding mortgage — refi + purchase TDSR'}
                            {scenario === 'S4' && 'No new financing · No outstanding mortgage — cash/CPF only, no TDSR'}
                        </p>
                    </div>
                )}
            </Section>

            {/* ── 3. CPF DETAILS ── */}
            <Section title="CPF Details" icon={<Percent size={15} />}>
                <Question label="Seller's CPF Usage on Property (Refund to OA)">
                    <FieldInput commas prefix="$" value={data.seller_cpf_usage ?? ''} placeholder="0"
                        onChange={v => update({ seller_cpf_usage: num(v) })} />
                </Question>
                <Question label="Buyer's CPF Used on Property (Existing)">
                    <FieldInput commas prefix="$" value={data.buyer_cpf_usage ?? ''} placeholder="0"
                        onChange={v => update({ buyer_cpf_usage: num(v) })} />
                </Question>
                <Question label="Buyer's CPF OA Balance (Available)">
                    <FieldInput commas prefix="$" value={data.buyer_cpf_oa_balance ?? ''} placeholder="0"
                        onChange={v => update({ buyer_cpf_oa_balance: num(v) })} />
                </Question>
            </Section>

            {/* ── 4. MORTGAGE DETAILS ── */}
            <Section title="Mortgage Details" icon={<Building2 size={15} />}>
                <Question label="Is the property fully paid?" required>
                    <YesNo value={data.fully_paid} onChange={v => update({ fully_paid: v })} />
                </Question>

                {data.fully_paid === false && (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Question label="Outstanding Home Loan">
                                <FieldInput commas prefix="$" value={data.outstanding_home_loan ?? ''}
                                    onChange={v => update({ outstanding_home_loan: num(v) })} />
                            </Question>
                            <Question label="Outstanding Equity Loan">
                                <FieldInput commas prefix="$" value={data.outstanding_equity_loan ?? ''}
                                    onChange={v => update({ outstanding_equity_loan: num(v) })} />
                            </Question>
                        </div>

                        {data.property_type === 'incompleted_condo' && (
                            <Question label="Outstanding Undisbursed Loan">
                                <FieldInput commas prefix="$" value={data.outstanding_undisbursed ?? ''}
                                    onChange={v => update({ outstanding_undisbursed: num(v) })} />
                                <p className="text-[11px] text-slate-400 flex items-start gap-1.5 mt-1">
                                    <Info size={11} className="mt-0.5 shrink-0" />
                                    Only applicable for Incompleted Condo that has not obtained CSC.
                                </p>
                                {(data.outstanding_undisbursed ?? 0) > 0 && (
                                    <p className="text-[11px] text-amber-600 mt-1 flex items-center gap-1.5">
                                        <AlertTriangle size={11} className="shrink-0" />
                                        Cancellation fee: {money((data.outstanding_undisbursed ?? 0) * 0.0075)} ({money(data.outstanding_undisbursed ?? 0)} × 0.75%)
                                    </p>
                                )}
                            </Question>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Question label="Current Bank">
                                <InsuranceBankDropdown
                                    value={data.current_bank ?? ''}
                                    onChange={v => update({ current_bank: v })}
                                    showHdb={false}
                                />
                            </Question>
                            <Question label="Home Loan — Remaining Tenure (years)">
                                <FieldInput type="number" value={data.current_tenure ?? ''}
                                    onChange={v => update({ current_tenure: num(v) })} />
                            </Question>
                            {(data.outstanding_equity_loan ?? 0) > 0 && (
                                <Question label="Equity Loan — Remaining Tenure (years)">
                                    <FieldInput type="number" value={data.current_tenure_equity_loan ?? ''}
                                        onChange={v => update({ current_tenure_equity_loan: num(v) })} />
                                </Question>
                            )}
                            <Question label="Lock-in End Date">
                                <FieldInput type="date" value={data.lockin_end_date ?? ''}
                                    onChange={v => update({ lockin_end_date: v })} />
                            </Question>
                            <Question label="Current Interest Rate (% p.a.)">
                                <FieldInput type="number" suffix="%" value={data.current_rate ?? ''}
                                    onChange={v => update({ current_rate: num(v) })} />
                            </Question>
                        </div>

                        <Question label="Subsidy / Clawback Amount">
                            <div className="flex flex-wrap gap-2 mb-2">
                                {SUBSIDY_PRESETS.map(p => (
                                    <button key={p} type="button"
                                        onClick={() => { setCustomSubsidy(false); update({ subsidy_return_amount: Number(p) }) }}
                                        className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${!customSubsidy && String(data.subsidy_return_amount ?? 0) === p
                                                ? 'bg-[#052d4a] border-[#052d4a] text-white'
                                                : 'bg-white border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7]'
                                            }`}>
                                        ${Number(p).toLocaleString()}
                                    </button>
                                ))}
                                <button type="button"
                                    onClick={() => setCustomSubsidy(true)}
                                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${customSubsidy
                                            ? 'bg-[#052d4a] border-[#052d4a] text-white'
                                            : 'bg-white border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7]'
                                        }`}>
                                    Custom
                                </button>
                            </div>
                            {customSubsidy && (
                                <FieldInput commas prefix="$" value={data.subsidy_return_amount ?? ''}
                                    onChange={v => update({ subsidy_return_amount: num(v) })} />
                            )}
                        </Question>
                    </>
                )}
            </Section>

            {/* ── 5. SELLER'S PERSPECTIVE ── */}
            {computation.ready && scenario !== null && (
                <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                    <div className="px-5 py-4 bg-slate-50 border-b border-slate-100">
                        <p className="text-sm font-bold text-[#052d4a]">Seller's Perspective</p>
                        <p className="text-xs text-slate-500 mt-0.5">Disposing {sellerPctStr} share</p>
                    </div>
                    <div className="px-5 py-5 space-y-5">
                        <div className="grid grid-cols-2 gap-3">
                            <Stat label={`Property Share (${sellerPctStr})`} value={money(computation.sellingPrice)} />
                            <Stat label={`Loan Liability Released (${sellerPctStr})`} value={money(computation.sellerLoanLiability)} />
                        </div>

                        <div className="border-t border-slate-100 pt-4 space-y-2">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Breakdown</p>
                            <Row label={`Sale of Part Share (${sellerPctStr})`} value={money(computation.sellingPrice)} highlight />
                            <Row label="Less: Loan Liability" value={`−${money(computation.sellerLoanLiability)}`} />
                            <Row label="Less: CPF Usage (Refund to OA)" value={`−${money(data.seller_cpf_usage ?? 0)}`} />
                            <div className="border-t border-slate-200 pt-2 mt-1">
                                <Row label="Cash Proceeds" value={money(computation.cashProceeds)}
                                    valueClass={computation.cashProceeds < 0 ? 'text-red-600' : 'text-emerald-700 font-bold'} />
                            </div>
                        </div>

                        <div className="border-t border-slate-100 pt-4 space-y-2">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Est. Misc Fees</p>
                            {computation.ssd > 0 ? (
                                <Row label={`Seller's Stamp Duty — ${computation.ssdRatePct}% (${computation.ssdRateTable === 'new' ? 'new' : 'old'} rates)`}
                                    value={money(computation.ssd)} />
                            ) : (
                                <Row label="Seller's Stamp Duty" value="$0"
                                    hint={computation.ssdRateTable === 'none' ? 'Past holding period' : 'No SSD at current holding period'} />
                            )}
                            <Row label="Legal Fee (Cash / CPF)" value={`${money(computation.sellerLegalFee)} +/-`} />
                            {computation.cancellationFee > 0 && (
                                <Row label="Cancellation Fee (0.75% of undisbursed)" value={money(computation.cancellationFee)} />
                            )}
                        </div>

                        {computation.cashProceeds < 0 && (
                            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                                <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
                                <p className="text-[13px] text-red-800 leading-relaxed">
                                    Cash proceeds are negative — seller may need to top up cash to complete the sale.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── 6. BREAKDOWN (Buyer's Perspective) ── */}
            {computation.ready && scenario !== null && (
                <div className="rounded-xl border border-[#03a9e7]/30 overflow-hidden shadow-sm">
                    <div className="px-5 py-4 bg-sky-50/70 border-b border-[#03a9e7]/15">
                        <p className="text-sm font-bold text-[#052d4a]">Buyer's Perspective</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Acquiring {sellerPctStr} share — property value {money(data.property_valuation ?? 0)}
                        </p>
                    </div>
                    <div className="px-5 py-5 space-y-5">
                        {/* Summary stats */}
                        <div className="grid grid-cols-2 gap-3">
                            <Stat label={`Property Share (${buyerPctStr})`} value={money(computation.purchasePrice)} />
                            <Stat label={`Loan Liability (${buyerPctStr} of Loan)`} value={money(computation.buyerLoanLiability)} />
                        </div>

                        {/* Breakdown */}
                        <div className="border-t border-slate-100 pt-4 space-y-2">
                            <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">Breakdown</p>
                            <Row label={`Purchase of Part Share (${sellerPctStr})`} value={money(computation.purchasePrice)} highlight />

                            {/* S1, S4 — no new financing */}
                            {(scenario === 'S1' || scenario === 'S4') && (
                                <>
                                    <Row label="Cash" value={money(computation.cashRequired)} />
                                    <Row label="CPF (as per CPF OA Balance)" value={money(computation.cpfUsedForPurchase)} />
                                    <div className="border-t border-dashed border-slate-200 my-1" />
                                    {scenario === 'S1' && (
                                        <>
                                            <Row label={`Refinanced Loan (${pct(computation.loanPct)} of Valuation)`} value={money(computation.loanForStructure)} />
                                            {computation.buyerLoanLiability > 0 && (
                                                <SubNote>Includes current loan liability of {money(computation.buyerLoanLiability)}</SubNote>
                                            )}
                                        </>
                                    )}
                                    <Row label={`Total CPF Used (${pct(computation.cpfPct)} of Valuation)`} value={money(computation.totalCpfUsed)} />
                                    <SubNote>Includes current CPF usage + CPF in OA balance</SubNote>
                                </>
                            )}

                            {/* S2, S3 — new financing */}
                            {(scenario === 'S2' || scenario === 'S3') && (() => {
                                const maxLoan = computation.purchasePrice * 0.75
                                const loanFrac = computation.purchasePrice > 0 ? computation.bankLoan75 / computation.purchasePrice : 0.75
                                const cpfFrac  = computation.purchasePrice > 0 ? computation.cpfCash20 / computation.purchasePrice : 0.20
                                const loanPctLabel = `${Math.round(loanFrac * 100)}%`
                                const cpfPctLabel  = `${Math.round(cpfFrac * 100)}%`
                                const displayLoan = loanDraft !== null
                                    ? loanDraft
                                    : (data.preferred_purchase_loan ?? Math.round(maxLoan)).toLocaleString()
                                return (
                                    <>
                                        <Row label="5% Cash (Minimum Cash)" value={money(computation.cash5)} />
                                        <Row label={`${cpfPctLabel} CPF / Cash`} value={money(computation.cpfCash20)} />
                                        <div className="flex items-center justify-between gap-4 py-1">
                                            <span className="text-sm text-slate-700">{loanPctLabel} Bank Loan (New)</span>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <span className="text-xs text-slate-400">$</span>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={displayLoan}
                                                    onFocus={() => setLoanDraft((data.preferred_purchase_loan ?? Math.round(maxLoan)).toString())}
                                                    onChange={e => setLoanDraft(e.target.value.replace(/[^0-9]/g, ''))}
                                                    onBlur={() => {
                                                        const n = loanDraft !== null ? parseInt(loanDraft, 10) : NaN
                                                        setLoanDraft(null)
                                                        update({ preferred_purchase_loan: isNaN(n) ? undefined : Math.max(100_000, Math.min(maxLoan, n)) })
                                                    }}
                                                    className="w-28 text-right text-sm font-semibold text-[#03a9e7] border border-[#03a9e7]/40 rounded-lg px-2 py-0.5 bg-sky-50/50 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 transition-all"
                                                />
                                            </div>
                                        </div>
                                        <div className="border-t border-dashed border-slate-200 my-1" />
                                        <Row label={`New Total Loan (${pct(computation.loanPct)} of Valuation)`} value={money(computation.loanForStructure)} />
                                        {computation.buyerLoanLiability > 0 && (
                                            <SubNote>Includes current loan liability of {money(computation.buyerLoanLiability)}</SubNote>
                                        )}
                                        <Row label={`Total CPF Used (${pct(computation.cpfPct)} of Valuation)`} value={money(computation.totalCpfUsed)} />
                                        <SubNote>Includes current CPF usage + CPF in OA balance</SubNote>
                                    </>
                                )
                            })()}
                        </div>

                        {/* Fees */}
                        <div className="border-t border-slate-100 pt-4 space-y-2">
                            <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">Est. Misc Fees</p>
                            <Row label="Buyer's Stamp Duty (BSD)" value={money(computation.bsd)} />
                            {computation.absd > 0 && (
                                <Row label={`ABSD (${computation.absdRatePct}%)`} value={money(computation.absd)} />
                            )}
                            <Row label="Legal Fee (Cash / CPF)" value={`${money(computation.buyerLegalFee)} +/-`} />
                        </div>

                        {/* Ownership bar */}
                        <div className="border-t border-slate-100 pt-4 space-y-3">
                            <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">Single Ownership Structure</p>
                            <OwnershipBar
                                loanPct={computation.loanPct}
                                cpfPct={computation.cpfPct}
                                cashPct={computation.cashPct}
                                loanAmt={computation.loanForStructure}
                                cpfAmt={computation.totalCpfUsed}
                                cashAmt={(data.property_valuation ?? 0) - computation.loanForStructure - computation.totalCpfUsed}
                            />
                            <p className="text-[11px] text-slate-400">
                                Based on property valuation of {money(data.property_valuation ?? 0)}.
                            </p>
                        </div>

                        {/* Equity loan eligibility — always shown below diagram */}
                        <div className="border-t border-slate-100 pt-4 space-y-2">
                            <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">Available Equity</p>
                            <p className="text-sm text-slate-600">
                                75% − {pct(computation.loanPct)} (loan) − {pct(computation.cpfPct)} (CPF)
                                {' '}= <span className={`font-bold ${computation.equityPct > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                                    {pct(computation.equityPct)}
                                </span>
                            </p>
                            {computation.equityPct <= 0 ? (
                                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                                    <AlertTriangle size={13} className="text-red-500 shrink-0 mt-0.5" />
                                    <p className="text-[12px] text-red-800">Not eligible for equity loan — combined loan and CPF already reach 75% of property value.</p>
                                </div>
                            ) : !computation.equityEligible ? (
                                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                                    <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
                                    <p className="text-[12px] text-amber-800">
                                        Available equity {money(computation.equityLoanMax)} — below $50,000 minimum. Require higher valuation; min equity loan amount is $50,000.
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                                        <CheckCircle2 size={13} className="text-emerald-600 shrink-0 mt-0.5" />
                                        <p className="text-[12px] text-emerald-800 font-semibold">
                                            Available Equity: {money(computation.equityLoanMax)} — eligible.
                                        </p>
                                    </div>
                                    <Question label="Would you like to take up an equity loan?">
                                        <FieldInput commas prefix="$"
                                            value={data.equity_loan_amount ?? ''}
                                            placeholder={`max ${money(computation.equityLoanMax)}`}
                                            onChange={v => {
                                                const n = num(v)
                                                update({ equity_loan_amount: n !== undefined ? Math.min(n, computation.equityLoanMax) : undefined })
                                            }} />
                                    </Question>
                                </div>
                            )}
                        </div>

                    </div>
                </div>
            )}

            {/* ── 6. BUYER INCOME ── (skip S4) */}
            {showIncome && (
                <Section title="Buyer Income — for TDSR" icon={<Wallet size={15} />}>
                    {borrowers.map((b, i) => (
                        <div key={i} className="rounded-lg border border-slate-200 p-4 space-y-4">
                            <Question label="Employment">
                                <PillSelect
                                    value={b.employment ?? 'employed'}
                                    onChange={v => updateBorrower({ employment: v as DecoupleBorrower['employment'] })}
                                    options={[
                                        { value: 'employed', label: 'Employed' },
                                        { value: 'self_employed', label: 'Self-Employed' },
                                    ]}
                                />
                            </Question>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {b.employment !== 'self_employed' && (
                                    <Question label="Monthly Basic Salary">
                                        <FieldInput commas prefix="$" value={b.basic_salary ?? ''}
                                            onChange={v => updateBorrower({ basic_salary: num(v) })} />
                                    </Question>
                                )}
                                <Question label={b.employment === 'self_employed' ? 'Annual Income (NOA)' : 'Annual Bonus / Variable'}>
                                    <FieldInput commas prefix="$" value={b.annual_variable ?? ''}
                                        onChange={v => updateBorrower({ annual_variable: num(v) })} />
                                </Question>
                                <Question label="Age">
                                    <FieldInput type="number" value={b.age ?? ''}
                                        onChange={v => updateBorrower({ age: num(v) })} />
                                </Question>
                                <Question label="Monthly Commitments (excl. property)">
                                    <FieldInput commas prefix="$" value={b.commitments ?? ''} placeholder="car, credit cards…"
                                        onChange={v => updateBorrower({ commitments: num(v) })} />
                                </Question>
                            </div>
                        </div>
                    ))}

                </Section>
            )}

            {/* ── 7. TDSR SECTION ── (skip S4) */}
            {showTdsr && (
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
                                    placeholder="35"
                                    onChange={e => setEstEligDraft(e.target.value)}
                                    onBlur={e => {
                                        const v = parseInt(e.target.value, 10)
                                        const clamped = isNaN(v) ? undefined : Math.max(1, Math.min(35, v))
                                        setEstEligTenure(clamped)
                                        setEstEligDraft(clamped != null ? String(clamped) : '')
                                    }}
                                    className="w-16 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 outline-none focus:border-[#03a9e7]"
                                />
                                <span className="text-[11px] text-slate-400">yrs</span>
                            </div>
                        </div>
                        <div className="text-right shrink-0">
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Available TDSR</p>
                            <p className="text-xl font-bold text-[#052d4a]">{money(computation.availableTdsr)}</p>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                {money(computation.grossMonthlyIncome)} × 55% − {money(computation.existingMonthlyDebts)} commitments
                                {computation.weightedAge != null ? ` · Age ${computation.weightedAge} yrs` : ''}
                            </p>
                        </div>
                    </div>

                    {/* TDSR Breakdown sub-header */}
                    <div className="flex items-center gap-3">
                        <div className="flex-1 border-t border-slate-200" />
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">TDSR Breakdown</p>
                        <div className="flex-1 border-t border-slate-200" />
                    </div>

                    {/* S1 — refi only */}
                    {scenario === 'S1' && (
                        <>
                            <LoanBreakdownCard
                                title="Refinancing Outstanding Home Loan Liability"
                                subtitle={`Buyer's ${Math.round(computation.buyerShareFrac * 100)}% share of home loan`}
                                amount={(data.outstanding_home_loan ?? 0) * computation.buyerShareFrac}
                                tenureMin={computation.refiTenureMin}
                                tenureMax={computation.refiTenureMax}
                                effectiveTenure={computation.effectiveRefiTenure}
                                ageCap={AGE_CAP_REFI}
                                stressInstallment={computation.homeLoanStressInstallment}
                                pass={computation.homeLoanTdsrPass}
                                tdsrShortfall={Math.max(0, computation.homeLoanStressInstallment - computation.availableTdsr)}
                                onTenureChange={v => update({ preferred_tenure_refi: v })}
                                preferredTenure={data.preferred_tenure_refi}
                            />
                            {!computation.homeLoanTdsrPass && (
                                <TdsrRemedy propertyUse={data.property_use} equityLoanAmount={data.equity_loan_amount} pledge={computation.homeLoanPledge} />
                            )}
                            {(data.outstanding_equity_loan ?? 0) > 0 && (
                                <>
                                    <LoanBreakdownCard
                                        title="Outstanding Equity Loan"
                                        subtitle={`Buyer's ${Math.round(computation.buyerShareFrac * 100)}% share of equity loan`}
                                        amount={(data.outstanding_equity_loan ?? 0) * computation.buyerShareFrac}
                                        tenureMin={MIN_TENURE}
                                        tenureMax={computation.equityLoanCurrentTenureMax}
                                        effectiveTenure={computation.effectiveCurrentEquityLoanTenure}
                                        ageCap={AGE_CAP_REFI}
                                        stressInstallment={computation.equityLoanCurrentStressInstallment}
                                        pass={computation.equityLoanCurrentTdsrPass}
                                        tdsrShortfall={Math.max(0, computation.equityLoanCurrentStressInstallment - computation.balanceTdsrAfterHomeLoan)}
                                        onTenureChange={v => update({ preferred_tenure_equity_current: v })}
                                        preferredTenure={data.preferred_tenure_equity_current}
                                    />
                                    {!computation.equityLoanCurrentTdsrPass && (
                                        <TdsrRemedy propertyUse={data.property_use} equityLoanAmount={data.equity_loan_amount} pledge={computation.equityLoanCurrentPledge} />
                                    )}
                                </>
                            )}
                        </>
                    )}

                    {/* S2 — purchase only */}
                    {scenario === 'S2' && (
                        <>
                            <LoanBreakdownCard
                                title="New Purchase Loan (75%)"
                                amount={computation.bankLoan75}
                                tenureMin={computation.purchaseTenureMin}
                                tenureMax={computation.purchaseTenureMax}
                                effectiveTenure={computation.effectivePurchaseTenure}
                                ageCap={AGE_CAP_PURCHASE}
                                stressInstallment={computation.purchaseStressInstallment}
                                pass={computation.purchaseTdsrPass}
                                tdsrShortfall={Math.max(0, computation.purchaseStressInstallment - computation.availableTdsr)}
                                onTenureChange={v => update({ preferred_tenure_purchase: v })}
                                preferredTenure={data.preferred_tenure_purchase}
                            />
                            {!computation.purchaseTdsrPass && (
                                <TdsrRemedy propertyUse={data.property_use} equityLoanAmount={data.equity_loan_amount} pledge={computation.purchasePledge} />
                            )}
                        </>
                    )}

                    {/* S3 — both */}
                    {scenario === 'S3' && (
                        <div className="space-y-3">
                            <LoanBreakdownCard
                                title="Refinancing Outstanding Home Loan Liability"
                                subtitle={`Buyer's ${Math.round(computation.buyerShareFrac * 100)}% share of home loan`}
                                amount={(data.outstanding_home_loan ?? 0) * computation.buyerShareFrac}
                                tenureMin={computation.refiTenureMin}
                                tenureMax={computation.refiTenureMax}
                                effectiveTenure={computation.effectiveRefiTenure}
                                ageCap={AGE_CAP_REFI}
                                stressInstallment={computation.homeLoanStressInstallment}
                                pass={computation.homeLoanTdsrPass}
                                tdsrShortfall={Math.max(0, computation.homeLoanStressInstallment - computation.availableTdsr)}
                                onTenureChange={v => update({ preferred_tenure_refi: v })}
                                preferredTenure={data.preferred_tenure_refi}
                            />
                            {!computation.homeLoanTdsrPass && (
                                <TdsrRemedy propertyUse={data.property_use} equityLoanAmount={data.equity_loan_amount} pledge={computation.homeLoanPledge} />
                            )}
                            {(data.outstanding_equity_loan ?? 0) > 0 && (
                                <>
                                    <LoanBreakdownCard
                                        title="Outstanding Equity Loan"
                                        subtitle={`Buyer's ${Math.round(computation.buyerShareFrac * 100)}% share of equity loan`}
                                        amount={(data.outstanding_equity_loan ?? 0) * computation.buyerShareFrac}
                                        tenureMin={MIN_TENURE}
                                        tenureMax={computation.equityLoanCurrentTenureMax}
                                        effectiveTenure={computation.effectiveCurrentEquityLoanTenure}
                                        ageCap={AGE_CAP_REFI}
                                        stressInstallment={computation.equityLoanCurrentStressInstallment}
                                        pass={computation.equityLoanCurrentTdsrPass}
                                        tdsrShortfall={Math.max(0, computation.equityLoanCurrentStressInstallment - computation.balanceTdsrAfterHomeLoan)}
                                        onTenureChange={v => update({ preferred_tenure_equity_current: v })}
                                        preferredTenure={data.preferred_tenure_equity_current}
                                    />
                                    {!computation.equityLoanCurrentTdsrPass && (
                                        <TdsrRemedy propertyUse={data.property_use} equityLoanAmount={data.equity_loan_amount} pledge={computation.equityLoanCurrentPledge} />
                                    )}
                                </>
                            )}

                            <LoanBreakdownCard
                                title="New Purchase Loan (75%)"
                                amount={computation.bankLoan75}
                                tenureMin={computation.purchaseTenureMin}
                                tenureMax={computation.purchaseTenureMax}
                                effectiveTenure={computation.effectivePurchaseTenure}
                                ageCap={AGE_CAP_PURCHASE}
                                stressInstallment={computation.purchaseStressInstallment}
                                pass={computation.purchaseTdsrPass}
                                tdsrShortfall={Math.max(0, computation.purchaseStressInstallment - computation.balanceTdsrForPurchase)}
                                onTenureChange={v => update({ preferred_tenure_purchase: v })}
                                preferredTenure={data.preferred_tenure_purchase}
                            />
                            {!computation.purchaseTdsrPass && (
                                <TdsrRemedy propertyUse={data.property_use} equityLoanAmount={data.equity_loan_amount} pledge={computation.purchasePledge} />
                            )}
                        </div>
                    )}

                    {/* New Equity Loan — merged from old Section 8 */}
                    {(data.equity_loan_amount ?? 0) > 0 && (
                        <>
                            <div className="flex items-center gap-3">
                                <div className="flex-1 border-t border-slate-200" />
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">New Equity Loan</p>
                                <div className="flex-1 border-t border-slate-200" />
                            </div>

                            <LoanBreakdownCard
                                title={`New Equity Loan (${money(data.equity_loan_amount ?? 0)} requested)`}
                                amount={data.equity_loan_amount ?? 0}
                                tenureMin={computation.equityTenureMin}
                                tenureMax={computation.equityTenureMax}
                                effectiveTenure={computation.effectiveEquityTenure}
                                ageCap={AGE_CAP_REFI}
                                stressInstallment={computation.equityStressInstallment}
                                pass={computation.equityTdsrPass}
                                tdsrShortfall={Math.max(0, computation.equityStressInstallment - computation.remainingTdsrAfterLoans)}
                                onTenureChange={v => update({ preferred_tenure_equity: v })}
                                preferredTenure={data.preferred_tenure_equity}
                            />

                            {!computation.equityTdsrPass && (
                                <TdsrRemedy
                                    propertyUse={data.property_use}
                                    equityLoanAmount={data.equity_loan_amount}
                                    pledge={computation.equityPledge}
                                />
                            )}
                        </>
                    )}

                </Section>
            )}

            {/* ── 8. TDSR FINAL SUMMARY — auto-filtered to only failing loans ── */}
            {showTdsr && (
                <TdsrFinalSummary pledges={[
                    { label: 'Refinancing Home Loan',    pledge: computation.homeLoanPledge },
                    { label: 'Refinancing Equity Loan',  pledge: computation.equityLoanCurrentPledge },
                    { label: 'New Purchase Home Loan',   pledge: computation.purchasePledge },
                    { label: 'New Equity Loan',          pledge: computation.equityPledge },
                ]} />
            )}

            {/* ── 9. TOTAL LIQUIDITY REQUIRED — S2/S3 only ── */}
            {computation.ready && (scenario === 'S2' || scenario === 'S3') && (() => {
                const miscFees = computation.bsd + computation.absd + computation.buyerLegalFee
                const fmtPct = (f: number) => `${Math.round(f * 100)}%`
                const s1Total = computation.cash5 + computation.cpfCash20 + miscFees
                // Combined pledge = sum of ALL failing loans (same as TdsrFinalSummary)
                const allPledges = [
                    computation.homeLoanPledge,
                    computation.equityLoanCurrentPledge,
                    computation.purchasePledge,
                    computation.equityPledge,
                ].filter((p): p is DecouplePledge => p != null)
                const combinedPledge = allPledges.length > 0
                    ? { pledgeFund: allPledges.reduce((s, p) => s + p.pledgeFund, 0), showFund: allPledges.reduce((s, p) => s + p.showFund, 0) }
                    : null
                const s2Total = combinedPledge ? combinedPledge.pledgeFund + computation.cash5 + computation.cpfCash20 + miscFees : null
                const s3Total = combinedPledge ? combinedPledge.showFund + computation.cash5 + computation.cpfCash20 + miscFees : null
                const loanFrac = computation.purchasePrice > 0 ? computation.bankLoan75 / computation.purchasePrice : 0.75
                const cpfFrac  = computation.purchasePrice > 0 ? computation.cpfCash20 / computation.purchasePrice : 0.20
                return (
                    <Section title="Total Liquidity Required" icon={<Wallet size={15} />}>
                        <p className="text-[11px] text-slate-400 -mt-1">
                            Misc fees (BSD + ABSD + legal) = {money(miscFees)}
                        </p>

                        {/* S1 — no pledging */}
                        <div className="rounded-lg border border-slate-200 p-3 space-y-1.5">
                            <p className="text-[11px] font-semibold text-red-500 uppercase tracking-wide">S1 — Without pledging / showing</p>
                            <p className="text-sm font-semibold text-[#052d4a] pb-0.5">
                                No Pledging/Showing to get {money(computation.bankLoan75)} loan (<span className="text-[#03a9e7]">{fmtPct(loanFrac)}</span>)
                            </p>
                            <Row label={<>Min Cash <span className="text-[#03a9e7]">(5%)</span></>} value={money(computation.cash5)} />
                            <Row label={<>Balance Cash / CPF <span className="text-[#03a9e7]">({fmtPct(cpfFrac)})</span></>} value={money(computation.cpfCash20)} />
                            <Row label="Misc Fees" value={money(miscFees)} valueClass="text-slate-400" />
                            <div className="border-t border-dashed border-slate-200 pt-1.5">
                                <Row label="Total Required" value={money(s1Total)} highlight />
                            </div>
                        </div>

                        {combinedPledge && s2Total !== null && s3Total !== null && (
                            <>
                                {/* S2 — with pledging */}
                                <div className="rounded-lg border border-slate-200 p-3 space-y-1.5">
                                    <p className="text-[11px] font-semibold text-red-500 uppercase tracking-wide">S2 — With pledging</p>
                                    <Row label="Pledging of Funds (all loans, locked 4 yrs)"
                                        value={money(combinedPledge.pledgeFund)} highlight />
                                    <Row label={<>Min Cash <span className="text-[#03a9e7]">(5%)</span></>} value={money(computation.cash5)} />
                                    <Row label={<>Cash / CPF <span className="text-[#03a9e7]">({fmtPct(cpfFrac)})</span></>} value={money(computation.cpfCash20)} />
                                    <Row label="Misc Fees" value={money(miscFees)} valueClass="text-slate-400" />
                                    <div className="border-t border-dashed border-slate-200 pt-1.5">
                                        <Row label="Total Required" value={money(s2Total)} highlight />
                                    </div>
                                </div>

                                {/* S3 — with show funds */}
                                <div className="rounded-lg border border-slate-200 p-3 space-y-1.5">
                                    <p className="text-[11px] font-semibold text-red-500 uppercase tracking-wide">S3 — With show funds</p>
                                    <Row label="Showing of Funds (all loans)"
                                        value={money(combinedPledge.showFund)} highlight />
                                    <Row label={<>Min Cash <span className="text-[#03a9e7]">(5%)</span></>} value={money(computation.cash5)} />
                                    <Row label={<>Cash / CPF <span className="text-[#03a9e7]">({fmtPct(cpfFrac)})</span></>} value={money(computation.cpfCash20)} />
                                    <Row label="Misc Fees" value={money(miscFees)} valueClass="text-slate-400" />
                                    <div className="border-t border-dashed border-slate-200 pt-1.5">
                                        <Row label="Total Required" value={money(s3Total)} highlight />
                                    </div>
                                </div>
                            </>
                        )}
                    </Section>
                )
            })()}

            {/* ── 10. RATE PREFERENCE ── */}
            {computation.ready && scenario !== null && scenario !== 'S4' && (
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

            {/* ── 11. RECOMMENDED PACKAGES ── */}
            {computation.ready && scenario !== null && scenario !== 'S4' && pkgLoan > 0 && (
                <RefiPackages
                    loan={pkgLoan}
                    tenureYears={pkgTenure}
                    propertyType={pkgPropertyType}
                    includeBuc={pkgIncludeBuc}
                    currentRatePct={data.current_rate}
                    preference={data.rate_preference ?? 'both'}
                    selectedId={selectedPkgId}
                    onSelect={onSelectPackage}
                />
            )}

            {/* ── 12. MONTHLY INSTALMENT ── */}
            {computation.ready && scenario !== null && scenario !== 'S4' && pkgLoan > 0 && (() => {
                const clamp = (v: number) => Math.min(Math.max(v, pkgTenureMin), pkgTenure)
                const t1 = clamp(data.preferred_tenure_1 ?? pkgTenure)
                const t2 = clamp(preferredTenure2 ?? pkgTenure)
                const amortRows1 = computeAmortization(pkgLoan, t1, activeSchedule, soraForAmort)
                const amortRows2 = computeAmortization(pkgLoan, t2, activeSchedule, soraForAmort)
                const m1 = amortRows1[0]?.instalment ?? null
                const m2 = amortRows2[0]?.instalment ?? null
                // effectiveLockin: for interest cards + cumulative interest (requires > 0)
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
                // breakdownYears: always show year-by-year table; falls back to scheduled year count when no lock-in
                const schedExplicitYears = activeSchedule.filter(e => !e.thereafter && e.year != null).length
                const breakdownYears = effectiveLockin ?? (schedExplicitYears > 0 ? schedExplicitYears : 3)
                const inputCls = 'w-20 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12'
                const fmt2 = (n: number | null) => n != null ? `$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
                return (
                    <Section title="Monthly Instalment" icon={<Wallet size={15} />}>

                        {/* Live SORA rates */}
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
                                        <AmortRateRow key={idx}
                                            entry={entry} label={`Year ${entry.year}`} isLockin
                                            onChange={patch => updateScheduleRow(schedIdx, patch)}
                                            onRemove={() => removeScheduleRow(schedIdx)}
                                            canRemove={(data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE).length > 1}
                                            refId={`decouple-rate-${idx}`}
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
                                                <AmortRateRow key={`t-${idx}`}
                                                    entry={entry} label="Thereafter" isLockin={false}
                                                    onChange={patch => updateScheduleRow(schedIdx, patch)}
                                                    onRemove={() => removeScheduleRow(schedIdx)}
                                                    canRemove={(data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE).length > 1}
                                                    refId={`decouple-rate-thereafter-${idx}`}
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
                                            <p className="text-xl font-black mt-0.5">{value != null ? money(value) : '—'}</p>
                                            {instalment != null && <p className="text-[11px] opacity-60 mt-0.5">{money(instalment)}/mo</p>}
                                        </div>
                                    ) : (
                                        <div key={year} className="flex-1 min-w-[100px] rounded-xl border border-slate-200 bg-white px-4 py-3">
                                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Int · Yr {year}</p>
                                            <p className="text-lg font-black text-[#052d4a] mt-0.5">{value != null ? money(value) : '—'}</p>
                                            {instalment != null && <p className="text-[11px] text-slate-400 mt-0.5">{money(instalment)}/mo</p>}
                                        </div>
                                    )
                                })}
                            </div>
                        )}

                        {/* Tenure comparison table */}
                        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                            Tenure Range based off loan: {pkgTenureMin} – {pkgTenure} yrs
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <label className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">Preferred Tenure 1</label>
                                <div className="flex items-center gap-2">
                                    <input type="number" min={pkgTenureMin} max={pkgTenure}
                                        value={rawPrefTenure1 !== '' ? rawPrefTenure1 : (data.preferred_tenure_1 != null ? String(data.preferred_tenure_1) : '')}
                                        placeholder={String(pkgTenure)}
                                        onChange={e => setRawPrefTenure1(e.target.value)}
                                        onBlur={() => {
                                            const parsed = parseInt(rawPrefTenure1, 10)
                                            setRawPrefTenure1('')
                                            update({ preferred_tenure_1: isNaN(parsed) ? undefined : clamp(parsed) })
                                        }}
                                        className={inputCls} />
                                    <span className="text-xs text-slate-500">yrs</span>
                                </div>
                                {data.preferred_tenure_1 == null && <p className="text-[11px] text-slate-400">Synced with preferred tenure above</p>}
                            </div>
                            <div className="space-y-1">
                                <label className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">Preferred Tenure 2</label>
                                <div className="flex items-center gap-2">
                                    <input type="number" min={pkgTenureMin} max={pkgTenure}
                                        value={rawPrefTenure2 !== '' ? rawPrefTenure2 : (preferredTenure2 != null ? String(preferredTenure2) : '')}
                                        placeholder={String(pkgTenure)}
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

                        <div className="rounded-xl border border-slate-200 overflow-hidden">
                            <div className="grid grid-cols-3 border-b border-slate-100 bg-slate-50/60">
                                <div className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Option</div>
                                <div className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide border-l border-slate-100 text-right">Tenure 1 ({t1} yrs)</div>
                                <div className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide border-l border-slate-100 text-right">Tenure 2 ({t2} yrs)</div>
                            </div>
                            <div className="grid grid-cols-3 border-b border-slate-100">
                                <div className="px-3 py-2.5 text-slate-600 text-sm">Monthly Instalment</div>
                                <div className="px-3 py-2.5 text-right font-semibold text-[#052d4a] border-l border-slate-100 text-sm">
                                    {m1 != null ? <>{money(m1)}<span className="text-slate-400 font-normal">/mo</span></> : <span className="text-slate-300">—</span>}
                                </div>
                                <div className="px-3 py-2.5 text-right font-semibold border-l border-slate-100 text-sm">
                                    {m1 != null && m2 != null ? (
                                        <>{money(m2)}<span className="text-slate-400 font-normal">/mo</span>
                                        <span className={`ml-1.5 text-[11px] font-bold ${m2 > m1 ? 'text-red-500' : 'text-emerald-600'}`}>
                                            {m2 > m1 ? '+' : ''}{money(m2 - m1)}
                                        </span></>
                                    ) : <span className="text-slate-300">—</span>}
                                </div>
                            </div>
                            <div className="grid grid-cols-3">
                                <div className="px-3 py-2.5 text-slate-600 text-sm">
                                    {effectiveLockin != null ? `Interest (${effectiveLockin}-yr lock-in)` : 'Lock-in Interest'}
                                </div>
                                <div className="px-3 py-2.5 text-right font-semibold text-slate-700 border-l border-slate-100 text-sm">
                                    {i1 != null ? money(i1) : <span className="text-slate-300">—</span>}
                                </div>
                                <div className="px-3 py-2.5 text-right font-semibold border-l border-slate-100 text-sm">
                                    {i1 != null && i2 != null ? (
                                        <>{money(i2)}
                                        <span className={`ml-1.5 text-[11px] font-bold ${i2 > i1 ? 'text-red-500' : 'text-emerald-600'}`}>
                                            {i2 > i1 ? '+' : ''}{money(i2 - i1)}
                                        </span></>
                                    ) : <span className="text-slate-300">—</span>}
                                </div>
                            </div>
                        </div>

                        {/* Year-by-Year Breakdown — both tenures */}
                        {[
                            { rows: amortRows1, t: t1, label: 'Tenure 1' },
                            { rows: amortRows2, t: t2, label: 'Tenure 2' },
                        ].map(({ rows, t, label }) => rows.length > 0 && (
                            <div key={label} className="rounded-lg border border-slate-200 overflow-hidden">
                                <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Year-by-Year Breakdown</span>
                                    <span className="text-[11px] text-slate-400">
                                        {effectiveLockin != null ? `Lock-in · ` : ''}{label} ({t} yrs)
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
                                                const isLastLockin = row.year === breakdownYears
                                                return (
                                                    <tr key={row.year} className={`border-b border-slate-50 last:border-b-0 ${isLastLockin ? 'bg-sky-50/50' : 'bg-white'}`}>
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
                                                                isLastLockin
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

            {/* Placeholder when not ready */}
            {!computation.ready && (
                <div className="card p-8 text-center text-sm text-slate-400">
                    Enter property valuation and ownership split above to see the decoupling breakdown.
                </div>
            )}

            <p className="text-[11px] text-slate-400 leading-relaxed px-1">
                All figures are estimates for discussion purposes only.
                Stamp duties follow prevailing IRAS rates — verify before committing.
            </p>

            {/* Hand-off */}
            {embedded && onContinue && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-[#03a9e7]/25 bg-sky-50/40 p-4">
                    <p className="text-xs text-slate-500 flex items-center gap-1.5">
                        <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                        Saved automatically.{hasClientName ? '' : ' Add the client\'s details to finish.'}
                    </p>
                    <button type="button" onClick={onContinue}
                        className="btn-primary text-sm px-5 py-2.5 flex items-center gap-2">
                        {hasClientName ? 'Save & continue' : 'Add client details & save'} <ArrowRight size={16} />
                    </button>
                </div>
            )}
        </div>
    )
}

// ─── Loan Breakdown Card ──────────────────────────────────────────────────────

function LoanBreakdownCard({
    title, subtitle, amount, tenureMin, tenureMax, effectiveTenure, ageCap,
    stressInstallment, pass, tdsrShortfall, tenureFixed,
    onTenureChange, preferredTenure,
}: {
    title: string
    subtitle?: string
    amount: number
    tenureMin: number
    tenureMax: number
    effectiveTenure: number
    ageCap?: number
    stressInstallment: number
    pass?: boolean
    tdsrShortfall?: number
    tenureFixed?: boolean
    onTenureChange?: (v: number | undefined) => void
    preferredTenure?: number
}) {
    const [draft, setDraft] = React.useState<string>(preferredTenure != null ? String(preferredTenure) : '')

    React.useEffect(() => {
        setDraft(preferredTenure != null ? String(preferredTenure) : '')
    }, [preferredTenure])

    return (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{title}</p>
                    <p className="text-2xl font-bold text-[#052d4a]">{money(amount)}</p>
                    {subtitle && <p className="text-[10px] text-slate-400 italic mt-0.5">{subtitle}</p>}
                </div>
                <div className="text-right shrink-0">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">TDSR Required</p>
                    <p className="text-lg font-bold text-[#052d4a]">{money(stressInstallment)}</p>
                    <p className="text-[11px] text-slate-400">at {effectiveTenure} yrs, 4% stress</p>
                </div>
            </div>

            {tenureFixed ? (
                <p className="text-[11px] text-slate-400">Remaining tenure: {effectiveTenure} yrs (fixed)</p>
            ) : (
                <div className="space-y-1.5">
                    <p className="text-[11px] text-slate-400">
                        Tenure range: {tenureMin} – {tenureMax} yrs{ageCap ? ` (to age ${ageCap})` : ''}
                    </p>
                    {onTenureChange && (
                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                value={draft}
                                placeholder={String(tenureMax)}
                                onChange={e => setDraft(e.target.value)}
                                onBlur={e => {
                                    const v = parseInt(e.target.value, 10)
                                    const clamped = isNaN(v) ? undefined : Math.max(tenureMin, Math.min(tenureMax, v))
                                    onTenureChange(clamped)
                                    setDraft(clamped != null ? String(clamped) : '')
                                }}
                                className="w-20 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12"
                            />
                            <span className="text-xs text-slate-500">years — adjust to explore TDSR required</span>
                        </div>
                    )}
                </div>
            )}

            {pass !== undefined && (
                <div className={`rounded-lg border px-3 py-2.5 flex items-center gap-2 ${pass ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                    {pass ? (
                        <><CheckCircle2 size={14} className="text-emerald-600" /><span className="text-sm font-bold text-emerald-700">TDSR Pass</span></>
                    ) : (
                        <>
                            <AlertTriangle size={14} className="text-red-500" />
                            <span className="text-sm font-bold text-red-600">TDSR Fail</span>
                            {tdsrShortfall != null && tdsrShortfall > 0 && (
                                <span className="ml-auto text-[11px] font-semibold text-red-600">
                                    TDSR shortfall: {money(tdsrShortfall)}
                                </span>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    )
}

// ─── TDSR Remedy (same logic as refinancing + pledge/show from purchaseCalc) ──

function TdsrRemedy({ propertyUse, equityLoanAmount, pledge }: {
    propertyUse?: string
    equityLoanAmount?: number
    pledge?: DecouplePledge | null
}) {
    const isOwnStay = propertyUse === 'own_stay'
    const hasEquity = (equityLoanAmount ?? 0) > 0

    const text = isOwnStay && !hasEquity
        ? 'Client may qualify for TDSR Waiver with most banks — to double check with banker.'
        : isOwnStay && hasEquity
            ? 'Pledge / Show funds required to pass TDSR for the equity loan component.'
            : !isOwnStay && !hasEquity
                ? 'Bank will require client to pay down 3% of outstanding loan and / or show some funds to prove repayment ability — to double check with banker.'
                : 'Pledge / Show funds required to pass TDSR.'

    return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
            <p className="text-[12px] font-semibold text-amber-800">Potential Remedies</p>
            <p className="text-[12px] text-amber-700 leading-relaxed">{text}</p>
            {pledge && (
                <p className="text-[12px] text-amber-900">
                    <span className="font-semibold">Pledge {money(pledge.pledgeFund)}</span> (locked 4 yrs)
                    {' '}or <span className="font-semibold">Show {money(pledge.showFund)}</span> in funds.
                </p>
            )}
        </div>
    )
}

// ─── TDSR Final Summary ───────────────────────────────────────────────────────

function TdsrFinalSummary({ pledges }: {
    pledges: { label: string; pledge: DecouplePledge | null | undefined }[]
}) {
    const entries = pledges.filter((p): p is { label: string; pledge: DecouplePledge } => p.pledge != null)
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
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="card p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <span className="text-[#03a9e7]">{icon}</span>
                <h3 className="text-sm font-bold text-[#052d4a] uppercase tracking-wide">{title}</h3>
            </div>
            {children}
        </div>
    )
}

// ─── Interest over lock-in period ────────────────────────────────────────────

function interestOverPeriod(loan: number, ratePct: number, tenureYrs: number, periodYrs: number): number {
    const r = ratePct / 100 / 12
    const nT = tenureYrs * 12
    const nP = Math.min(Math.round(periodYrs * 12), nT)
    if (r === 0 || nT === 0 || nP === 0) return 0
    const p = loan * r * Math.pow(1 + r, nT) / (Math.pow(1 + r, nT) - 1)
    const balance = Math.max(loan * Math.pow(1 + r, nP) - p * (Math.pow(1 + r, nP) - 1) / r, 0)
    return Math.max(p * nP - (loan - balance), 0)
}

// ─── Tenure Comparison ────────────────────────────────────────────────────────

function TenureComparison({
    loan, ratePct, rateLabel, lockinYears, tenureMin, tenureMax, tenure1, tenure2,
    onT1Change, onT2Change, grossIncome, existingDebts, propertyUse,
}: {
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
    propertyUse?: string
}) {
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
            {rateLabel
                ? <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><Info size={12} className="text-[#03a9e7]" /> Rate used: {rateLabel}</p>
                : <p className="text-[11px] text-amber-600 flex items-center gap-1.5"><AlertTriangle size={12} /> Select a package above to price the comparison.</p>
            }

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

function PillSelect({ value, onChange, options }: {
    value?: string
    onChange: (v: string) => void
    options: { value: string; label: string }[]
}) {
    return (
        <div className="flex flex-wrap gap-2">
            {options.map(o => (
                <button key={o.value} type="button" onClick={() => onChange(o.value)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${value === o.value
                            ? 'bg-[#052d4a] border-[#052d4a] text-white'
                            : 'bg-white border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7]'
                        }`}>
                    {o.label}
                </button>
            ))}
        </div>
    )
}

function YesNo({ value, onChange }: { value?: boolean; onChange: (v: boolean) => void }) {
    return (
        <div className="flex gap-2">
            {([true, false] as const).map(v => (
                <button key={String(v)} type="button" onClick={() => onChange(v)}
                    className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-all ${value === v
                            ? 'bg-[#052d4a] border-[#052d4a] text-white'
                            : 'bg-white border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7]'
                        }`}>
                    {v ? 'Yes' : 'No'}
                </button>
            ))}
        </div>
    )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
            <p className="text-[11px] text-slate-500 leading-tight">{label}</p>
            <p className="text-base font-bold text-[#052d4a] mt-0.5">{value}</p>
            {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
        </div>
    )
}

function SubNote({ children }: { children: React.ReactNode }) {
    return <p className="text-[11px] text-slate-400 -mt-1 pl-0.5">{children}</p>
}

function Row({ label, value, hint, highlight, valueClass }: {
    label: React.ReactNode; value: string; hint?: string; highlight?: boolean; valueClass?: string
}) {
    return (
        <div className={`flex items-start justify-between gap-4 py-1 ${highlight ? 'font-semibold' : ''}`}>
            <div>
                <span className="text-sm text-slate-700">{label}</span>
                {hint && <span className="text-[11px] text-slate-400 ml-1.5">({hint})</span>}
            </div>
            <span className={`text-sm font-semibold text-[#052d4a] shrink-0 ${valueClass ?? ''}`}>{value}</span>
        </div>
    )
}

function OwnershipBar({ loanPct, cpfPct, cashPct, loanAmt, cpfAmt, cashAmt }: {
    loanPct: number; cpfPct: number; cashPct: number
    loanAmt: number; cpfAmt: number; cashAmt: number
}) {
    const total = loanPct + cpfPct + cashPct
    const lW = total > 0 ? (loanPct / total) * 100 : 0
    const cW = total > 0 ? (cpfPct / total) * 100 : 0
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

// ── Rate row for the embedded amortisation schedule ──────────────────────────

const rateRowInp = 'px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/10 bg-white transition-colors'
const AMORT_RATE_REFS = ['3M SORA', '1M SORA', 'Custom'] as const

function AmortRateRow({
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
                        className={`${rateRowInp} w-20`} />
                    <span className="text-xs text-slate-400">%</span>
                </div>
            ) : (
                <div className="flex items-center gap-1.5 flex-1 flex-wrap">
                    <input list={refId} value={entry.reference ?? ''} placeholder="3M SORA"
                        onChange={e => {
                            const ref = e.target.value
                            onChange(ref !== 'Custom' ? { reference: ref, rate: undefined } : { reference: ref })
                        }}
                        className={`${rateRowInp} w-24`} />
                    <datalist id={refId}>
                        {AMORT_RATE_REFS.map(r => <option key={r} value={r} />)}
                    </datalist>
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
