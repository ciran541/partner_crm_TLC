'use client'

import { RefinancingStep2_FactFind, FloatingRateType } from '@/lib/types/workflow'
import { Question, RadioGroup, FieldInput, FieldTextarea, ExpandableCard, ActionList, StepActions, CheckItem } from '../WorkflowStep'

const FLOATING_RATE_TYPES: FloatingRateType[] = ['1M SORA', '3M SORA', 'FD Rate']
const MAX_FIXED_YEARS = 5

function YearPills({ max, value, onChange, minValue = 1 }: {
    max: number; value?: number; onChange: (v: number) => void; minValue?: number
}) {
    return (
        <div className="flex flex-wrap gap-2">
            {Array.from({ length: max }, (_, i) => i + 1)
                .filter(yr => yr >= minValue)
                .map(yr => (
                    <button key={yr} type="button" onClick={() => onChange(yr)}
                        className={`w-10 h-9 rounded-lg border text-sm font-semibold transition-all ${
                            value === yr
                                ? 'bg-[#052d4a] border-[#052d4a] text-white'
                                : 'bg-white border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7]'
                        }`}>{yr}</button>
                ))}
        </div>
    )
}

interface Props {
    data: RefinancingStep2_FactFind
    qualify: { outstanding_loan?: number; lock_in_expiry?: string; current_bank?: string }
    clientName?: string | null
    onChange: (patch: Partial<RefinancingStep2_FactFind>) => void
    isComplete: boolean
    onMarkComplete: () => void
    onMarkIncomplete: () => void
}

function fmt(n: number) { return `$${Math.round(n).toLocaleString()}` }

