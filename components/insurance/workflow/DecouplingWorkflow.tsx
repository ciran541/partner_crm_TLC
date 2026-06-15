'use client'

import React, { useMemo, useState } from 'react'
import {
    computeDecouple,
    inputsFromDecoupleWorkflow,
    DEFAULT_REFERENCE_RATE,
    MIN_TENURE,
    AGE_CAP_REFI,
    AGE_CAP_PURCHASE,
    SUBSIDY_PRESETS,
    DECOUPLE_PROPERTY_TYPES,
    type TdsrOutcome,
} from '@/lib/insurance/decoupleCalc'
import type { DecoupleWorkflow, DecoupleBorrower } from '@/lib/types/workflow'
import type { DecouplePledge } from '@/lib/insurance/decoupleCalc'
import { Question, FieldInput } from '@/components/insurance/workflow/WorkflowStep'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import {
    Home, CheckCircle2, AlertTriangle, Info, Save,
    ArrowRight, ExternalLink, Users, Building2, Percent,
    Wallet,
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

const money = (n: number) => `$${Math.round(n).toLocaleString()}`
const pct   = (frac: number, dp = 1) => `${(frac * 100).toFixed(dp)}%`
const num   = (v: string | number) => {
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

    const computation = useMemo(() => computeDecouple(inputsFromDecoupleWorkflow(data)), [data])
    const { scenario } = computation

    const sellerPct    = 100 - (data.buyer_share ?? 50)
    const buyerPctStr  = `${data.buyer_share ?? ''}%`
    const sellerPctStr = `${sellerPct}%`

    // Single borrower only
    const defaultBorrower: DecoupleBorrower = { employment: 'employed' }
    const borrowers = data.borrowers?.length ? [data.borrowers[0]] : [defaultBorrower]
    const updateBorrower = (patch: Partial<DecoupleBorrower>) => {
        update({ borrowers: [{ ...borrowers[0], ...patch }] })
    }

    const showIncome = scenario !== null && scenario !== 'S4'
    const showTdsr   = showIncome && computation.grossMonthlyIncome > 0

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
                            { value: 'own_stay',   label: 'Own-Stay' },
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
                            { value: 'pr',          label: 'PR' },
                            { value: 'foreigner',   label: 'Foreigner' },
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
                            <Question label="Remaining Tenure (years)">
                                <FieldInput type="number" value={data.current_tenure ?? ''}
                                    onChange={v => update({ current_tenure: num(v) })} />
                            </Question>
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
                                        className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                                            !customSubsidy && String(data.subsidy_return_amount ?? 0) === p
                                                ? 'bg-[#052d4a] border-[#052d4a] text-white'
                                                : 'bg-white border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7]'
                                        }`}>
                                        ${Number(p).toLocaleString()}
                                    </button>
                                ))}
                                <button type="button"
                                    onClick={() => setCustomSubsidy(true)}
                                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                                        customSubsidy
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

            {/* ── 5. BREAKDOWN (Buyer's Perspective) ── */}
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
                            {(scenario === 'S2' || scenario === 'S3') && (
                                <>
                                    <Row label="5% Cash (Minimum Cash)" value={money(computation.cash5)} />
                                    <Row label="20% CPF / Cash" value={money(computation.cpfCash20)} />
                                    <Row label="75% Bank Loan (New)" value={money(computation.bankLoan75)} />
                                    <div className="border-t border-dashed border-slate-200 my-1" />
                                    <Row label={`New Total Loan (${pct(computation.loanPct)} of Valuation)`} value={money(computation.loanForStructure)} />
                                    {computation.buyerLoanLiability > 0 && (
                                        <SubNote>Includes current loan liability of {money(computation.buyerLoanLiability)}</SubNote>
                                    )}
                                    <Row label={`Total CPF Used (${pct(computation.cpfPct)} of Valuation)`} value={money(computation.totalCpfUsed)} />
                                    <SubNote>Includes current CPF usage + CPF in OA balance</SubNote>
                                </>
                            )}
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

                        {/* Monthly instalment (S2, S3) */}
                        {(scenario === 'S2' || scenario === 'S3') && (
                            <div className="border-t border-slate-100 pt-4 space-y-2">
                                <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">Est. Monthly Instalment</p>
                                <div className="flex items-center gap-3 rounded-lg bg-sky-50/50 border border-[#03a9e7]/15 px-4 py-3">
                                    <div>
                                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">New Purchase Loan</p>
                                        <p className="text-lg font-bold text-[#052d4a]">{money(computation.monthlyInstallment)}/mo</p>
                                    </div>
                                    <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
                                        <span>at</span>
                                        <input type="number" step="0.05"
                                            value={data.reference_rate ?? ''}
                                            placeholder={`${DEFAULT_REFERENCE_RATE}`}
                                            onChange={e => update({ reference_rate: num(e.target.value) })}
                                            className="w-16 px-2 py-1 rounded-md border border-slate-200 bg-white text-center font-medium text-slate-700 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12" />
                                        <span>% p.a.</span>
                                    </div>
                                </div>
                            </div>
                        )}
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
                                        { value: 'employed',      label: 'Employed' },
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

                    {computation.weightedAge != null && (
                        <div className="flex items-center gap-4 rounded-lg bg-sky-50/50 border border-[#03a9e7]/15 px-4 py-3 flex-wrap">
                            <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Age</p>
                                <p className="text-base font-bold text-[#052d4a]">{computation.weightedAge} yrs</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Gross Monthly Income</p>
                                <p className="text-base font-bold text-[#052d4a]">{money(computation.grossMonthlyIncome)}</p>
                            </div>
                        </div>
                    )}
                </Section>
            )}

            {/* ── 7. TDSR SECTION ── (skip S4) */}
            {showTdsr && (
                <Section title="TDSR Assessment" icon={<Percent size={15} />}>
                    {/* Available TDSR header */}
                    <div className="rounded-lg border border-[#03a9e7]/20 bg-sky-50/40 px-4 py-3">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Available TDSR</p>
                        <p className="text-xl font-bold text-[#052d4a]">{money(computation.availableTdsr)}<span className="text-sm font-normal text-slate-500">/month</span></p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                            {money(computation.grossMonthlyIncome)} × 55% − {money(computation.existingMonthlyDebts)} commitments
                        </p>
                    </div>

                    {/* S1 — refi only */}
                    {scenario === 'S1' && (
                        <>
                            <TdsrBlock
                                title="Refinancing"
                                tenureMin={computation.refiTenureMin}
                                tenureMax={computation.refiTenureMax}
                                effectiveTenure={computation.effectiveRefiTenure}
                                ageCap={AGE_CAP_REFI}
                                defaultLabel="current tenure"
                                stressInstallment={computation.refiStressInstallment}
                                loanEligibility={computation.refiLoanEligibility}
                                pass={computation.refiTdsrPass}
                                onTenureChange={v => update({ preferred_tenure_refi: v })}
                                preferredTenure={data.preferred_tenure_refi}
                            />
                            {!computation.refiTdsrPass && (
                                <TdsrRemedy propertyUse={data.property_use} equityLoanAmount={data.equity_loan_amount} pledge={computation.refiPledge} />
                            )}
                        </>
                    )}

                    {/* S2 — purchase only */}
                    {scenario === 'S2' && (
                        <>
                            <TdsrBlock
                                title="New Purchase Loan"
                                tenureMin={computation.purchaseTenureMin}
                                tenureMax={computation.purchaseTenureMax}
                                effectiveTenure={computation.effectivePurchaseTenure}
                                ageCap={AGE_CAP_PURCHASE}
                                defaultLabel="max tenure"
                                stressInstallment={computation.purchaseStressInstallment}
                                loanEligibility={computation.purchaseLoanEligibility}
                                pass={computation.purchaseTdsrPass}
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
                        <div className="space-y-4">
                            <TdsrBlock
                                title="Refinancing (Priority)"
                                tenureMin={computation.refiTenureMin}
                                tenureMax={computation.refiTenureMax}
                                effectiveTenure={computation.effectiveRefiTenure}
                                ageCap={AGE_CAP_REFI}
                                defaultLabel="max tenure"
                                stressInstallment={computation.refiStressInstallment}
                                loanEligibility={computation.refiLoanEligibility}
                                pass={computation.refiTdsrPass}
                                onTenureChange={v => update({ preferred_tenure_refi: v })}
                                preferredTenure={data.preferred_tenure_refi}
                            />

                            {/* Balance after refi */}
                            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                                <div>
                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Balance for Purchase</p>
                                    <p className="text-base font-bold text-[#052d4a]">{money(computation.balanceTdsrForPurchase)}/mo</p>
                                    <p className="text-[11px] text-slate-400">Available TDSR − Refi instalment</p>
                                </div>
                            </div>

                            <TdsrBlock
                                title="New Purchase Loan"
                                tenureMin={computation.purchaseTenureMin}
                                tenureMax={computation.purchaseTenureMax}
                                effectiveTenure={computation.effectivePurchaseTenure}
                                ageCap={AGE_CAP_PURCHASE}
                                defaultLabel="max tenure"
                                stressInstallment={computation.purchaseStressInstallment}
                                loanEligibility={computation.purchaseLoanEligibility}
                                pass={computation.purchaseTdsrPass}
                                onTenureChange={v => update({ preferred_tenure_purchase: v })}
                                preferredTenure={data.preferred_tenure_purchase}
                            />

                            {/* S3 summary */}
                            {computation.tdsrOutcome && (
                                <TdsrSummaryS3
                                    outcome={computation.tdsrOutcome}
                                    propertyUse={data.property_use}
                                    equityLoanAmount={data.equity_loan_amount}
                                    refiPledge={computation.refiPledge}
                                    purchasePledge={computation.purchasePledge}
                                />
                            )}
                        </div>
                    )}
                </Section>
            )}

            {/* ── 8. EQUITY LOAN TDSR CHECK ── (only when client requested an equity loan) */}
            {showTdsr && (data.equity_loan_amount ?? 0) > 0 && (
                <Section title="Equity Loan — TDSR Check" icon={<Wallet size={15} />}>
                    <div className="rounded-lg border border-[#03a9e7]/20 bg-sky-50/40 px-4 py-3">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Remaining TDSR after all other loans</p>
                        <p className="text-xl font-bold text-[#052d4a]">
                            {money(computation.remainingTdsrAfterLoans)}<span className="text-sm font-normal text-slate-500">/month</span>
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">Available TDSR − refi − purchase instalments</p>
                    </div>

                    <TdsrBlock
                        title={`Equity Loan (${money(data.equity_loan_amount ?? 0)} requested)`}
                        tenureMin={computation.equityTenureMin}
                        tenureMax={computation.equityTenureMax}
                        effectiveTenure={computation.effectiveEquityTenure}
                        ageCap={AGE_CAP_REFI}
                        defaultLabel="current tenure"
                        stressInstallment={computation.equityStressInstallment}
                        loanEligibility={computation.equityLoanEligibility}
                        pass={computation.equityTdsrPass}
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
                </Section>
            )}

            {/* ── 9. SELLER'S PERSPECTIVE ── */}
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

// ─── TDSR Block (reusable for refi & purchase) ────────────────────────────────

function TdsrBlock({
    title, tenureMin, tenureMax, effectiveTenure, ageCap, defaultLabel,
    stressInstallment, loanEligibility, pass,
    onTenureChange, preferredTenure,
}: {
    title: string
    tenureMin: number
    tenureMax: number
    effectiveTenure: number
    ageCap: number
    defaultLabel: string
    stressInstallment: number
    loanEligibility: number
    pass: boolean
    onTenureChange: (v: number | undefined) => void
    preferredTenure?: number
}) {
    return (
        <div className="rounded-lg border border-slate-200 p-4 space-y-3">
            <p className="text-xs font-bold text-[#052d4a] uppercase tracking-wide">{title}</p>

            <div className="space-y-2">
                <div className="flex items-center gap-4 text-sm">
                    <span className="text-slate-500">Tenure range:</span>
                    <span className="font-semibold text-[#052d4a]">{tenureMin} – {tenureMax} yrs</span>
                    <span className="text-[11px] text-slate-400">(to age {ageCap})</span>
                </div>
                <div className="flex items-center gap-3">
                    <input
                        type="number" min={tenureMin} max={tenureMax}
                        value={preferredTenure ?? ''}
                        placeholder={`${effectiveTenure} (${defaultLabel})`}
                        onChange={e => {
                            const v = parseInt(e.target.value, 10)
                            onTenureChange(isNaN(v) ? undefined : Math.max(tenureMin, Math.min(tenureMax, v)))
                        }}
                        className="w-24 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12"
                    />
                    <span className="text-xs text-slate-500">years (using {effectiveTenure} yrs)</span>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                    <p className="text-[11px] text-slate-500">Stress Instalment (4%)</p>
                    <p className="text-sm font-bold text-[#052d4a]">{money(stressInstallment)}/mo</p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                    <p className="text-[11px] text-slate-500">Est. Loan Eligibility</p>
                    <p className="text-sm font-bold text-[#052d4a]">{money(loanEligibility)}</p>
                </div>
            </div>

            <div className={`rounded-lg border px-3 py-2.5 flex items-center gap-2 ${pass ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                {pass
                    ? <><CheckCircle2 size={14} className="text-emerald-600" /><span className="text-sm font-bold text-emerald-700">TDSR Pass</span></>
                    : <><AlertTriangle size={14} className="text-red-500" /><span className="text-sm font-bold text-red-600">TDSR Fail</span></>
                }
            </div>
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
                <div className="rounded-lg border border-amber-300 bg-amber-100/60 px-3 py-2.5 space-y-1">
                    <p className="text-[11px] font-semibold text-amber-900">
                        Loan shortfall: {money(pledge.shortfall)}
                    </p>
                    <p className="text-[11px] text-amber-800">
                        <span className="font-semibold">Pledge {money(pledge.pledgeFund)}</span> (locked 4 yrs)
                        {' '}or <span className="font-semibold">Show {money(pledge.showFund)}</span> in funds.
                    </p>
                </div>
            )}
        </div>
    )
}

