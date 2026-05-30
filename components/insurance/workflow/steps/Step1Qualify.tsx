'use client'

import { RefinancingStep1_Qualify } from '@/lib/types/workflow'
import { Question, RadioGroup, FieldInput, FieldTextarea, ExpandableCard, ActionList, StepActions, CheckItem } from '../WorkflowStep'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'

interface Props {
    data: RefinancingStep1_Qualify
    onChange: (patch: Partial<RefinancingStep1_Qualify>) => void
    isComplete: boolean
    onMarkComplete: () => void
    onMarkIncomplete: () => void
}

export default function Step1Qualify({ data, onChange, isComplete, onMarkComplete, onMarkIncomplete }: Props) {
    return (
        <div className="space-y-5 pt-4">
            <ActionList actions={[
                'Call the client and open with: "I\'d love to do a quick health check on your current home loan — takes 5 minutes."',
                'Ask for current bank, current interest rate, and lock-in expiry date.',
                'Ask for approximate outstanding loan amount and remaining tenure.',
                'Note the rough monthly repayment (client can check their bank statement or app).',
                'Determine: is the rate meaningfully above market? Is lock-in clear or nearly expired?',
                'Set this step complete only if refinancing is worth pursuing. If not viable now, record the reason in notes.',
            ]} />

            <div className="space-y-2">
                <ExpandableCard variant="script" title='Opening the conversation — what to say'>
                    {`"Hi [Name], this is [Agent] from The Loan Connection. I help homeowners review their home loans and make sure they're on the best rate available. I noticed some banks have been updating their packages recently, so I wanted to do a quick 5-minute check for you. Is now an okay time?"

If rate is not competitive:
"It looks like your current rate is actually not too far off market right now — I'd suggest we revisit in about [X months] when your lock-in is closer to expiry. I'll make a note to reach out then."`}
                </ExpandableCard>
                <ExpandableCard variant="script" title="When they're still in lock-in — how to frame it">
                    {`"If you're still in lock-in, refinancing today would trigger a penalty — typically around 1.5% of your outstanding loan. So for a $500K loan, that's about $7,500 out of pocket. Unless the rate difference is very significant, it usually makes more sense to wait until you're out of lock-in.

That said, let's calculate together — I want to make sure the numbers actually work for you before recommending anything."`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="When to pursue vs. park a case">
                    {`The window that makes economic sense: lock-in has expired OR will expire within 3 months, AND the client's current rate is at least 0.3–0.5% above what market packages are offering.

Below that spread, the savings after legal fees ($1,500–$2,500 for conveyancing) rarely justify the effort.

Rule of thumb: for a $500K loan, each 0.1% rate reduction saves roughly $500/year. Legal fees at $2K means the client needs at least 4 years of savings to break even at that spread. For larger loans, the threshold is proportionally lower.`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="Why rate alone doesn't tell the full story">
                    {`Board rate packages look high on paper (e.g., "Prime + 0.5%") but the effective rate clients pay depends on what the board rate actually is today. Some clients on "floating" packages are actually on very competitive effective rates.

Always ask for the last bank statement to see the actual interest charged, not just the package name.`}
                </ExpandableCard>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Question label="Lock-in status" required>
                    <RadioGroup
                        value={data.lock_in_status}
                        onChange={v => onChange({ lock_in_status: v as any, lock_in_expiry: v !== 'in_lock_in' ? undefined : data.lock_in_expiry })}
                        options={[
                            { value: 'in_lock_in', label: 'In lock-in' },
                            { value: 'expired', label: 'Expired' },
                            { value: 'no_lock_in', label: 'No lock-in' },
                        ]}
                    />
                </Question>

                {data.lock_in_status === 'in_lock_in' && (
                    <Question label="Lock-in expiry date" required>
                        <FieldInput type="date" value={data.lock_in_expiry} onChange={v => onChange({ lock_in_expiry: v })} />
                    </Question>
                )}

                <Question label="Current bank" required>
                    <InsuranceBankDropdown value={data.current_bank ?? ''} onChange={v => onChange({ current_bank: v })} placeholder="Select current bank…" />
                </Question>

                <Question label="Current interest rate" required>
                    <FieldInput type="number" value={data.current_rate} onChange={v => onChange({ current_rate: v ? parseFloat(v) : undefined })} placeholder="e.g. 3.5" suffix="%" />
                </Question>

                <Question label="Outstanding loan amount" required>
                    <FieldInput type="number" value={data.outstanding_loan} onChange={v => onChange({ outstanding_loan: v ? parseFloat(v) : undefined })} placeholder="0" prefix="$" />
                </Question>

                <Question label="Remaining tenure">
                    <FieldInput type="number" value={data.remaining_tenure} onChange={v => onChange({ remaining_tenure: v ? parseInt(v) : undefined })} placeholder="e.g. 20" suffix="yrs" />
                </Question>

                <Question label="Rough monthly payment">
                    <FieldInput type="number" value={data.rough_monthly_payment} onChange={v => onChange({ rough_monthly_payment: v ? parseFloat(v) : undefined })} placeholder="0" prefix="$" />
                </Question>
            </div>

            <div className="pt-2">
                <CheckItem
                    checked={data.worth_exploring}
                    onChange={v => onChange({ worth_exploring: v })}
                    label="Refinancing is worth pursuing for this client"
                    hint="Check this only after reviewing rate competitiveness and lock-in status"
                />
            </div>

            <Question label="Notes">
                <FieldTextarea value={data.qualify_notes} onChange={v => onChange({ qualify_notes: v })} placeholder="Any other context from the initial call…" />
            </Question>

            <StepActions
                isComplete={isComplete}
                onMarkComplete={onMarkComplete}
                onMarkIncomplete={onMarkIncomplete}
                completionLabel="Qualify complete — proceed to Fact Find"
            />
        </div>
    )
}
