'use client'

import { RefinancingStep8_FollowupApproval } from '@/lib/types/workflow'
import { Question, RadioGroup, FieldInput, FieldTextarea, ExpandableCard, ActionList, StepActions, CheckItem } from '../WorkflowStep'

interface Props {
    data: RefinancingStep8_FollowupApproval
    onChange: (patch: Partial<RefinancingStep8_FollowupApproval>) => void
    isComplete: boolean
    onMarkComplete: () => void
    onMarkIncomplete: () => void
}

export default function Step8FollowupApproval({ data, onChange, isComplete, onMarkComplete, onMarkIncomplete }: Props) {
    return (
        <div className="space-y-5 pt-4">
            <ActionList actions={[
                'Set a reminder to follow up with the bank on Day 5 if no response received.',
                'When bank raises queries or requests additional documents, resolve within 24 hours.',
                'Update the client at each significant milestone — never go silent for more than 5 business days.',
                'If conditional approval: explain conditions to the client clearly; obtain any additional docs needed.',
                'Once formal approval received, record the approved rate and notify the client immediately.',
                'Book time to review the Letter of Offer with the client (next step).',
            ]} />

            <div className="space-y-2">
                <ExpandableCard variant="script" title="Chasing the bank — tone to use with relationship manager">
                    {`"Hi [RM Name], just following up on the refinancing application for [Client Name], submitted on [date], reference [REF]. It's been [X] business days — any updates from the credit team? Is there anything additional they need from the borrower? I have all documents ready. Thanks."`}
                </ExpandableCard>
                <ExpandableCard variant="script" title="Notifying client of approval">
                    {`"Great news! [Bank] has come back with an approval for your refinancing. The approved rate is [rate]% — exactly as proposed. I'll be sending you the Letter of Offer shortly for your review.

Before you sign anything, I'd like to walk you through the key terms together to make sure you're comfortable. Can we do a quick call on [date] to go through it?"`}
                </ExpandableCard>
                <ExpandableCard variant="script" title="Handling a conditional approval">
                    {`"The bank has approved in principle but has one condition: they need [additional document/information]. This is fairly routine — they just need to verify [reason]. I'll handle the follow-up. In the meantime, everything is on track."`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="What causes delays or rejections at this stage">
                    {`Common reasons:
1. Income inconsistency — CPF doesn't match payslips (client changed jobs). Solution: letter of employment with confirmed salary.
2. TDSR breach — loan quantum too high given declared income. Solution: reduce loan amount or add co-borrower.
3. Outstanding property tax or MCST arrears — bank may flag these. Client needs to clear.
4. Credit bureau issues — client has late payments on other loans.
5. Valuation shortfall — bank's valuation comes in lower than outstanding loan. Rare for HDB but possible for private.`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="IPA vs Letter of Offer — know the difference">
                    {`IPA (In-Principle Approval): the bank's preliminary assessment. Confirms client is eligible but is NOT a binding commitment.

Letter of Offer (LoO): the binding offer that specifies exact rate, tenure, terms, clawback (if the new bank is also providing a subsidy), and acceptance deadline.

Do NOT advise the client to act on an IPA — always wait for the LoO.`}
                </ExpandableCard>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Question label="Last chased bank on">
                    <FieldInput type="date" value={data.last_chased_date} onChange={v => onChange({ last_chased_date: v })} />
                </Question>

                <Question label="Last client update on">
                    <FieldInput type="date" value={data.client_updated_date} onChange={v => onChange({ client_updated_date: v })} />
                </Question>

                <div className="sm:col-span-2">
                    <Question label="Approval status" required>
                        <RadioGroup
                            value={data.approval_status}
                            onChange={v => onChange({ approval_status: v as any })}
                            options={[
                                { value: 'pending', label: '⏳ Pending' },
                                { value: 'approved', label: '✓ Approved' },
                                { value: 'conditional', label: '⚡ Conditional' },
                                { value: 'rejected', label: '✗ Rejected' },
                            ]}
                        />
                    </Question>
                </div>

                {data.approval_status === 'conditional' && (
                    <div className="sm:col-span-2">
                        <Question label="Conditions imposed by bank">
                            <FieldTextarea value={data.conditional_details} onChange={v => onChange({ conditional_details: v })} placeholder="Describe the conditions and what needs to be resolved…" />
                        </Question>
                    </div>
                )}

                {(data.approval_status === 'approved' || data.approval_status === 'conditional') && (
                    <>
                        <Question label="Approval / decision date" required>
                            <FieldInput type="date" value={data.approval_date} onChange={v => onChange({ approval_date: v })} />
                        </Question>
                        <Question label="Approved rate">
                            <FieldInput type="number" value={data.approved_rate} onChange={v => onChange({ approved_rate: v ? parseFloat(v) : undefined })} placeholder="e.g. 2.75" suffix="%" />
                        </Question>
                    </>
                )}

                {data.bank_queries && (
                    <div className="sm:col-span-2">
                        <CheckItem checked={data.bank_queries_resolved} onChange={v => onChange({ bank_queries_resolved: v })} label="All bank queries have been resolved" />
                    </div>
                )}
            </div>

            <Question label="Bank queries raised">
                <FieldTextarea value={data.bank_queries} onChange={v => onChange({ bank_queries: v })} placeholder="Any questions or document requests from the bank…" />
            </Question>

            <Question label="Follow-up notes">
                <FieldTextarea value={data.followup_notes} onChange={v => onChange({ followup_notes: v })} placeholder="Chase log, client updates, any issues…" />
            </Question>

            <StepActions
                isComplete={isComplete}
                onMarkComplete={onMarkComplete}
                onMarkIncomplete={onMarkIncomplete}
                completionLabel="Bank approved — Letter of Offer received"
            />
        </div>
    )
}
