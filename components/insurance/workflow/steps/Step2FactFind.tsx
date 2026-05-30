'use client'

import { RefinancingStep2_FactFind } from '@/lib/types/workflow'
import { Question, RadioGroup, FieldInput, FieldTextarea, ExpandableCard, ActionList, StepActions, CheckItem } from '../WorkflowStep'

interface Props {
    data: RefinancingStep2_FactFind
    onChange: (patch: Partial<RefinancingStep2_FactFind>) => void
    isComplete: boolean
    onMarkComplete: () => void
    onMarkIncomplete: () => void
}

export default function Step2FactFind({ data, onChange, isComplete, onMarkComplete, onMarkIncomplete }: Props) {
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
                    {`"For the bank application, they'll need to verify your income — don't worry, at this stage I just need a rough figure so I can check the numbers make sense before we go any further. What's your approximate gross monthly income? That's before CPF deductions."

If self-employed:
"For self-employed clients, banks typically use your Notice of Assessment from IRAS for the last 2 years. Do you have a rough idea of your declared annual income?"`}
                </ExpandableCard>
                <ExpandableCard variant="script" title="The clawback question — how to handle it if they don't know">
                    {`"When you first took this loan, did the bank give you any cashback, legal fee subsidy, or any other payment? Sometimes it's $1,000, $2,000, even $3,000 depending on the loan size. If they did, there's usually a clawback clause — meaning if you refinance before a certain date, you'd have to return that money."

If they're unsure:
"Don't worry — it'll be in your original Letter of Offer or a separate subsidy letter from the bank. Could you dig that out? It's important because we need to factor it into whether refinancing actually makes financial sense."`}
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

                <Question label="Current interest type">
                    <RadioGroup
                        value={data.interest_type}
                        onChange={v => onChange({ interest_type: v as any })}
                        options={[
                            { value: 'fixed', label: 'Fixed' },
                            { value: 'floating', label: 'Floating / SORA' },
                            { value: 'board_rate', label: 'Board Rate' },
                        ]}
                    />
                </Question>

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
