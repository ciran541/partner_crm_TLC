'use client'

import { ReactNode, useMemo, useState } from 'react'
import type { DecoupleWorkflow, DecoupleBorrower } from '@/lib/types/workflow'
import {
    computeDecouple,
    inputsFromDecoupleWorkflow,
    DECOUPLE_PROPERTY_TYPES,
    SUBSIDY_PRESETS,
    DEFAULT_REFERENCE_RATE,
    MIN_TENURE,
    type DecouplePropertyType,
} from '@/lib/insurance/decoupleCalc'
import { Question, FieldInput } from '@/components/insurance/workflow/WorkflowStep'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import {
    Home, CheckCircle2, AlertTriangle, Info, Save, Wallet,
    ArrowRight, ExternalLink, Users, Building2, Percent,
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
const num   = (v: string) => (v.trim() === '' ? undefined : parseFloat(v.replace(/,/g, '')))

export default function DecouplingWorkflowPanel({
    data, onChange, clientName, embedded, saving, saved, hasClientName, onContinue,
}: Props) {
    const update = (patch: Partial<DecoupleWorkflow>) => onChange({ ...data, ...patch })
    const [customSubsidy, setCustomSubsidy] = useState(
        data.subsidy_return_amount != null && !SUBSIDY_PRESETS.includes(String(data.subsidy_return_amount)),
    )

    const computation = useMemo(() => computeDecouple(inputsFromDecoupleWorkflow(data)), [data])

    const sellerPct   = 100 - (data.buyer_share ?? 50)
    const buyerPctStr = `${data.buyer_share ?? ''}%`
    const sellerPctStr = `${sellerPct}%`

    // Borrowers
    const defaultBorrower: DecoupleBorrower = { employment: 'employed' }
    const borrowers = data.borrowers ?? [defaultBorrower]
    const setBorrowerCount = (n: 1 | 2 | 3 | 4) => {
        update({ borrowers: Array.from({ length: n }, (_, i) => borrowers[i] ?? defaultBorrower) })
    }
    const updateBorrower = (i: number, patch: Partial<DecoupleBorrower>) => {
        const next = borrowers.map((b, idx) => idx === i ? { ...b, ...patch } : b)
        update({ borrowers: next })
    }

    const isBuc = data.property_type === 'incompleted_condo_ec'

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

            {/* ── PROPERTY DETAILS ── */}
            <Section title="Property Details" icon={<Home size={15} />}>
                <Question label="Property Type" required>
                    <PillSelect
                        value={data.property_type}
                        onChange={v => update({ property_type: v as DecouplePropertyType, outstanding_undisbursed: undefined })}
                        options={DECOUPLE_PROPERTY_TYPES.map(p => ({ value: p.value, label: p.label }))}
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
                        For exact SSD computation, check{' '}
                        <a href="https://www.iras.gov.sg/taxes/stamp-duty/for-property/selling-or-disposing-property/seller's-stamp-duty-(ssd)-for-residential-property"
                            target="_blank" rel="noopener noreferrer"
                            className="text-[#03a9e7] underline inline-flex items-center gap-0.5">
                            IRAS website <ExternalLink size={10} />
                        </a>
                    </p>
                </Question>

                <Question label="Property Use" required>
                    <PillSelect
                        value={data.property_use}
                        onChange={v => update({ property_use: v as 'own_stay' | 'investment' })}
                        options={[
                            { value: 'own_stay',   label: 'Own-Stay' },
                            { value: 'investment', label: 'Investment' },
                        ]}
                    />
                </Question>
            </Section>

            {/* ── OWNERSHIP SPLIT ── */}
            <Section title="Ownership Split" icon={<Users size={15} />}>
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
            </Section>

            {/* ── BUYER PROFILE ── */}
            <Section title="Buyer Profile" icon={<Wallet size={15} />}>
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
                            Buyer pays for seller's share in cash / CPF only. Existing loan is refinanced on buyer's name.
                        </p>
                    )}
                    {data.requires_financing === true && (
                        <p className="text-[11px] text-slate-400 flex items-start gap-1.5 mt-1">
                            <Info size={11} className="mt-0.5 shrink-0" />
                            Buyer takes a new 75% LTV loan on the seller's share, on top of existing loan liability.
                        </p>
                    )}
                </Question>

                {/* Income — always shown for TDSR */}
                <div className="border-t border-slate-100 pt-4 space-y-4">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Borrower Income — for TDSR
                    </p>
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
                            <Question label="Employment">
                                <PillSelect
                                    value={b.employment ?? 'employed'}
                                    onChange={v => updateBorrower(i, { employment: v as DecoupleBorrower['employment'] })}
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
                                            onChange={v => updateBorrower(i, { basic_salary: num(v) })} />
                                    </Question>
                                )}
                                <Question label={b.employment === 'self_employed' ? 'Annual Income (NOA)' : 'Annual Bonus / Variable'}>
                                    <FieldInput commas prefix="$" value={b.annual_variable ?? ''}
                                        onChange={v => updateBorrower(i, { annual_variable: num(v) })} />
                                </Question>
                                <Question label="Age">
                                    <FieldInput type="number" value={b.age ?? ''}
                                        onChange={v => updateBorrower(i, { age: num(v) })} />
                                </Question>
                                <Question label="Monthly Commitments (excl. property)">
                                    <FieldInput commas prefix="$" value={b.commitments ?? ''} placeholder="car, credit cards…"
                                        onChange={v => updateBorrower(i, { commitments: num(v) })} />
                                </Question>
                            </div>
                        </div>
                    ))}
                    {computation.weightedAge != null && (
                        <div className="flex items-center gap-4 rounded-lg bg-sky-50/50 border border-[#03a9e7]/15 px-4 py-3">
                            <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">IWAA</p>
                                <p className="text-base font-bold text-[#052d4a]">{computation.weightedAge} yrs</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Gross Monthly Income</p>
                                <p className="text-base font-bold text-[#052d4a]">{money(computation.grossMonthlyIncome)}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Max Loan Tenure</p>
                                <p className="text-base font-bold text-[#052d4a]">
                                    {data.requires_financing ? (computation.tenureSingle ?? '—') : computation.maxTenure} yrs
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </Section>

            {/* ── MORTGAGE DETAILS ── */}
            <Section title="Mortgage Details" icon={<Building2 size={15} />}>
                <Question label="Is the property fully paid?" required>
                    <YesNo value={data.fully_paid} onChange={v => update({ fully_paid: v })} />
                </Question>

                {data.fully_paid === false && (
                    <>
                        <Question label="Outstanding Loan Amount (Disbursed)">
                            <FieldInput commas prefix="$" value={data.outstanding_disbursed ?? ''}
                                onChange={v => update({ outstanding_disbursed: num(v) })} />
                        </Question>

                        {isBuc && (
                            <div className="space-y-1.5">
                                <Question label="Outstanding Loan Amount (Undisbursed)">
                                    <FieldInput commas prefix="$" value={data.outstanding_undisbursed ?? ''} placeholder="New launch without CSC only"
                                        onChange={v => update({ outstanding_undisbursed: num(v) })} />
                                </Question>
                                {(data.outstanding_undisbursed ?? 0) > 0 && (
                                    <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                                        <Info size={11} className="text-[#03a9e7] shrink-0" />
                                        Est. cancellation fee: <span className="font-semibold">{money(computation.cancellationFee)}</span>
                                        <span className="text-slate-400">(undisbursed × 0.75%)</span>
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Question label="Current Bank">
                                <InsuranceBankDropdown
                                    value={data.current_bank ?? ''}
                                    onChange={v => update({ current_bank: v })}
                                    showHdb={data.property_type === 'hdb'}
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

                        <Question label="Do you need to return any subsidy to current bank?">
                            <div className="flex flex-wrap gap-2">
                                {SUBSIDY_PRESETS.map(p => (
                                    <button key={p} type="button"
                                        onClick={() => { setCustomSubsidy(false); update({ subsidy_return_amount: Number(p) }) }}
                                        className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                                            !customSubsidy && data.subsidy_return_amount === Number(p)
                                                ? 'bg-[#052d4a] border-[#052d4a] text-white'
                                                : 'bg-white border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7]'
                                        }`}>
                                        {p === '0' ? '$0' : `$${Number(p).toLocaleString()}`}
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

            {/* ── CPF DETAILS ── */}
            <Section title="CPF Details" icon={<Percent size={15} />}>
                <Question label="Seller's CPF Usage on Property (Refund to OA)">
                    <FieldInput commas prefix="$" value={data.seller_cpf_usage ?? ''} placeholder="0"
                        onChange={v => update({ seller_cpf_usage: num(v) })} />
                </Question>
                <Question label="Buyer's CPF Used on Property">
                    <FieldInput commas prefix="$" value={data.buyer_cpf_usage ?? ''} placeholder="0"
                        onChange={v => update({ buyer_cpf_usage: num(v) })} />
                </Question>
                <Question label="Buyer's CPF OA Balance (Available)">
                    <FieldInput commas prefix="$" value={data.buyer_cpf_oa_balance ?? ''} placeholder="0"
                        onChange={v => update({ buyer_cpf_oa_balance: num(v) })} />
                </Question>
            </Section>

            {/* ── RESULTS ── */}
            {computation.ready && (
                <>
                    {/* ── BUYER'S PERSPECTIVE ── */}
                    <div className="rounded-xl border border-[#03a9e7]/30 overflow-hidden shadow-sm">
                        <div className="px-5 py-4 bg-sky-50/70 border-b border-[#03a9e7]/15">
                            <p className="text-sm font-bold text-[#052d4a]">Buyer's Perspective</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Acquiring {sellerPctStr} share — property value {money(data.property_valuation ?? 0)}
                            </p>
                        </div>

                        <div className="px-5 py-5 space-y-5">
                            {/* Header summary */}
                            <div className="grid grid-cols-2 gap-3">
                                <Stat label={`Property Share (${buyerPctStr} of Valuation)`} value={money(computation.buyerShareFrac * (data.property_valuation ?? 0))} />
                                <Stat label={`Loan Liability (${buyerPctStr} of Loan)`} value={money(computation.buyerLoanLiability)}
                                    hint="Applicable to non-borrower" />
                            </div>

                            {/* Breakdown — path-dependent */}
                            <div className="border-t border-slate-100 pt-4 space-y-2">
                                <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">Breakdown</p>
                                <Row label={`Purchase of Part Share (${sellerPctStr} Share)`} value={money(computation.purchasePrice)} highlight />

                                {data.requires_financing === false && (
                                    <>
                                        <Row label="Cash" value={money(computation.cashRequired)} />
                                        <Row label={`CPF (as per CPF OA Balance)`} value={money(computation.cpfUsedForPurchase)} />
                                        <div className="border-t border-dashed border-slate-200 my-1" />
                                        <Row label={`Refinanced Loan Amount (${pct(computation.loanPct)})`} value={money(computation.loanForStructure)} />
                                        <Row label={`Total CPF Used (${pct(computation.cpfPct)})`} value={money(computation.totalCpfUsed)} />
                                    </>
                                )}

                                {data.requires_financing === true && (
                                    <>
                                        <Row label="5% Cash" value={money(computation.cash5)} />
                                        <Row label="20% CPF / Cash" value={money(computation.cpfCash20)} />
                                        <Row label="75% Bank Loan" value={money(computation.bankLoan75)} />
                                        <div className="border-t border-dashed border-slate-200 my-1" />
                                        <Row label={`New Total Loan (${pct(computation.loanPct)})`} value={money(computation.loanForStructure)} />
                                        <Row label={`Total CPF Used (${pct(computation.cpfPct)})`} value={money(computation.totalCpfUsed)} />
                                    </>
                                )}

                                {data.requires_financing === undefined && (
                                    <p className="text-xs text-slate-400 italic">Select financing option above to see breakdown.</p>
                                )}
                            </div>

                            {/* Buyer stamp duty & fees */}
                            {data.requires_financing !== undefined && (
                                <div className="border-t border-slate-100 pt-4 space-y-2">
                                    <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">Est. Misc Fees</p>
                                    <Row label="Buyer's Stamp Duty (BSD)" value={money(computation.bsd)} />
                                    {computation.absd > 0 && (
                                        <Row label={`Additional Buyer's Stamp Duty (${computation.absdRatePct}%)`} value={money(computation.absd)} />
                                    )}
                                    <Row label="Legal Fee (Cash / CPF)" value={`${money(computation.buyerLegalFee)} +/-`} />
                                </div>
                            )}

                            {/* Ownership structure diagram */}
                            {data.requires_financing !== undefined && (
                                <div className="border-t border-slate-100 pt-4 space-y-3">
                                    <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">
                                        Single Ownership Structure
                                    </p>
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
                            )}

                            {/* Equity availability */}
                            {data.requires_financing !== undefined && (
                                <div className="border-t border-slate-100 pt-4 space-y-3">
                                    <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">Available Equity</p>

                                    <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3 space-y-1">
                                        <p className="text-xs text-slate-500">
                                            75% − {pct(computation.loanPct)} (loan) − {pct(computation.cpfPct)} (CPF)
                                            {' '}= <span className={`font-bold ${computation.equityPct > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                                                {pct(computation.equityPct)}
                                            </span>
                                        </p>
                                        {computation.equityPct > 0 && (
                                            <p className="text-sm font-semibold text-[#052d4a]">
                                                Available Equity: {money(computation.availableEquity)}
                                            </p>
                                        )}
                                    </div>

                                    {computation.equityNotEligibleReason ? (
                                        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                                            <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
                                            <p className="text-[12px] text-amber-800">{computation.equityNotEligibleReason}</p>
                                        </div>
                                    ) : computation.equityEligible && (
                                        <div className="space-y-2">
                                            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                                                <CheckCircle2 size={13} className="text-emerald-600 shrink-0 mt-0.5" />
                                                <p className="text-[12px] text-emerald-800">
                                                    Eligible for equity loan — max {money(computation.availableEquity)}
                                                </p>
                                            </div>
                                            <Question label="Would you like to take up an equity loan?">
                                                <FieldInput commas prefix="$"
                                                    value={data.equity_loan_amount ?? ''}
                                                    placeholder={`max ${money(computation.availableEquity)}`}
                                                    onChange={v => {
                                                        const n = num(v)
                                                        update({ equity_loan_amount: n !== undefined ? Math.min(n, computation.availableEquity) : undefined })
                                                    }} />
                                            </Question>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Tenure — path-dependent */}
                            {data.requires_financing !== undefined && (
                                <div className="border-t border-slate-100 pt-4 space-y-3">
                                    <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">Tenure</p>

                                    {data.requires_financing === false && (
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-4 rounded-lg bg-sky-50/50 border border-[#03a9e7]/15 px-4 py-3">
                                                <div>
                                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Min</p>
                                                    <p className="text-base font-bold text-[#052d4a]">{MIN_TENURE} yrs</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Max</p>
                                                    <p className="text-base font-bold text-[#052d4a]">{computation.maxTenure} yrs</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Preferred</p>
                                                    <p className="text-base font-bold text-[#052d4a]">{computation.effectiveTenure} yrs</p>
                                                </div>
                                            </div>
                                            <div>
                                                <p className="text-xs font-semibold text-slate-600 mb-1.5">
                                                    Preferred Tenure
                                                    <span className="font-normal text-slate-400 ml-1.5">
                                                        ({MIN_TENURE}–{computation.maxTenure} yrs · default: current tenure)
                                                    </span>
                                                </p>
                                                <div className="flex items-center gap-3">
                                                    <input type="number" min={MIN_TENURE} max={computation.maxTenure}
                                                        value={data.preferred_tenure ?? data.current_tenure ?? ''}
                                                        placeholder={String(data.current_tenure ?? computation.maxTenure)}
                                                        onChange={e => {
                                                            const v = parseInt(e.target.value, 10)
                                                            update({ preferred_tenure: isNaN(v) ? undefined : Math.max(MIN_TENURE, Math.min(computation.maxTenure, v)) })
                                                        }}
                                                        className="w-24 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12" />
                                                    <span className="text-xs text-slate-500">years</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {data.requires_financing === true && computation.tenureSingle != null && (
                                        <div className="flex items-center gap-4 rounded-lg bg-sky-50/50 border border-[#03a9e7]/15 px-4 py-3">
                                            <div>
                                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Tenure</p>
                                                <p className="text-base font-bold text-[#052d4a]">{computation.tenureSingle} yrs</p>
                                                <p className="text-[10px] text-slate-400">65 − IWAA</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Monthly Instalment</p>
                                                <p className="text-lg font-bold text-[#052d4a]">{money(computation.monthlyInstallment)}</p>
                                            </div>
                                        </div>
                                    )}

                                    {data.requires_financing === true && (
                                        <div className="flex items-center gap-2 text-xs text-slate-500">
                                            <span>Est. instalment at</span>
                                            <input type="number" step="0.05"
                                                value={data.reference_rate ?? ''}
                                                placeholder={`${DEFAULT_REFERENCE_RATE}`}
                                                onChange={e => update({ reference_rate: num(e.target.value) })}
                                                className="w-16 px-2 py-1 rounded-md border border-slate-200 bg-white text-center font-medium text-slate-700 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12" />
                                            <span>% p.a.</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* TDSR */}
                            {data.requires_financing !== undefined && computation.grossMonthlyIncome > 0 && (
                                <div className="border-t border-slate-100 pt-4 space-y-3">
                                    <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">TDSR Assessment</p>

                                    <div className="grid grid-cols-2 gap-3">
                                        <Stat label="Est. Loan Eligibility" value={money(computation.estLoanEligibility)}
                                            hint="TDSR capacity — excl. property installment" />
                                        <div className={`rounded-lg border px-3 py-2.5 ${computation.tdsrPass ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                                            <p className="text-[11px] text-slate-500 leading-tight">TDSR Result</p>
                                            <p className={`text-sm font-bold mt-0.5 ${computation.tdsrPass ? 'text-emerald-700' : 'text-red-600'}`}>
                                                {computation.tdsrPass ? 'Pass' : 'Fail'}
                                            </p>
                                            <p className="text-[10px] text-slate-400 mt-0.5">
                                                {computation.tdsrPct.toFixed(1)}% of income
                                            </p>
                                        </div>
                                    </div>

                                    {/* Remedies when TDSR fails */}
                                    {!computation.tdsrPass && (
                                        <TdsrRemedies
                                            propertyUse={data.property_use}
                                            hasEquityLoan={(data.equity_loan_amount ?? 0) > 0}
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── SELLER'S PERSPECTIVE ── */}
                    <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                        <div className="px-5 py-4 bg-slate-50 border-b border-slate-100">
                            <p className="text-sm font-bold text-[#052d4a]">Seller's Perspective</p>
                            <p className="text-xs text-slate-500 mt-0.5">Disposing {sellerPctStr} share</p>
                        </div>

                        <div className="px-5 py-5 space-y-5">
                            <div className="grid grid-cols-2 gap-3">
                                <Stat label={`Property Share (${sellerPctStr} of Valuation)`} value={money(computation.sellerShareFrac * (data.property_valuation ?? 0))} />
                                <Stat label={`Loan Liability (${sellerPctStr} of Loan)`} value={money(computation.sellerLoanLiability)}
                                    hint="Applicable to non-borrower" />
                            </div>

                            <div className="border-t border-slate-100 pt-4 space-y-2">
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Breakdown</p>
                                <Row label={`Sale of Part Share (${sellerPctStr} Share)`} value={money(computation.sellingPrice)} highlight />
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
                                    <Row label="Seller's Stamp Duty" value="$0" hint={
                                        computation.ssdRateTable === 'none'
                                            ? 'No SSD — past holding period'
                                            : 'No SSD at current holding period'
                                    } />
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

                    {/* Disclaimer */}
                    <p className="text-[11px] text-slate-400 leading-relaxed px-1">
                        All figures are estimates for discussion purposes only and do not constitute a formal bank approval.
                        Stamp duties follow prevailing IRAS rates — verify before committing.
                    </p>
                </>
            )}

            {!computation.ready && (
                <div className="card p-8 text-center text-sm text-slate-400">
                    Enter property valuation and ownership split above to see the decoupling breakdown.
                </div>
            )}

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

// ─── TDSR Remedies ────────────────────────────────────────────────────────────

function TdsrRemedies({ propertyUse, hasEquityLoan }: { propertyUse?: string; hasEquityLoan: boolean }) {
    const scenarios: { id: string; label: string; body: string }[] = []

    if (!propertyUse || propertyUse === 'own_stay') {
        scenarios.push({
            id: 'S1',
            label: 'Own-Stay — Refi + No Equity Loan',
            body: 'Qualifies for TDSR waiver with most banks — to double-check with banker.',
        })
        scenarios.push({
            id: 'S2',
            label: 'Own-Stay — Refi + With Equity Loan',
            body: 'Pledge funds (locked 4 years) or show funds as an alternative.',
        })
    }

    if (!propertyUse || propertyUse === 'investment') {
        scenarios.push({
            id: 'S3',
            label: 'Investment — Refi + No Equity Loan',
            body: 'Paydown 3% of outstanding loan and/or show funds to prove repayment ability — to double-check with banker.',
        })
        scenarios.push({
            id: 'S4',
            label: 'Investment — Refi + With Equity Loan',
            body: 'Pledge funds (locked 4 years) or show funds as an alternative.',
        })
    }

    return (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
            <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                <AlertTriangle size={13} /> Potential Remedies
            </p>
            <div className="space-y-2">
                {scenarios.map(s => (
                    <div key={s.id} className={`rounded-lg border px-3 py-2.5 ${
                        (hasEquityLoan && (s.id === 'S2' || s.id === 'S4')) || (!hasEquityLoan && (s.id === 'S1' || s.id === 'S3'))
                            ? 'border-amber-300 bg-amber-100/60'
                            : 'border-amber-200/60 bg-white/60'
                    }`}>
                        <p className="text-[11px] font-bold text-amber-900">{s.id}: {s.label}</p>
                        <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">{s.body}</p>
                    </div>
                ))}
            </div>
        </div>
    )
}

// ─── Ownership Bar ─────────────────────────────────────────────────────────────

function OwnershipBar({
    loanPct, cpfPct, cashPct, loanAmt, cpfAmt, cashAmt,
}: { loanPct: number; cpfPct: number; cashPct: number; loanAmt: number; cpfAmt: number; cashAmt: number }) {
    const lP = Math.max(0, Math.round(loanPct * 1000) / 10)
    const cP = Math.max(0, Math.round(cpfPct  * 1000) / 10)
    const aP = Math.max(0, Math.round(cashPct  * 1000) / 10)

    return (
        <div className="space-y-2">
            <div className="flex h-6 rounded-lg overflow-hidden text-[10px] font-bold text-white">
                {lP > 0 && (
                    <div className="flex items-center justify-center bg-[#052d4a]" style={{ width: `${lP}%` }}>
                        {lP > 8 ? `${lP}%` : ''}
                    </div>
                )}
                {cP > 0 && (
                    <div className="flex items-center justify-center bg-[#03a9e7]" style={{ width: `${cP}%` }}>
                        {cP > 8 ? `${cP}%` : ''}
                    </div>
                )}
                {aP > 0 && (
                    <div className="flex items-center justify-center bg-emerald-500" style={{ width: `${aP}%` }}>
                        {aP > 8 ? `${aP}%` : ''}
                    </div>
                )}
            </div>
            <div className="flex flex-wrap gap-3 text-[11px]">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#052d4a]" /> Loan ({lP}% · {money(loanAmt)})</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#03a9e7]" /> CPF ({cP}% · {money(cpfAmt)})</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Cash ({aP}% · {money(Math.max(0, cashAmt))})</span>
            </div>
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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
            <p className="text-[11px] text-slate-500 leading-tight">{label}</p>
            <p className="text-sm font-bold text-[#052d4a] mt-0.5">{value}</p>
            {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
        </div>
    )
}

function Row({
    label, value, hint, highlight, valueClass,
}: { label: string; value: string; hint?: string; highlight?: boolean; valueClass?: string }) {
    return (
        <div className={`flex items-start justify-between gap-3 text-sm ${highlight ? 'py-1' : ''}`}>
            <span className={`text-slate-600 leading-snug ${highlight ? 'font-semibold text-slate-700' : ''}`}>{label}</span>
            <div className="text-right shrink-0">
                <span className={valueClass ?? (highlight ? 'font-bold text-[#052d4a]' : 'font-semibold text-slate-700')}>
                    {value}
                </span>
                {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
            </div>
        </div>
    )
}
