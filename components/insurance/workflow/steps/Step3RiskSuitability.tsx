'use client'

import { RefinancingStep3_RiskSuitability, RefinancingStep2_FactFind } from '@/lib/types/workflow'
import { Question, RadioGroup, FieldInput, FieldTextarea, ExpandableCard, ActionList, StepActions, CheckItem } from '../WorkflowStep'

interface Props {
    data: RefinancingStep3_RiskSuitability
    factFind: RefinancingStep2_FactFind
    onChange: (patch: Partial<RefinancingStep3_RiskSuitability>) => void
    isComplete: boolean
    onMarkComplete: () => void
    onMarkIncomplete: () => void
}

export default function Step3RiskSuitability({ data, factFind, onChange, isComplete, onMarkComplete, onMarkIncomplete }: Props) {
    // Auto-compute TDSR if income is available
    const income = (factFind.gross_monthly_income ?? 0) + (factFind.co_borrower_income ?? 0)
    const existingDebts = factFind.other_monthly_debts ?? 0
    const tdsr = income > 0 ? Math.round(((existingDebts / income) * 100) * 10) / 10 : null

    return (
        <div className="space-y-5 pt-4">
            <ActionList actions={[
                'Check selling intent: "Are you planning to sell this property in the next few years?"',
                'Check income stability: "Are you expecting any significant income changes in the next 12 months?"',
                'Review TDSR — calculated from Step 2 data. Flag if approaching 45%.',
                'Understand rate preference — explain fixed vs. floating trade-offs simply.',
                'Establish holding period: how long do they intend to keep the property?',
                'Confirm payment sensitivity: can they absorb a rate increase if they go floating?',
            ]} />

            <div className="space-y-2">
                <ExpandableCard variant="script" title="Explaining fixed vs. floating simply">
                    {`"There are two main types of packages. Fixed rate means your monthly payment stays exactly the same for the first 1, 2, or 3 years — great for budgeting, you know exactly what you're paying. After the fixed period, it reverts to a floating rate.

Floating rate means your payment moves with market rates — right now floating rates are typically a bit lower than fixed, but they can go up if rates rise.

Which do you think suits your situation better — certainty and stability, or flexibility and potentially lower cost?"`}
                </ExpandableCard>
                <ExpandableCard variant="script" title="Raising the clawback conversation">
                    {`"I want to be upfront with you: because you received a [subsidy amount] subsidy, if you refinance before [clawback end date], you'd need to return that amount to your current bank. So we need to make sure the savings from the new rate more than cover that cost.

I've run the rough numbers — [explain net savings] — and [it does/does not] stack up. Let me show you exactly how I calculated that."`}
                </ExpandableCard>
                <ExpandableCard variant="script" title="Handling the selling objection">
                    {`"If you're planning to sell in, say, 2 years, I want to make sure you're not taking a loan with a 3-year lock-in — because breaking out would cost you a penalty again.

In that case, if we do proceed, I'd recommend a package with the shortest possible lock-in. But honestly — if you're selling very soon, it might not be worth refinancing at all. Let me run the numbers first so you can make an informed decision."`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="Risk flag decision tree">
                    {`Urgent lock-in (< 90 days): act fast — prioritise submission timeline over perfect rate optimisation.

Clawback risk: must compute net savings. Net saving = (old monthly − new monthly) × months remaining in clawback period, minus clawback amount. If net saving is negative, refinancing is not recommended.

Selling risk: if selling within the new lock-in period, the client pays another penalty. Recommend no lock-in or shortest lock-in package if selling in 2–3 years.

Income risk: if income dropping, verify TDSR will still be met at the new income level. A conditional approval may come back with a lower loan quantum.

TDSR concern: if TDSR is above 45% (not yet hard-stop at 55%, but approaching), flag it. Bank may apply a more conservative stress-test rate.`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="How SORA works for floating packages">
                    {`SORA is the Singapore Overnight Rate Average, published daily by MAS. It replaced SIBOR as the benchmark for floating-rate mortgages from 2024.

Most floating packages are quoted as "3M Compounded SORA + spread". Example: 3M SORA at 3.2% + spread 0.6% = effective rate 3.8%.

SORA-linked packages have no floor rate, so they can drop when SORA drops — unlike old SIBOR/board rate packages. Clients with existing board rate packages are often significantly overpaying.`}
                </ExpandableCard>
            </div>

            {/* TDSR indicator */}
            {tdsr !== null && (
                <div className={`rounded-lg px-4 py-3 flex items-center gap-3 ${
                    tdsr > 45 ? 'bg-amber-50 border border-amber-200' : 'bg-emerald-50 border border-emerald-200'
                }`}>
                    <div>
                        <p className={`text-sm font-semibold ${tdsr > 45 ? 'text-amber-800' : 'text-emerald-800'}`}>
                            Estimated TDSR (existing debts only): {tdsr}%
                        </p>
                        <p className={`text-xs mt-0.5 ${tdsr > 45 ? 'text-amber-700' : 'text-emerald-700'}`}>
                            {tdsr > 45
                                ? 'Approaching the 55% limit — verify new mortgage payment fits within TDSR before proposing.'
                                : 'Within safe range. Verify after adding the new mortgage payment.'}
                        </p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                    <Question label="Is the client planning to sell the property?" required>
                        <RadioGroup
                            value={data.selling_plan}
                            onChange={v => onChange({ selling_plan: v as any, selling_timeline: v !== 'yes' ? undefined : data.selling_timeline })}
                            options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }, { value: 'unsure', label: 'Unsure' }]}
                        />
                    </Question>
                </div>

                {data.selling_plan === 'yes' && (
                    <div className="sm:col-span-2">
                        <Question label="Expected selling timeline">
                            <FieldInput value={data.selling_timeline} onChange={v => onChange({ selling_timeline: v })} placeholder="e.g. Within 2 years…" />
                        </Question>
                    </div>
                )}

                <div className="sm:col-span-2 space-y-2">
                    <CheckItem
                        checked={data.income_change_expected}
                        onChange={v => onChange({ income_change_expected: v, income_change_details: !v ? undefined : data.income_change_details })}
                        label="Income changes expected in next 12 months"
                    />
                </div>

                {data.income_change_expected && (
                    <div className="sm:col-span-2">
                        <Question label="Describe the expected income change">
                            <FieldTextarea value={data.income_change_details} onChange={v => onChange({ income_change_details: v })} placeholder="e.g. Switching jobs in 3 months, expected salary increase…" />
                        </Question>
                    </div>
                )}

                <div className="sm:col-span-2 border-t border-slate-100 pt-4">
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-3">Suitability Profile</p>
                </div>

                <div className="sm:col-span-2">
                    <Question label="Rate preference" required>
                        <RadioGroup
                            value={data.rate_preference}
                            onChange={v => onChange({ rate_preference: v as any, fixed_tenure_preference: v !== 'fixed' ? undefined : data.fixed_tenure_preference })}
                            options={[{ value: 'fixed', label: 'Fixed' }, { value: 'floating', label: 'Floating / SORA' }, { value: 'dont_mind', label: "Don't mind" }]}
                        />
                    </Question>
                </div>

                {data.rate_preference === 'fixed' && (
                    <Question label="Preferred fixed tenure">
                        <RadioGroup
                            value={data.fixed_tenure_preference}
                            onChange={v => onChange({ fixed_tenure_preference: v as any })}
                            options={[{ value: '1yr', label: '1 year' }, { value: '2yr', label: '2 years' }, { value: '3yr', label: '3 years' }]}
                        />
                    </Question>
                )}

                <Question label="Payment sensitivity">
                    <RadioGroup
                        value={data.payment_sensitivity}
                        onChange={v => onChange({ payment_sensitivity: v as any })}
                        options={[{ value: 'low', label: 'Low (flexible)' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High (sensitive)' }]}
                    />
                </Question>

                <div className="sm:col-span-2">
                    <Question label="How long does the client plan to hold this property?" required>
                        <RadioGroup
                            value={data.holding_period}
                            onChange={v => onChange({ holding_period: v as any })}
                            options={[{ value: 'short', label: 'Short (< 3 years)' }, { value: 'medium', label: 'Medium (3–7 years)' }, { value: 'long', label: 'Long (> 7 years)' }]}
                        />
                    </Question>
                </div>
            </div>

            <Question label="Risk & suitability notes">
                <FieldTextarea value={data.risk_notes} onChange={v => onChange({ risk_notes: v })} placeholder="Summary of risks identified and suitability recommendation direction…" />
            </Question>

            <StepActions isComplete={isComplete} onMarkComplete={onMarkComplete} onMarkIncomplete={onMarkIncomplete} completionLabel="Risk & suitability assessment complete" />
        </div>
    )
}
