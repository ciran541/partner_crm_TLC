'use client'

import { RefinancingStep9_LetterOffer } from '@/lib/types/workflow'
import { Question, FieldInput, FieldTextarea, ExpandableCard, ActionList, StepActions, CheckItem } from '../WorkflowStep'

interface Props {
    data: RefinancingStep9_LetterOffer
    onChange: (patch: Partial<RefinancingStep9_LetterOffer>) => void
    isComplete: boolean
    onMarkComplete: () => void
    onMarkIncomplete: () => void
}

export default function Step9LetterOffer({ data, onChange, isComplete, onMarkComplete, onMarkIncomplete }: Props) {
    return (
        <div className="space-y-5 pt-4">
            <ActionList actions={[
                'Review the Letter of Offer yourself first — confirm rate, tenure, lock-in period, subsidies, and clawback clauses.',
                'Call the client to walk through the LoO together before they sign anything.',
                'Explain the new lock-in period explicitly: penalty if they refinance again before [date].',
                'Explain any new subsidy/clawback from the new bank if applicable.',
                'Confirm the acceptance deadline on the LoO — ensure client acts before it.',
                'Once signed, confirm with both the client and the bank relationship manager.',
            ]} />

            <div className="space-y-2">
                <ExpandableCard variant="script" title="Walking through the LoO — what to cover">
                    {`"Let me highlight the key things in this Letter of Offer:

First, your new rate is [rate]% for [lock-in period] years — after that it reverts to SORA + [spread].

Second, your new monthly payment will be approximately $[amount].

Third, there's a lock-in until [date] — if you sell or refinance before then, the penalty is [1.5% of outstanding].

Fourth, [Bank] is giving you a $[subsidy] legal fee subsidy — if you leave within [period], you'd need to return that.

And finally, you have until [acceptance deadline] to sign and return this.

Do you have any questions?"`}
                </ExpandableCard>
                <ExpandableCard variant="script" title="If client is nervous about commitment">
                    {`"I completely understand — it's a big financial commitment. But remember, this is actually a reduction in your current commitment: same loan, just at a lower rate. You're not increasing your debt, you're optimising it.

The lock-in is [X years], after which you're free to review again. The main risk is if you need to sell the property before [date] — in that case there'd be a penalty. Is that a scenario you're worried about?"`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="What to check in the LoO before the client sees it">
                    {`1. Rate and loan quantum match what was agreed — small discrepancies do occur.
2. Loan tenure is what the client requested — banks sometimes shorten it.
3. Lock-in period is clearly stated.
4. Clawback/subsidy terms from the new bank are correct.
5. Acceptance deadline — usually 2–3 weeks. If client needs more time, ask RM for extension before expiry.
6. Both borrowers are named correctly (if joint loan).
7. Property address matches the title deed exactly.`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="Timeline from LoO acceptance to disbursement">
                    {`After client signs the LoO:
1. Legal firm appointed by new bank begins the conveyancing process.
2. Current bank is notified of the refinancing intent.
3. Redemption statement requested from current bank (showing exact outstanding amount on disbursement date).
4. Legal completion usually takes 4–8 weeks from LoO acceptance.
5. On completion date, new bank disburses the loan to redeem the old one.
6. Client starts paying the new bank from the following month.`}
                </ExpandableCard>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Question label="LoO received date">
                    <FieldInput type="date" value={data.loo_received_date} onChange={v => onChange({ loo_received_date: v })} />
                </Question>

                <Question label="LoO review call date">
                    <FieldInput type="date" value={data.loo_review_date} onChange={v => onChange({ loo_review_date: v })} />
                </Question>

                <div className="sm:col-span-2 space-y-2 pt-2">
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Review checklist</p>
                    <CheckItem checked={data.loo_reviewed_with_client} onChange={v => onChange({ loo_reviewed_with_client: v })} label="Reviewed LoO with client on a call" hint="Required — do not let client sign without walking them through it" />
                    <CheckItem checked={data.lock_in_explained} onChange={v => onChange({ lock_in_explained: v })} label="New lock-in period and penalty explained to client" />
                    <CheckItem checked={data.clawback_explained} onChange={v => onChange({ clawback_explained: v })} label="New bank's clawback terms explained (if applicable)" />
                    <CheckItem checked={data.client_accepted} onChange={v => onChange({ client_accepted: v })} label="Client has signed and accepted the LoO" />
                </div>

                {data.client_accepted && (
                    <Question label="Acceptance date">
                        <FieldInput type="date" value={data.acceptance_date} onChange={v => onChange({ acceptance_date: v })} />
                    </Question>
                )}
            </div>

            <Question label="LoO notes">
                <FieldTextarea value={data.loo_notes} onChange={v => onChange({ loo_notes: v })} placeholder="Any terms to flag, client concerns, or deviations from what was proposed…" />
            </Question>

            <StepActions isComplete={isComplete} onMarkComplete={onMarkComplete} onMarkIncomplete={onMarkIncomplete} completionLabel="LoO reviewed and accepted — ready to close" />
        </div>
    )
}
