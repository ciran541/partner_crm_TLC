'use client'

import { ReactNode, useEffect, useMemo, useState } from 'react'
import type { EquityLoanWorkflow, ELPropertyType, RefiBorrower } from '@/lib/types/workflow'
import { effectiveMonthlyIncome, monthlyInstallment, maxLoanFromPayment, STRESS_TEST_RATE } from '@/lib/insurance/loanCalc'
import { computeAmortization } from '@/lib/insurance/amortCalc'
import { type RateScheduleEntry } from '@/lib/types/rates'
import type { RecommendedPackage } from '@/lib/insurance/rateRecommend'
import type { SoraRates } from '@/lib/insurance/sora'
import { Question, FieldInput } from '@/components/insurance/workflow/WorkflowStep'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import RefiPackages from './RefiPackages'
import {
    Building2, CheckCircle2, AlertTriangle, Info, Save,
    Wallet, ArrowRight, CalendarRange, Percent, Lock, Plus, Trash2,
} from 'lucide-react'

// ─── Property type catalogue ──────────────────────────────────────────────────

const EL_PROPERTY_TYPES = [
    { value: 'landed' as const,           label: 'Landed',                        ratesType: 'landed' as const },
    { value: 'completed_condo' as const,  label: 'Completed Condo',               ratesType: 'private_condo' as const },
    { value: 'completed_ec_mop' as const, label: 'Completed EC (MOP obtained)',   ratesType: 'private_condo' as const },
]

