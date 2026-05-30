'use client'

import { RefinancingStep10_CloseRetention } from '@/lib/types/workflow'
import { Question, FieldInput, FieldTextarea, ExpandableCard, ActionList, StepActions } from '../WorkflowStep'

interface Props {
    data: RefinancingStep10_CloseRetention
    onChange: (patch: Partial<RefinancingStep10_CloseRetention>) => void
    isComplete: boolean
    onMarkComplete: () => void
    onMarkIncomplete: () => void
}

export default function Step10CloseRetention({ data, onChange, isComplete, onMarkComplete, onMarkIncomplete }: Props) {
    return (
        <div className="space-y-5 pt-4">
            <ActionList actions={[
                'Confirm with the client that legal completion has occurred and the new bank loan is active.',
                'Record the final package details below — these will populate the Closed Won fields.',
                'Confirm the new clawback end date so you know the next natural refinancing window.',
                'Set a retention reminder: lock-in expiry date minus 3 months.',
                'Send the closing congratulations message to the client.',
                'Mark this case as Closed Won using the Closure tab — the case is complete.',
            ]} />

            <div className="space-y-2">
                <ExpandableCard variant="script" title="Closing message to send the client">
                    {`"Hi [Name], congratulations — your refinancing is now complete! You're officially on [Bank] at [rate]%, saving approximately $[amount] per month compared to before. Your new lock-in runs until [date].

I'll be in touch around [retention reminder date] to review the market and make sure you're still on the best rate at that point. Thank you for trusting me with this — it was a pleasure working with you.

Do reach out anytime if you have questions. And if you know any friends or family who might benefit from a home loan review, I'd really appreciate an introduction! 😊"`}
                </ExpandableCard>
                <ExpandableCard variant="script" title="Planting the referral seed">
                    {`"One more thing — if you know any family or friends who have home loans and haven't reviewed their rate recently, I'd be grateful for an introduction. With rates moving the way they are, a lot of people are overpaying without realising it. Happy to do a quick no-obligation review for anyone you think could benefit."`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="When to set the retention reminder">
                    {`The optimal contact window is 3 months before the new lock-in expiry. For a 2-year fixed package disbursed in July 2026, the lock-in ends July 2028 — set a reminder for April 2028.

This gives enough time to: review rates, prepare the proposal, collect documents, submit, and complete before any penalty applies.

If the client also has a clawback period, note that the clawback end date is an important trigger: once clawback expires, the client can refinance penalty-free even within the lock-in period from the same bank.`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="Why retention is the most important step">
                    {`A client who refinanced with your help is the easiest sale you'll ever have. They've been through the process with you, they trust you, and in 2 years they face the exact same situation again.

The Singapore market is such that almost every borrower refinances every 2–3 years at lock-in expiry. If you don't set the reminder now, a competitor will be in touch before you are.

Agents who are systematic about retention dramatically outperform those who rely on memory.`}
                </ExpandableCard>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                    <Question label="Final package" required>
                        <FieldInput value={data.final_package} onChange={v => onChange({ final_package: v })} placeholder="e.g. DBS 2-Year Fixed @ 2.75%" />
                    </Question>
                </div>

                <Question label="Final interest rate" required>
                    <FieldInput type="number" value={data.final_rate} onChange={v => onChange({ final_rate: v ? parseFloat(v) : undefined })} placeholder="e.g. 2.75" suffix="%" />
                </Question>

                <Question label="Loan tenure">
                    <FieldInput type="number" value={data.final_tenure} onChange={v => onChange({ final_tenure: v ? parseInt(v) : undefined })} placeholder="e.g. 25" suffix="yrs" />
                </Question>

                <Question label="New monthly payment">
                    <FieldInput type="number" value={data.final_monthly_payment} onChange={v => onChange({ final_monthly_payment: v ? parseFloat(v) : undefined })} placeholder="0" prefix="$" />
                </Question>

                <Question label="Subsidy granted by new bank">
                    <FieldInput value={data.subsidy_granted} onChange={v => onChange({ subsidy_granted: v })} placeholder="e.g. $2,000 legal fee rebate" />
                </Question>

                <Question label="New clawback end date">
                    <FieldInput type="date" value={data.clawback_end_date_new} onChange={v => onChange({ clawback_end_date_new: v })} />
                </Question>

                <Question label="Retention reminder date" required>
                    <FieldInput type="date" value={data.retention_reminder_date} onChange={v => onChange({ retention_reminder_date: v })} />
                </Question>
            </div>

            {data.retention_reminder_date && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                    <p className="text-sm font-semibold text-emerald-800">
                        📅 Retention reminder set for {new Date(data.retention_reminder_date).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                    <p className="text-xs text-emerald-700 mt-0.5">You'll be prompted to contact this client before their lock-in expiry.</p>
                </div>
            )}

            <Question label="Closing notes">
                <FieldTextarea value={data.close_notes} onChange={v => onChange({ close_notes: v })} placeholder="Any final notes, referrals mentioned, or follow-up context…" />
            </Question>

            <StepActions isComplete={isComplete} onMarkComplete={onMarkComplete} onMarkIncomplete={onMarkIncomplete} completionLabel="Case closed — mark Closed Won in Closure tab" />
        </div>
    )
}