// ─── S3 TDSR Summary ──────────────────────────────────────────────────────────

function TdsrSummaryS3({ outcome, propertyUse, equityLoanAmount, refiPledge, purchasePledge }: {
    outcome: TdsrOutcome
    propertyUse?: string
    equityLoanAmount?: number
    refiPledge:     DecouplePledge | null
    purchasePledge: DecouplePledge | null
}) {
    if (outcome === 'both_pass') {
        return (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                <p className="text-[13px] text-emerald-800 font-medium">
                    TDSR passes for both refinancing and new purchase loan.
                </p>
            </div>
        )
    }

    return (
        <div className="space-y-2">
            {outcome === 'both_fail' && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                    <AlertTriangle size={13} className="text-red-500 shrink-0 mt-0.5" />
                    <p className="text-[12px] text-red-800">TDSR fails on both refinancing and new purchase loan.</p>
                </div>
            )}
            {outcome === 'refi_pass_purchase_fail' && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-[12px] text-amber-800">Refinancing passes — new purchase loan fails TDSR.</p>
                </div>
            )}
            <TdsrRemedy
                propertyUse={propertyUse}
                equityLoanAmount={equityLoanAmount}
                pledge={outcome === 'both_fail' ? refiPledge : purchasePledge}
            />
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

function PillSelect({ value, onChange, options }: {
    value?: string
    onChange: (v: string) => void
    options: { value: string; label: string }[]
}) {
    return (
        <div className="flex flex-wrap gap-2">
            {options.map(o => (
                <button key={o.value} type="button" onClick={() => onChange(o.value)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                        value === o.value
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
                    className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                        value === v
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
    label: string; value: string; hint?: string; highlight?: boolean; valueClass?: string
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