function elPropertyMeta(type?: ELPropertyType | null) {
    return EL_PROPERTY_TYPES.find(p => p.value === type)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const money = (n: number) => `$${Math.floor(n).toLocaleString()}`
const num = (v: string) => (v.trim() === '' ? undefined : parseFloat(v.replace(/,/g, '')))
const pct = (frac: number, dp = 1) => `${(frac * 100).toFixed(dp)}%`

const SUBSIDY_PRESETS = ['0', '2000', '2500']

interface Props {
    data: EquityLoanWorkflow
    onChange: (updated: EquityLoanWorkflow) => void
    clientName?: string
    caseId?: string
    embedded?: boolean
    saving?: boolean
    saved?: boolean
    hasClientName?: boolean
    onContinue?: () => void
}

export default function EquityLoanWorkflowPanel({
    data, onChange, clientName, embedded, saving, saved, hasClientName, onContinue,
}: Props) {
    const update = (patch: Partial<EquityLoanWorkflow>) => onChange({ ...data, ...patch })

    const [customSubsidy, setCustomSubsidy] = useState(
        data.subsidy_return_amount != null && !SUBSIDY_PRESETS.includes(String(data.subsidy_return_amount)),
    )
    const [soraForAmort, setSoraForAmort] = useState<SoraRates | null>(null)
    const [rawRefiTenure, setRawRefiTenure] = useState('')
    const [rawEquityNewTenure, setRawEquityNewTenure] = useState('')
    const [rawEquityAmortT1, setRawEquityAmortT1] = useState('')
    const [rawEquityAmortT2, setRawEquityAmortT2] = useState('')
    const [preferredEquityAmortTenure2, setPreferredEquityAmortTenure2] = useState<number | undefined>()
    const [showCompare, setShowCompare] = useState(false)
    const [estEligTenure, setEstEligTenure] = useState<number | undefined>()
    const [estEligDraft, setEstEligDraft] = useState('')

    useEffect(() => {
        fetch('/api/insurance/rates')
            .then(r => r.json())
            .then(d => { if (d.sora) setSoraForAmort(d.sora) })
            .catch(() => {})
    }, [])

    // ── Borrowers ──
    const borrowers: RefiBorrower[] = Array.from({ length: 4 }, (_, i) => data.borrowers?.[i] ?? {})
    const updateBorrower = (i: number, patch: Partial<RefiBorrower>) => {
        const next = borrowers.map((b, idx) => idx === i ? { ...b, ...patch } : b)
        update({ borrowers: next })
    }
    const agedBorrowers = borrowers.map((b, i) => ({ b, i })).filter(({ b }) => (b.age ?? 0) > 0)

    // Average age (simple average of borrowers with age)
    const averageAge = agedBorrowers.length > 0
        ? agedBorrowers.reduce((s, { b }) => s + (b.age ?? 0), 0) / agedBorrowers.length
        : null

    // Equity loan tenure cap (by age)
    const equityTenureMax = averageAge != null ? Math.max(5, Math.min(35, Math.floor(75 - averageAge))) : 35
    const equityTenureMin = 5

    // ── Income for TDSR ──
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

    // ── Equity calculation ──
    const totalHomeLoan = (data.outstanding_disbursed ?? 0) + (data.outstanding_equity_loan ?? 0)
    const valuation = data.market_price ?? 0
    const cpfUsed = data.cpf_used ?? 0
    const loanPctOfVal = valuation > 0
        ? (data.fully_paid ? 0 : totalHomeLoan) / valuation
        : 0
    const cpfPct = valuation > 0 ? cpfUsed / valuation : 0
    const equityPct = Math.max(0, 0.75 - loanPctOfVal - cpfPct)
    const equityAmt = equityPct * valuation
    const equityEligible = equityAmt >= 50_000
    const cashPct = Math.max(0, 1 - loanPctOfVal - cpfPct)

    // ── Package selection ──
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
            },
        })
    }
    const selectedPkgId = (data.selected_package_snapshot?.id as string) ?? undefined

    // ── Rate schedule ──
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

    const meta = elPropertyMeta(data.property_type)
    const subsidyValue = data.subsidy_return_amount
    const notFullyPaid = data.fully_paid === false

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-lg font-bold text-[#052d4a] flex items-center gap-2">
                        <Building2 size={18} className="text-[#03a9e7]" /> Equity Loan — Eligibility & Advice
                    </h2>
                    <p className="text-sm text-slate-500">
                        {clientName ? <>Advising <span className="font-medium text-slate-700">{clientName}</span>. </> : null}
                        Capture only what applies — equity, TDSR and packages update live.
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
                        onChange={v => update({ property_type: v as ELPropertyType })}
                        options={EL_PROPERTY_TYPES.map(p => ({ value: p.value, label: p.label }))}
                    />
                </Question>

                {data.property_type && (
                    <>
                        <Question label="Is this property fully paid?">
                            <YesNo value={data.fully_paid} onChange={v => {
                                const patch: Partial<EquityLoanWorkflow> = { fully_paid: v }
                                if (v) {
                                    // Clear current-loan fields when marking fully paid
                                    patch.outstanding_disbursed = undefined
                                    patch.outstanding_equity_loan = undefined
                                    patch.current_bank = undefined
                                    patch.lockin_end_date = undefined
                                    patch.current_rate = undefined
                                    patch.subsidy_return_amount = undefined
                                    patch.current_tenure = undefined
                                    patch.current_equity_loan_tenure = undefined
                                }
                                update(patch)
                            }} />
                        </Question>

                        <Question label="Total CPF accrued by all owner(s)">
                            <FieldInput commas prefix="$" value={data.cpf_used ?? ''} placeholder="e.g. 100,000"
                                onChange={v => update({ cpf_used: num(v) })} />
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
                    </>
                )}
            </Section>

            {/* ── Current Loan (only when not fully paid) ── */}
            {notFullyPaid && (
                <Section title="Current Loan" icon={<Wallet size={15} />}>
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

                    {(() => {
                        const total = totalHomeLoan
                        const cap = valuation * 0.75
                        if (!valuation || total === 0 || total <= cap) return null
                        return (
                            <p className="text-[11px] text-amber-600 flex items-center gap-1.5">
                                <AlertTriangle size={12} /> Total outstanding ({money(total)}) exceeds 75% of valuation ({money(cap)}). Please verify the figures.
                            </p>
                        )
                    })()}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Question label="Current Bank">
                            <InsuranceBankDropdown value={data.current_bank ?? ''} onChange={v => update({ current_bank: v })} showHdb={false} />
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
                        <Question label="Current Home Loan Tenure (remaining years)">
                            <FieldInput type="number" value={data.current_tenure ?? ''} placeholder="e.g. 20"
                                onChange={v => update({ current_tenure: num(v) })}
                                onBlur={() => {
                                    if (data.current_tenure != null)
                                        update({ current_tenure: Math.max(5, Math.min(35, data.current_tenure)) })
                                }} />
                            {data.current_tenure != null && (data.current_tenure < 5 || data.current_tenure > 35) ? (
                                <p className="text-[11px] text-red-500 mt-1">Must be 5 – 35 years</p>
                            ) : (
                                <p className="text-[11px] text-slate-400 mt-1">5 – 35 years</p>
                            )}
                        </Question>
                        {(data.outstanding_equity_loan ?? 0) > 0 && (
                            <Question label="Current Equity Loan Tenure (remaining years)">
                                <FieldInput type="number" value={data.current_equity_loan_tenure ?? ''} placeholder="e.g. 10"
                                    onChange={v => update({ current_equity_loan_tenure: num(v) })}
                                    onBlur={() => {
                                        if (data.current_equity_loan_tenure != null)
                                            update({ current_equity_loan_tenure: Math.max(5, Math.min(35, data.current_equity_loan_tenure)) })
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
                            <CheckRow label="Sell" checked={!!data.considerations?.sell}
                                onToggle={() => update({ considerations: { ...data.considerations, sell: !data.considerations?.sell } })} />
                            <CheckRow label="Partial Pay" checked={!!data.considerations?.partial_pay}
                                onToggle={() => update({ considerations: { ...data.considerations, partial_pay: !data.considerations?.partial_pay } })} />
                            <CheckRow label="Decouple" checked={!!data.considerations?.decouple}
                                onToggle={() => update({ considerations: { ...data.considerations, decouple: !data.considerations?.decouple } })} />
                        </div>
                    </Question>
                </Section>
            )}

            {/* ── Loan Structure & Available Equity ── */}
            {data.property_type && data.fully_paid != null && (() => {
                const displayLoan = data.fully_paid ? 0 : totalHomeLoan
                const cashAmt = cashPct * valuation
                const hasInputs = valuation > 0

                return (
                    <Section title="Loan Structure & Available Equity" icon={<Building2 size={15} />}>
                        {hasInputs ? (
                            <>
                                <div className="rounded-xl border border-[#03a9e7]/30 overflow-hidden">
                                    <div className="px-4 py-3 bg-sky-50/70 border-b border-[#03a9e7]/15">
                                        <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">Property Ownership Structure</p>
                                    </div>
                                    <div className="p-4 space-y-3">
                                        <OwnershipBar
                                            loanPct={loanPctOfVal}
                                            cpfPct={cpfPct}
                                            cashPct={cashPct}
                                            loanAmt={displayLoan}
                                            cpfAmt={cpfUsed}
                                            cashAmt={cashAmt}
                                        />
                                        <p className="text-[11px] text-slate-400">
                                            Based on market price {money(valuation)}.{displayLoan > 0 ? ` Loan = ${money(displayLoan)}.` : ' Property fully paid.'}
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <p className="text-xs font-bold text-[#03a9e7] uppercase tracking-wide">Available Equity</p>
                                    <p className="text-sm text-slate-600">
                                        75% − {pct(loanPctOfVal)} (loan) − {pct(cpfPct)} (CPF)
                                        {' '}= <span className={`font-bold ${equityPct > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{pct(equityPct)}</span>
                                    </p>
                                    {equityPct <= 0 ? (
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
                                            <Question label="Equity loan amount">
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
                            </>
                        ) : (
                            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                                <Info size={12} /> Enter market price above to see the property structure.
                            </p>
                        )}
                    </Section>
                )
            })()}

            {/* ── Borrowers & Age ── */}
            {data.property_type && (
                <Section title="Borrower(s) & Age" icon={<CalendarRange size={15} />}>
                    <Question label="Age of all borrower(s)">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {borrowers.map((b, i) => (
                                <div key={i}>
                                    <label className="text-[11px] text-slate-500">Borrower {i + 1}</label>
                                    <FieldInput type="number" value={b.age ?? ''} placeholder="0"
                                        onChange={v => updateBorrower(i, { age: num(v) })}
                                        onBlur={() => {
                                            if (b.age != null && b.age > 0) {
                                                if (b.age < 21) updateBorrower(i, { age: 21 })
                                                else if (b.age > 75) updateBorrower(i, { age: 75 })
                                            }
                                        }} />
                                </div>
                            ))}
                        </div>
                        {averageAge != null && (
                            <p className="text-[12px] text-slate-500 mt-2">
                                Average age: <span className="font-semibold text-[#052d4a]">{Math.ceil(averageAge)}</span>
                                {' '}· Max equity loan tenure: <span className="font-semibold text-[#052d4a]">{equityTenureMax} yrs</span>
                            </p>
                        )}
                    </Question>

                    {agedBorrowers.length > 0 && (
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
                    )}

                    {agedBorrowers.length === 0 && (
                        <p className="text-[12px] text-slate-400 flex items-center gap-1.5">
                            <Info size={12} /> Enter borrower age(s) above to capture income for TDSR assessment.
                        </p>
                    )}
                </Section>
            )}

            {/* ── TDSR Assessment ── */}
            {data.property_type && grossForTdsr != null && grossForTdsr > 0 && (() => {
                const availableTdsr = Math.max(grossForTdsr * 0.55 - debtsForTdsr, 0)

                // Est. Loan Eligibility
                const estEligMax = equityTenureMax
                const effectiveEstEligTenure = estEligTenure ?? estEligMax
                const estEligLoan = effectiveEstEligTenure > 0
                    ? maxLoanFromPayment(availableTdsr, STRESS_TEST_RATE * 100, effectiveEstEligTenure)
                    : 0

                // Home loan TDSR block (only if not fully paid + disbursed > 0)
                const homeLoan = notFullyPaid ? (data.outstanding_disbursed ?? 0) : 0
                const homeTenureMax = equityTenureMax
                const homeTenureMin = 5
                const homeTenure = data.preferred_tenure_refi != null
                    ? Math.max(homeTenureMin, Math.min(homeTenureMax, data.preferred_tenure_refi))
                    : homeTenureMax
                const homeStress = homeLoan > 0 && homeTenure > 0
                    ? monthlyInstallment(homeLoan, STRESS_TEST_RATE * 100, homeTenure)
                    : 0
                const homePass = homeStress > 0 ? homeStress <= availableTdsr : null

                // Outstanding equity loan TDSR block (only if not fully paid + equity outstanding > 0)
                const existingEquityLoan = notFullyPaid ? (data.outstanding_equity_loan ?? 0) : 0
                const existingEquityTenureMax = equityTenureMax
                const existingEquityTenureMin = 5
                const existingEquityTenure = existingEquityTenureMax
                const existingEquityStress = existingEquityLoan > 0 && existingEquityTenure > 0
                    ? monthlyInstallment(existingEquityLoan, STRESS_TEST_RATE * 100, existingEquityTenure)
                    : 0
                const balanceAfterHome = availableTdsr - homeStress
                const existingEquityPass = existingEquityStress > 0 ? existingEquityStress <= balanceAfterHome : null

                // New equity loan TDSR block
                const newEquityLoan = data.equity_loan_amount ?? 0
                const preferredEquityTenure = data.preferred_tenure_equity != null
                    ? Math.max(equityTenureMin, Math.min(equityTenureMax, data.preferred_tenure_equity))
                    : equityTenureMax
                const equityNewStress = newEquityLoan > 0 && preferredEquityTenure > 0
                    ? monthlyInstallment(newEquityLoan, STRESS_TEST_RATE * 100, preferredEquityTenure)
                    : 0
                const balanceAfterExisting = availableTdsr - homeStress - existingEquityStress
                const equityPass = newEquityLoan > 0 && equityNewStress > 0 ? equityNewStress <= balanceAfterExisting : null

                const pledgeFromShortfall = (shortfall: number, tenure: number) => {
                    if (shortfall <= 1 || tenure <= 0) return null
                    const r = STRESS_TEST_RATE / 12
                    const n = tenure * 12
                    const payment = shortfall * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
                    const pledgeFund = (payment * 48) / 0.55
                    const showFund = pledgeFund / 0.30
                    return pledgeFund > 1 ? { pledgeFund, showFund } : null
                }
                const homePledge = homePass === false
                    ? pledgeFromShortfall(Math.max(0, homeLoan - maxLoanFromPayment(availableTdsr, STRESS_TEST_RATE * 100, homeTenure)), homeTenure)
                    : null
                const equityNewPledge = equityPass === false
                    ? pledgeFromShortfall(Math.max(0, newEquityLoan - maxLoanFromPayment(Math.max(0, balanceAfterExisting), STRESS_TEST_RATE * 100, preferredEquityTenure)), preferredEquityTenure)
                    : null

                return (
                    <Section title="TDSR Assessment" icon={<Percent size={15} />}>
                        {/* Est. Loan Eligibility header */}
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
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Available TDSR</p>
                                <p className="text-xl font-bold text-[#052d4a]">{money(availableTdsr)}</p>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                    {money(grossForTdsr)} × 55%{debtsForTdsr > 0 ? ` − ${money(debtsForTdsr)} commitments` : ''}
                                    {averageAge != null ? ` · Age ${Math.ceil(averageAge)} yrs` : ''}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="flex-1 border-t border-slate-200" />
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">TDSR Breakdown</p>
                            <div className="flex-1 border-t border-slate-200" />
                        </div>

                        {/* Home Loan TDSR (not fully paid) */}
                        {homeStress > 0 && (
                            <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 space-y-3">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Home Loan</p>
                                        <p className="text-2xl font-bold text-[#052d4a]">{money(homeLoan)}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">TDSR Required</p>
                                        <p className="text-lg font-bold text-[#052d4a]">{money(homeStress)}</p>
                                        <p className="text-[11px] text-slate-400">at {homeTenure} yrs, 4% stress</p>
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <p className="text-[11px] text-slate-400">Tenure range: {homeTenureMin} – {homeTenureMax} yrs (to age 75)</p>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="number"
                                            value={rawRefiTenure !== '' ? rawRefiTenure : (data.preferred_tenure_refi != null ? String(data.preferred_tenure_refi) : '')}
                                            placeholder={String(homeTenureMax)}
                                            onChange={e => setRawRefiTenure(e.target.value)}
                                            onBlur={() => {
                                                const v = parseInt(rawRefiTenure, 10)
                                                setRawRefiTenure('')
                                                update({ preferred_tenure_refi: isNaN(v) ? undefined : Math.max(homeTenureMin, Math.min(homeTenureMax, v)) })
                                            }}
                                            className="w-20 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12"
                                        />
                                        <span className="text-xs text-slate-500">years — adjust to explore TDSR required</span>
                                    </div>
                                </div>
                                {homePass !== null && (
                                    <div className={`rounded-lg border px-3 py-2.5 flex items-center gap-2 ${homePass ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                                        {homePass
                                            ? <><CheckCircle2 size={14} className="text-emerald-600" /><span className="text-sm font-bold text-emerald-700">TDSR Pass</span></>
                                            : <><AlertTriangle size={14} className="text-red-500" /><span className="text-sm font-bold text-red-600">TDSR Fail</span>
                                                <span className="ml-auto text-[11px] font-semibold text-red-600">shortfall: {money(homeStress - availableTdsr)}</span></>
                                        }
                                    </div>
                                )}
                                {homePass === false && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
                                        <p className="text-[12px] font-semibold text-amber-800">Potential Remedies</p>
                                        <p className="text-[12px] text-amber-700 leading-relaxed">
                                            {data.property_use === 'investment'
                                                ? 'Bank will require client to pay down 3% of outstanding loan and/or show some funds to prove repayment ability.'
                                                : 'Client may qualify for TDSR Waiver with most banks — to double check with banker.'}
                                        </p>
                                        {homePledge && (
                                            <p className="text-[12px] text-amber-900">
                                                <span className="font-semibold">Pledge {money(homePledge.pledgeFund)}</span> (locked 4 yrs)
                                                {' '}or <span className="font-semibold">Show {money(homePledge.showFund)}</span> in funds.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Outstanding Equity Loan TDSR */}
                        {existingEquityStress > 0 && (
                            <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 space-y-3">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Outstanding Equity Loan</p>
                                        <p className="text-2xl font-bold text-[#052d4a]">{money(existingEquityLoan)}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">TDSR Required</p>
                                        <p className="text-lg font-bold text-[#052d4a]">{money(existingEquityStress)}</p>
                                        <p className="text-[11px] text-slate-400">at {existingEquityTenure} yrs, 4% stress</p>
                                    </div>
                                </div>
                                {existingEquityPass !== null && (
                                    <div className={`rounded-lg border px-3 py-2.5 flex items-center gap-2 ${existingEquityPass ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                                        {existingEquityPass
                                            ? <><CheckCircle2 size={14} className="text-emerald-600" /><span className="text-sm font-bold text-emerald-700">TDSR Pass</span></>
                                            : <><AlertTriangle size={14} className="text-red-500" /><span className="text-sm font-bold text-red-600">TDSR Fail</span>
                                                <span className="ml-auto text-[11px] font-semibold text-red-600">shortfall: {money(existingEquityStress - balanceAfterHome)}</span></>
                                        }
                                    </div>
                                )}
                            </div>
                        )}

                        {/* New Equity Loan TDSR */}
                        {newEquityLoan > 0 && (
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
                                    <p className="text-[11px] text-slate-400">Tenure range: {equityTenureMin} – {equityTenureMax} yrs</p>
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
                                                <span className="ml-auto text-[11px] font-semibold text-red-600">shortfall: {money(equityNewStress - balanceAfterExisting)}</span></>
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

                        {homeStress === 0 && newEquityLoan === 0 && (
                            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                                <Info size={12} /> Enter equity loan amount and borrower income to see TDSR breakdown.
                            </p>
                        )}

                        {/* Summary pledge/show */}
                        {(() => {
                            const entries = [
                                { label: 'Home Loan',      pledge: homePledge },
                                { label: 'New Equity Loan', pledge: equityNewPledge },
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

            {/* ── Rate Preference ── */}
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

            {/* ── Packages ── */}
            {(data.equity_loan_amount ?? 0) > 0 && data.property_type && (
                <RefiPackages
                    loan={data.equity_loan_amount!}
                    tenureYears={equityTenureMax}
                    propertyType={meta?.ratesType}
                    includeBuc={false}
                    preference={data.rate_preference ?? 'both'}
                    selectedId={selectedPkgId}
                    onSelect={onSelectPackage}
                />
            )}

            {/* ── Amortization ── */}
            {(data.equity_loan_amount ?? 0) > 0 && (() => {
                const homeLoanAmt = notFullyPaid ? (data.outstanding_disbursed ?? 0) : 0
                const equityLoanAmt = data.equity_loan_amount ?? 0
                const isMix = homeLoanAmt > 0 && equityLoanAmt > 0

                const equityClamp = (v: number) => Math.min(Math.max(v, equityTenureMin), equityTenureMax)
                const equityT1 = equityClamp(data.preferred_equity_amort_tenure_1 ?? equityTenureMax)
                const equityT2 = equityClamp(preferredEquityAmortTenure2 ?? equityTenureMax)

                const homeT1 = data.current_tenure ?? equityTenureMax

                const effectiveLockin = (lockinYears != null && lockinYears > 0) ? lockinYears : null
                const schedExplicitYears = activeSchedule.filter(e => !e.thereafter && e.year != null).length
                const breakdownYears = effectiveLockin ?? (schedExplicitYears > 0 ? schedExplicitYears : 3)

                const equityAmort1 = computeAmortization(equityLoanAmt, equityT1, activeSchedule, soraForAmort)
                const equityAmort2 = computeAmortization(equityLoanAmt, equityT2, activeSchedule, soraForAmort)
                const homeAmort1 = homeLoanAmt > 0 ? computeAmortization(homeLoanAmt, homeT1, activeSchedule, soraForAmort) : []

                const inputCls = 'w-20 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12'
                const fmt2 = (n: number | null) => n != null ? `$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
                const money2 = (n: number) => { const r = Math.round(n); return r < 0 ? `-$${(-r).toLocaleString()}` : `$${r.toLocaleString()}` }

                // Lock-in cards: per-year cumulative interest during lock-in period
                const renderLockInCards = (rows: ReturnType<typeof computeAmortization>) => {
                    if (!effectiveLockin || rows.length === 0) return null
                    const cards = Array.from({ length: effectiveLockin }, (_, i) => ({
                        year: i + 1,
                        value: rows.find(r => r.year === i + 1)?.cumulativeInterest ?? null,
                        instalment: rows.find(r => r.year === i + 1)?.instalment ?? null,
                    }))
                    return (
                        <div className="space-y-2">
                            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Interest Paid during Lock-in</p>
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
                        </div>
                    )
                }

                // Comparison table: Primary vs Compare tenures
                const renderComparisonTable = (
                    rows1: ReturnType<typeof computeAmortization>,
                    rows2: ReturnType<typeof computeAmortization>,
                    ta: number, tb: number,
                ) => {
                    const lockin = breakdownYears
                    const m1 = rows1[0]?.instalment ?? null
                    const m2 = rows2[0]?.instalment ?? null
                    const i1 = rows1.find(r => r.year === lockin)?.cumulativeInterest ?? null
                    const i2 = rows2.find(r => r.year === lockin)?.cumulativeInterest ?? null
                    const ti1 = m1 != null ? m1 * lockin * 12 : null
                    const ti2 = m2 != null ? m2 * lockin * 12 : null
                    const ol1 = rows1.find(r => r.year === lockin)?.balance ?? null
                    const ol2 = rows2.find(r => r.year === lockin)?.balance ?? null
                    const dc = (d: number) => d > 0 ? 'text-red-500' : d < 0 ? 'text-emerald-600' : 'text-slate-400'
                    const ds = (d: number) => d >= 0 ? '+' : '−'
                    const diffCols: { v1: number | null; v2: number | null; sfx: string }[] = [
                        { v1: m1, v2: m2, sfx: ' /mth' },
                        { v1: ti1, v2: ti2, sfx: '' },
                        { v1: ol1, v2: ol2, sfx: '' },
                        { v1: i1, v2: i2, sfx: '' },
                    ]
                    return (
                        <div className="rounded-xl border border-slate-200 overflow-hidden">
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
                                        <td className="px-3 py-3 text-right font-bold text-[#052d4a]">{m1 != null ? fmt2(m1) : '—'}</td>
                                        <td className="px-3 py-3 text-right font-bold text-[#052d4a]">{ti1 != null ? fmt2(ti1) : '—'}</td>
                                        <td className="px-3 py-3 text-right font-bold text-[#052d4a]">{ol1 != null ? fmt2(ol1) : '—'}</td>
                                        <td className="px-3 py-3 text-right font-bold text-[#052d4a]">{i1 != null ? fmt2(i1) : '—'}</td>
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
                                            <td className="px-3 py-3 text-right font-semibold text-slate-700">{m2 != null ? fmt2(m2) : '—'}</td>
                                            <td className="px-3 py-3 text-right font-semibold text-slate-700">{ti2 != null ? fmt2(ti2) : '—'}</td>
                                            <td className="px-3 py-3 text-right font-semibold text-slate-700">{ol2 != null ? fmt2(ol2) : '—'}</td>
                                            <td className="px-3 py-3 text-right font-semibold text-slate-700">{i2 != null ? fmt2(i2) : '—'}</td>
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
                                                                {ds(diff)}{fmt2(Math.abs(diff)).slice(1)}{col.sfx && <span className="text-[11px] font-medium">{col.sfx}</span>}
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
                }

                // Year-by-year breakdown table (full columns)
                const renderAmortTables = (
                    rows1: ReturnType<typeof computeAmortization>,
                    rows2: ReturnType<typeof computeAmortization>,
                    ta: number, tb: number,
                ) => (
                    <>
                        {[
                            { rows: rows1, tv: ta, label: 'Tenure 1' },
                            ...(showCompare ? [{ rows: rows2, tv: tb, label: 'Tenure 2' }] : []),
                        ].map(({ rows, tv, label }) => rows.length > 0 && (
                            <div key={label} className="rounded-lg border border-slate-200 overflow-hidden">
                                <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Year-by-Year Breakdown</span>
                                    <span className="text-[11px] text-slate-400">{effectiveLockin != null ? 'Lock-in · ' : ''}{label} ({tv} yrs)</span>
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
                        {soraForAmort && (soraForAmort.comp_sora_1m != null || soraForAmort.comp_sora_3m != null) && (
                            <div className="flex items-center gap-3 flex-wrap">
                                {soraForAmort.comp_sora_1m != null && (
                                    <div className="flex items-baseline gap-1.5">
                                        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">1M SORA</span>
                                        <span className="text-base font-black text-[#052d4a]">{soraForAmort.comp_sora_1m.toFixed(4)}%</span>
                                    </div>
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
                                        <ElAmortRateRow key={idx}
                                            entry={entry} label={`Year ${entry.year}`}
                                            onChange={patch => updateScheduleRow(schedIdx, patch)}
                                            onRemove={() => removeScheduleRow(schedIdx)}
                                            canRemove={(data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE).length > 1}
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
                                                <ElAmortRateRow key={`t-${idx}`}
                                                    entry={entry} label="Thereafter"
                                                    onChange={patch => updateScheduleRow(schedIdx, patch)}
                                                    onRemove={() => removeScheduleRow(schedIdx)}
                                                    canRemove={(data.manual_rate_schedule ?? DEFAULT_RATE_SCHEDULE).length > 1}
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

                        {/* Mixed: home loan card (fixed tenure) + equity loan card (with comparison) */}
                        {isMix ? (
                            <>
                                {/* Home Loan — display only, tenure is fixed at current remaining */}
                                <div className="rounded-xl border border-sky-200 overflow-hidden">
                                    <div className="bg-sky-50 border-b border-sky-100 px-4 py-3">
                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">Home Loan (Existing)</p>
                                        <p className="text-lg font-black text-[#052d4a]">{money2(homeLoanAmt)} · {homeT1} yrs remaining</p>
                                    </div>
                                    <div className="p-4 space-y-3">
                                        {renderLockInCards(homeAmort1)}
                                        {renderAmortTables(homeAmort1, homeAmort1, homeT1, homeT1)}
                                    </div>
                                </div>

                                {/* Equity Loan — with tenure comparison */}
                                <div className="rounded-xl border border-violet-200 overflow-hidden">
                                    <div className="bg-violet-50 border-b border-violet-100 px-4 py-3">
                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">Equity Loan Tenure Planner</p>
                                        <p className="text-lg font-black text-[#052d4a]">{money2(equityLoanAmt)}</p>
                                    </div>
                                    <div className="p-4 space-y-3">
                                        {renderLockInCards(equityAmort1)}
                                        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                                            Tenure Range: {equityTenureMin} – {equityTenureMax} yrs
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <label className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">Preferred Tenure 1</label>
                                                <div className="flex items-center gap-2">
                                                    <input type="number" min={equityTenureMin} max={equityTenureMax}
                                                        value={rawEquityAmortT1 !== '' ? rawEquityAmortT1 : (data.preferred_equity_amort_tenure_1 != null ? String(data.preferred_equity_amort_tenure_1) : '')}
                                                        placeholder={String(equityTenureMax)}
                                                        onChange={e => setRawEquityAmortT1(e.target.value)}
                                                        onBlur={() => {
                                                            const parsed = parseInt(rawEquityAmortT1, 10)
                                                            setRawEquityAmortT1('')
                                                            update({ preferred_equity_amort_tenure_1: isNaN(parsed) ? undefined : equityClamp(parsed) })
                                                        }}
                                                        className={inputCls} />
                                                    <span className="text-xs text-slate-500">yrs</span>
                                                </div>
                                                {data.preferred_equity_amort_tenure_1 == null && <p className="text-[11px] text-slate-400">Defaults to max tenure</p>}
                                            </div>
                                            <div className="space-y-1">
                                                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 uppercase tracking-wide font-semibold cursor-pointer select-none">
                                                    <input type="checkbox" checked={showCompare} onChange={e => setShowCompare(e.target.checked)}
                                                        className="rounded border-slate-300 accent-[#03a9e7]" />
                                                    {showCompare ? 'Preferred Tenure 2' : 'Compare Tenure'}
                                                </label>
                                                {showCompare && (
                                                    <div className="flex items-center gap-2">
                                                        <input type="number" min={equityTenureMin} max={equityTenureMax}
                                                            value={rawEquityAmortT2 !== '' ? rawEquityAmortT2 : (preferredEquityAmortTenure2 != null ? String(preferredEquityAmortTenure2) : '')}
                                                            placeholder={String(equityTenureMax)}
                                                            onChange={e => setRawEquityAmortT2(e.target.value)}
                                                            onBlur={() => {
                                                                const parsed = parseInt(rawEquityAmortT2, 10)
                                                                setRawEquityAmortT2('')
                                                                setPreferredEquityAmortTenure2(isNaN(parsed) ? undefined : equityClamp(parsed))
                                                            }}
                                                            className={inputCls} />
                                                        <span className="text-xs text-slate-500">yrs</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {renderComparisonTable(equityAmort1, equityAmort2, equityT1, equityT2)}
                                        {renderAmortTables(equityAmort1, equityAmort2, equityT1, equityT2)}
                                    </div>
                                </div>
                            </>
                        ) : (
                            /* Single loan: equity only (fully paid) */
                            <>
                                {renderLockInCards(equityAmort1)}
                                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                                    Tenure Range: {equityTenureMin} – {equityTenureMax} yrs
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <label className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">Preferred Tenure 1</label>
                                        <div className="flex items-center gap-2">
                                            <input type="number" min={equityTenureMin} max={equityTenureMax}
                                                value={rawEquityAmortT1 !== '' ? rawEquityAmortT1 : (data.preferred_equity_amort_tenure_1 != null ? String(data.preferred_equity_amort_tenure_1) : '')}
                                                placeholder={String(equityTenureMax)}
                                                onChange={e => setRawEquityAmortT1(e.target.value)}
                                                onBlur={() => {
                                                    const parsed = parseInt(rawEquityAmortT1, 10)
                                                    setRawEquityAmortT1('')
                                                    update({ preferred_equity_amort_tenure_1: isNaN(parsed) ? undefined : equityClamp(parsed) })
                                                }}
                                                className={inputCls} />
                                            <span className="text-xs text-slate-500">yrs</span>
                                        </div>
                                        {data.preferred_equity_amort_tenure_1 == null && <p className="text-[11px] text-slate-400">Defaults to max tenure</p>}
                                    </div>
                                    <div className="space-y-1">
                                        <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 uppercase tracking-wide font-semibold cursor-pointer select-none">
                                            <input type="checkbox" checked={showCompare} onChange={e => setShowCompare(e.target.checked)}
                                                className="rounded border-slate-300 accent-[#03a9e7]" />
                                            {showCompare ? 'Preferred Tenure 2' : 'Compare Tenure'}
                                        </label>
                                        {showCompare && (
                                            <div className="flex items-center gap-2">
                                                <input type="number" min={equityTenureMin} max={equityTenureMax}
                                                    value={rawEquityAmortT2 !== '' ? rawEquityAmortT2 : (preferredEquityAmortTenure2 != null ? String(preferredEquityAmortTenure2) : '')}
                                                    placeholder={String(equityTenureMax)}
                                                    onChange={e => setRawEquityAmortT2(e.target.value)}
                                                    onBlur={() => {
                                                        const parsed = parseInt(rawEquityAmortT2, 10)
                                                        setRawEquityAmortT2('')
                                                        setPreferredEquityAmortTenure2(isNaN(parsed) ? undefined : equityClamp(parsed))
                                                    }}
                                                    className={inputCls} />
                                                <span className="text-xs text-slate-500">yrs</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                {renderComparisonTable(equityAmort1, equityAmort2, equityT1, equityT2)}
                                {renderAmortTables(equityAmort1, equityAmort2, equityT1, equityT2)}
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

            {/* Hand-off */}
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

interface PillOption { value: string; label: string }
function PillSelect({ value, onChange, options }: { value?: string; onChange: (v: string) => void; options: PillOption[] }) {
    return (
        <div className="flex flex-wrap gap-2">
            {options.map(opt => (
                <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                        value === opt.value
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
        <div className="flex gap-2">
            {([true, false] as const).map(v => (
                <button key={String(v)} type="button" onClick={() => onChange(v)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
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

function CheckRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
    return (
        <label className="flex items-center gap-3 cursor-pointer select-none group">
            <div onClick={onToggle}
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all cursor-pointer flex-shrink-0 ${
                    checked ? 'bg-[#052d4a] border-[#052d4a]' : 'border-slate-300 bg-white group-hover:border-[#03a9e7]'
                }`}>
                {checked && <CheckCircle2 size={12} className="text-white" />}
            </div>
            <span className="text-sm text-slate-700">{label}</span>
        </label>
    )
}

function OwnershipBar({ loanPct, cpfPct, cashPct, loanAmt, cpfAmt, cashAmt }: {
    loanPct: number; cpfPct: number; cashPct: number
    loanAmt: number; cpfAmt: number; cashAmt: number
}) {
    const pctFmt = (v: number) => `${(v * 100).toFixed(1)}%`
    const segments = [
        { label: 'Loan', pct: loanPct, amt: loanAmt, color: '#03a9e7' },
        { label: 'CPF', pct: cpfPct, amt: cpfAmt, color: '#6366f1' },
        { label: 'Cash / Equity', pct: cashPct, amt: cashAmt, color: '#10b981' },
    ].filter(s => s.pct > 0)

    return (
        <div className="space-y-2">
            <div className="flex h-4 rounded-full overflow-hidden w-full">
                {segments.map(s => (
                    <div key={s.label} style={{ width: pctFmt(s.pct), background: s.color }} />
                ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
                {segments.map(s => (
                    <div key={s.label} className="flex items-center gap-1.5 text-[11px]">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                        <span className="text-slate-500">{s.label}</span>
                        <span className="font-semibold text-slate-700">{pctFmt(s.pct)}</span>
                        <span className="text-slate-400">($${Math.floor(s.amt).toLocaleString()})</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

function ElAmortRateRow({ entry, label, onChange, onRemove, canRemove }: {
    entry: RateScheduleEntry
    label: string
    onChange: (patch: Partial<RateScheduleEntry>) => void
    onRemove: () => void
    canRemove: boolean
}) {
    return (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 last:border-b-0 bg-white">
            <div className="w-1 h-7 rounded-full shrink-0 bg-[#03a9e7]" />
            <span className="w-20 shrink-0 text-xs font-bold text-[#052d4a]">{label}</span>
            <select value={entry.type} onChange={e => onChange({ type: e.target.value as 'fixed' | 'floating', rate: undefined, reference: undefined, spread: undefined })}
                className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 outline-none focus:border-[#03a9e7]">
                <option value="fixed">Fixed</option>
                <option value="floating">Floating</option>
            </select>
            {entry.type === 'fixed' ? (
                <div className="flex items-center gap-1 flex-1">
                    <input type="number" step="0.01" value={entry.rate ?? ''}
                        onChange={e => onChange({ rate: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                        placeholder="3.50"
                        className="w-20 px-2 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 outline-none focus:border-[#03a9e7]" />
                    <span className="text-xs text-slate-400">% p.a.</span>
                </div>
            ) : (
                <div className="flex items-center gap-1 flex-1 flex-wrap">
                    <select value={entry.reference ?? '1M SORA'} onChange={e => onChange({ reference: e.target.value })}
                        className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 outline-none focus:border-[#03a9e7]">
                        <option>1M SORA</option>
                        <option>3M SORA</option>
                        <option>FD Rate</option>
                    </select>
                    <span className="text-xs text-slate-400">+</span>
                    <input type="number" step="0.01" value={entry.spread ?? ''}
                        onChange={e => onChange({ spread: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                        placeholder="0.80"
                        className="w-16 px-2 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 outline-none focus:border-[#03a9e7]" />
                    <span className="text-xs text-slate-400">%</span>
                </div>
            )}
            {canRemove && (
                <button type="button" onClick={onRemove} className="shrink-0 p-1 text-slate-300 hover:text-red-400 transition-colors">
                    <Trash2 size={13} />
                </button>
            )}
        </div>
    )
}
