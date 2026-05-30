'use client'

import { RefinancingStep5_PresentProposal } from '@/lib/types/workflow'
import { Question, RadioGroup, FieldInput, FieldTextarea, ExpandableCard, ActionList, StepActions } from '../WorkflowStep'

interface Props {
    data: RefinancingStep5_PresentProposal
    onChange: (patch: Partial<RefinancingStep5_PresentProposal>) => void
    isComplete: boolean
    onMarkComplete: () => void
    onMarkIncomplete: () => void
}

export default function Step5PresentProposal({ data, onChange, isComplete, onMarkComplete, onMarkIncomplete }: Props) {
    return (
        <div className="space-y-5 pt-4">
            <ActionList actions={[
                'Open with a summary: "I\'ve done the analysis and I have a recommendation for you."',
                'Present: current situation (rate, payment), recommended package, net saving.',
                'Explain the lock-in on the new package and clawback on existing loan if applicable.',
                'Ask directly: "Does this make sense to you? Are you happy to proceed?"',
                'Handle objections (use scripts below) — never push if the client is unsure.',
                'If verbal commitment received, explain next steps: "I\'ll send you a document checklist now."',
            ]} />

            <div className="space-y-2">
                <ExpandableCard variant="script" title="The recommendation opening">
                    {`"I've done the full analysis for you. Here's where you are right now: [Bank], at [current rate]%, paying around $[monthly] per month.

I've found a package that brings you to [new rate]% with [new bank] — that's $[saving] less per month. After accounting for the $[clawback] clawback, you're still saving $[net] net over [period].

I'd recommend you take this. Would you like to proceed?"`}
                </ExpandableCard>
                <ExpandableCard variant="script" title='When they say "Let me think about it"'>
                    {`"Absolutely, take your time. The one thing I'd flag is: if your lock-in expires in [date], we ideally need to start the process [X weeks] before that to avoid any gap. The bank submission and approval process takes about 4–6 weeks.

So if you're thinking of doing this, we'd want to move by [date]. I'll check in with you on [follow-up date] — does that work?"`}
                </ExpandableCard>
                <ExpandableCard variant="script" title='Objection: "I saw a lower rate online"'>
                    {`"Online rates are sometimes 'from' rates — the headline rate for the absolute best-case borrower profile. The actual rate you qualify for depends on your loan-to-value, your income, and the specific package terms.

I'd encourage you to apply through me — I submit to multiple banks simultaneously and can negotiate on your behalf. At worst, if a direct application gives you a genuinely better rate, you go direct.

But most of the time, going through a broker gets you access to banker-exclusive packages that aren't advertised publicly."`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="Why verbal commitment before document collection">
                    {`Collecting and submitting documents is significant effort for both you and the client. Chasing documents from a client who isn't actually committed leads to ghost cases and wasted cycles.

The verbal commitment step is a filter — if the client won't say "yes, proceed" after seeing the numbers, they're either not sold yet or the economics don't work for them. Either is fine to discover here rather than after you've spent 2 hours on document collection.`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="Common objections and what they usually mean">
                    {`"Let me think about it" — usually means they want reassurance or have an unstated concern. Try to surface it: "Is there anything that's making you hesitant?"

"My rate isn't that bad" — usually means they haven't internalised the savings. Show the dollar amount explicitly: "$[X] per month, that's $[X × 12] per year."

"I'm too busy" — a process objection, not a financial one. Offer to handle everything: "You just need to WhatsApp me 5 documents. I handle the rest."`}
                </ExpandableCard>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Question label="Date proposal presented" required>
                    <FieldInput type="date" value={data.proposal_presented_date} onChange={v => onChange({ proposal_presented_date: v })} />
                </Question>

                <div className="sm:col-span-2">
                    <Question label="Client's response" required>
                        <RadioGroup
                            value={data.client_response}
                            onChange={v => onChange({ client_response: v as any, objection_details: v !== 'objection' ? undefined : data.objection_details })}
                            options={[
                                { value: 'committed', label: '✓ Committed — let\'s proceed' },
                                { value: 'needs_time', label: '⏳ Needs time to think' },
                                { value: 'objection', label: '❓ Has an objection' },
                                { value: 'declined', label: '✗ Declined' },
                            ]}
                        />
                    </Question>
                </div>

                {data.client_response === 'objection' && (
                    <div className="sm:col-span-2">
                        <Question label="Describe the objection">
                            <FieldTextarea value={data.objection_details} onChange={v => onChange({ objection_details: v })} placeholder="What was the objection and how did you handle it?" />
                        </Question>
                    </div>
                )}

                {(data.client_response === 'needs_time' || data.client_response === 'objection') && (
                    <Question label="Follow-up date">
                        <FieldInput type="date" value={data.follow_up_date} onChange={v => onChange({ follow_up_date: v })} />
                    </Question>
                )}
            </div>

            <Question label="Presentation notes">
                <FieldTextarea value={data.present_notes} onChange={v => onChange({ present_notes: v })} placeholder="Any other context from the proposal presentation…" />
            </Question>

            <StepActions isComplete={isComplete} onMarkComplete={onMarkComplete} onMarkIncomplete={onMarkIncomplete} completionLabel="Proposal presented — client verbal commitment received" />
        </div>
    )
}