export default function Step2FactFind({ data, qualify, clientName, onChange, isComplete, onMarkComplete, onMarkIncomplete }: Props) {
    const name = clientName || 'the client'
    const clawbackAmt = data.clawback_amount
    const clawbackEnd = data.clawback_end_date
        ? new Date(data.clawback_end_date).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })
        : null

    return (
        <div className="space-y-5 pt-4">
            <ActionList actions={[
                'Ask for property type and rough valuation (for LTV checks).',
                'Capture gross monthly income for TDSR calculation. If self-employed, ask for NOA income.',
                'Ask about other monthly debt obligations: car loan, personal loan, credit card minimum payments.',
                'Ask: "Did your current bank give you any cashback or subsidies when you took the loan?" — this is the clawback question.',
                'If subsidy received, capture the clawback amount and clawback end date from their loan letter.',
                'Confirm whether CPF is used for monthly repayments and how much.',
            ]} />

            <div className="space-y-2">
                <ExpandableCard variant="script" title="How to ask about income without making it feel like an interrogation">
                    {`"${name}, for the bank application they'll need to verify your income — don't worry, at this stage I just need a rough figure to check the numbers make sense before we go further. What's your approximate gross monthly income? That's before CPF deductions."

If self-employed:
"For self-employed clients, banks typically use your Notice of Assessment from IRAS for the last 2 years. Do you have a rough idea of your declared annual income?"`}
                </ExpandableCard>
                <ExpandableCard variant="script" title="The clawback question — how to handle it if they don't know">
                    {data.subsidy_received && clawbackAmt
                        ? `${name} has a clawback of ${fmt(clawbackAmt)}${clawbackEnd ? ` expiring on ${clawbackEnd}` : ''}. When presenting any refinancing option, factor this cost into the net savings — the new rate needs to save more than ${fmt(clawbackAmt)} to make the switch worthwhile.

Script: "I want to be upfront — because of the ${fmt(clawbackAmt)} subsidy from ${qualify.current_bank || 'your current bank'}, if you refinance before ${clawbackEnd || 'the clawback expiry'}, you'd need to return that amount. So we need the savings to cover that first. Let me run those numbers for you."`
                        : `"When you first took this loan, did the bank give you any cashback, legal fee subsidy, or any other payment? Sometimes it's $1,000, $2,000, even $3,000 depending on the loan size. If they did, there's usually a clawback clause.

If unsure: 'It'll be in your original Letter of Offer or a separate subsidy letter. Could you dig that out? It's important because we need to factor it into whether refinancing makes financial sense.'"`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="TDSR calculation — what you need to know">
                    {`TDSR (Total Debt Servicing Ratio) is capped at 55% of gross monthly income.

Formula: (all monthly debt obligations including new mortgage) ÷ gross monthly income ≤ 55%

Example: Client earns $6,000 gross with a $400/month car loan. Maximum total monthly debt = $3,300. If new mortgage is $2,500, total is $2,900 — within TDSR.

For HDB loans: additional MSR (Mortgage Servicing Ratio) cap — the mortgage alone cannot exceed 30% of gross income.

Flag early if you suspect TDSR is tight — it's better to know before going to the bank.`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="Subsidy and clawback — what to watch for">
                    {`Subsidies are very common. Most banks offer $1,500–$3,000 in legal fee rebates or cashback to incentivise customers to take their loan.

Clawback clause typically runs 3 years from the disbursement date. Amount is usually the full subsidy if refinanced within year 1, prorated in years 2–3. Some banks have full-clawback-for-full-term clauses.

Always get the actual subsidy letter — never rely on the client's memory of the amount.`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="CPF usage and its implications">
                    {`If the client is using CPF OA for monthly repayments, the CPF board accrues interest at 2.5% on amounts used. When the property is sold, these accrued amounts must be refunded to CPF.

This doesn't block refinancing, but clients sometimes confuse "CPF principal + accrued interest" with "outstanding loan" — they are separate obligations.

Note whether CPF is used monthly, as this affects cashflow analysis.`}
                </ExpandableCard>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Question label="Property type" required>
                    <RadioGroup
                        value={data.property_type}
                        onChange={v => onChange({ property_type: v as any })}
                        options={[
                            { value: 'hdb', label: 'HDB' },
                            { value: 'private_condo', label: 'Private Condo' },
                            { value: 'landed', label: 'Landed' },
                            { value: 'ec', label: 'EC' },
                        ]}
                    />
                </Question>

                <div className="sm:col-span-2">
                    <Question label="Current package type">
                        <RadioGroup
                            value={data.interest_type}
                            onChange={v => onChange({
                                interest_type: v as any,
                                fixed_years: v === 'floating' ? undefined : data.fixed_years,
                                lock_in_years: undefined,
                                year_rates: [],
                                floating_rate_type: v === 'fixed' ? undefined : data.floating_rate_type,
                            })}
                            options={[
                                { value: 'fixed', label: 'Fixed' },
                                { value: 'floating', label: 'Floating / SORA' },
                            ]}
                        />
                    </Question>
                </div>

                {data.interest_type === 'fixed' && (
                    <div className="sm:col-span-2 pl-4 border-l-2 border-slate-200 space-y-1">
                        <Question label="Fixed for how many years?">
                            <YearPills max={MAX_FIXED_YEARS} value={data.fixed_years}
                                onChange={yr => onChange({ fixed_years: yr, lock_in_years: undefined, year_rates: [] })} />
                        </Question>
                    </div>
                )}

                {data.interest_type && (data.interest_type === 'floating' || data.fixed_years) && (
                    <div className="sm:col-span-2 pl-4 border-l-2 border-slate-200 space-y-1">
                        <Question label="Total lock-in period">
                            <YearPills max={MAX_FIXED_YEARS} value={data.lock_in_years}
                                minValue={data.interest_type === 'fixed' ? (data.fixed_years ?? 1) : 1}
                                onChange={yr => onChange({ lock_in_years: yr, year_rates: Array(yr).fill('') })} />
                        </Question>
                        <p className="text-xs text-slate-400">Total years locked in with the current bank.</p>
                    </div>
                )}

                {data.interest_type && data.lock_in_years && (
                    (data.interest_type === 'floating' || (data.fixed_years !== undefined && data.lock_in_years > data.fixed_years))
                ) && (
                    <div className="sm:col-span-2 pl-4 border-l-2 border-slate-200">
                        <Question label="Floating rate benchmark (for floating years)">
                            <RadioGroup
                                value={data.floating_rate_type}
                                onChange={v => onChange({ floating_rate_type: v as FloatingRateType })}
                                options={FLOATING_RATE_TYPES.map(rt => ({ value: rt, label: rt }))}
                            />
                        </Question>
                    </div>
                )}

                {data.lock_in_years && data.lock_in_years > 0 && (
                    <div className="sm:col-span-2 space-y-2">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Interest Rate by Year</p>
                        {Array.from({ length: data.lock_in_years }, (_, i) => {
                            const isFixed = data.interest_type === 'fixed' && i < (data.fixed_years ?? 0)
                            return (
                                <div key={i} className="flex items-center gap-3">
                                    <span className="text-xs font-bold text-slate-400 w-10 shrink-0">Yr {i + 1}</span>
                                    <div className="relative flex-1">
                                        <input
                                            type="number" step="0.01"
                                            value={data.year_rates?.[i] ?? ''}
                                            onChange={e => {
                                                const rates = [...(data.year_rates ?? Array(data.lock_in_years).fill(''))]
                                                rates[i] = e.target.value
                                                onChange({ year_rates: rates })
                                            }}
                                            placeholder="0.00"
                                            className="w-full py-2 pl-3 pr-8 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 transition-all"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-semibold pointer-events-none">%</span>
                                    </div>
                                    <span className={`text-xs font-bold w-28 shrink-0 ${isFixed ? 'text-[#052d4a]' : 'text-sky-600'}`}>
                                        {isFixed ? 'Fixed' : (data.floating_rate_type ?? 'Floating')}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                )}

                <Question label="Property address">
                    <FieldInput value={data.property_address} onChange={v => onChange({ property_address: v })} placeholder="Block / street…" />
                </Question>

                <Question label="Estimated property valuation">
                    <FieldInput type="number" value={data.property_valuation} onChange={v => onChange({ property_valuation: v ? parseFloat(v) : undefined })} placeholder="0" prefix="$" />
                </Question>

                <Question label="Gross monthly income" required>
                    <FieldInput type="number" value={data.gross_monthly_income} onChange={v => onChange({ gross_monthly_income: v ? parseFloat(v) : undefined })} placeholder="0" prefix="$" />
                </Question>

                <Question label="Other monthly debts (car, personal loans, CC min)">
                    <FieldInput type="number" value={data.other_monthly_debts} onChange={v => onChange({ other_monthly_debts: v ? parseFloat(v) : undefined })} placeholder="0" prefix="$" />
                </Question>

                <div className="sm:col-span-2 space-y-2">
                    <CheckItem checked={data.is_self_employed} onChange={v => onChange({ is_self_employed: v })} label="Client is self-employed (will need NOA instead of payslips)" />
                    <CheckItem checked={data.co_borrower} onChange={v => onChange({ co_borrower: v, co_borrower_income: !v ? undefined : data.co_borrower_income })} label="There is a co-borrower on this loan" />
                </div>

                {data.co_borrower && (
                    <Question label="Co-borrower gross monthly income">
                        <FieldInput type="number" value={data.co_borrower_income} onChange={v => onChange({ co_borrower_income: v ? parseFloat(v) : undefined })} placeholder="0" prefix="$" />
                    </Question>
                )}

                <div className="sm:col-span-2 space-y-2">
                    <CheckItem checked={data.cpf_used_monthly} onChange={v => onChange({ cpf_used_monthly: v, cpf_monthly_amount: !v ? undefined : data.cpf_monthly_amount })} label="Client uses CPF OA for monthly repayments" />
                </div>

                {data.cpf_used_monthly && (
                    <Question label="CPF monthly amount">
                        <FieldInput type="number" value={data.cpf_monthly_amount} onChange={v => onChange({ cpf_monthly_amount: v ? parseFloat(v) : undefined })} placeholder="0" prefix="$" />
                    </Question>
                )}
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-4">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Subsidy & Clawback</p>
                <Question label="Did the current bank provide any subsidy / cashback?" required>
                    <RadioGroup
                        value={data.subsidy_received === undefined ? undefined : data.subsidy_received ? 'yes' : 'no'}
                        onChange={v => onChange({ subsidy_received: v === 'yes', clawback_amount: v === 'no' ? undefined : data.clawback_amount, clawback_end_date: v === 'no' ? undefined : data.clawback_end_date })}
                        options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
                    />
                </Question>

                {data.subsidy_received && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-4 border-l-2 border-amber-300">
                        <Question label="Clawback amount remaining" required>
                            <FieldInput type="number" value={data.clawback_amount} onChange={v => onChange({ clawback_amount: v ? parseFloat(v) : undefined })} placeholder="0" prefix="$" />
                        </Question>
                        <Question label="Clawback end date" required>
                            <FieldInput type="date" value={data.clawback_end_date} onChange={v => onChange({ clawback_end_date: v })} />
                        </Question>
                    </div>
                )}
            </div>

            <Question label="Notes">
                <FieldTextarea value={data.fact_find_notes} onChange={v => onChange({ fact_find_notes: v })} placeholder="Any other context from the fact-find call…" />
            </Question>

            <StepActions isComplete={isComplete} onMarkComplete={onMarkComplete} onMarkIncomplete={onMarkIncomplete} completionLabel="Fact find complete" />
        </div>
    )
}
