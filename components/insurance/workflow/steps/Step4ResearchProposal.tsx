'use client'

import { RefinancingStep4_ResearchProposal, RefinancingStep1_Qualify, RefinancingStep2_FactFind } from '@/lib/types/workflow'
import { Question, RadioGroup, FieldInput, FieldTextarea, ExpandableCard, ActionList, StepActions, CheckItem } from '../WorkflowStep'
import { ExternalLink } from 'lucide-react'

interface Props {
    data: RefinancingStep4_ResearchProposal
    qualify: RefinancingStep1_Qualify
    factFind: RefinancingStep2_FactFind
    onChange: (patch: Partial<RefinancingStep4_ResearchProposal>) => void
    isComplete: boolean
    onMarkComplete: () => void
    onMarkIncomplete: () => void
}

export default function Step4ResearchProposal({ data, qualify, factFind, onChange, isComplete, onMarkComplete, onMarkIncomplete }: Props) {
    // Auto-calculate net savings helper
    const monthlySaving = data.monthly_saving ?? 0
    const clawback = factFind.clawback_amount ?? 0
    const netSaving2yr = monthlySaving > 0 ? (monthlySaving * 24) - clawback : null
    const netSaving3yr = monthlySaving > 0 ? (monthlySaving * 36) - clawback : null

    return (
        <div className="space-y-5 pt-4">
            <ActionList actions={[
                'Open the Rates page (link below) and filter by property type and rate preference.',
                'Note 2–3 packages: one "best savings", one "most stability", one backup option.',
                'Calculate new monthly payment for the recommended package.',
                'Compute monthly saving: current monthly payment minus new monthly payment.',
                'Compute net saving: (monthly saving × months) minus clawback amount.',
                'If client is still in lock-in, also subtract the penalty (1.5% of outstanding) from net savings.',
                'Mark proposal ready only if net savings justify the switch.',
            ]} />

            {/* Link to rates page */}
            <a
                href="/insurance/dashboard/rates"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#03a9e7]/40 bg-sky-50 text-sm font-semibold text-[#03a9e7] hover:bg-sky-100 transition-colors w-fit"
            >
                <ExternalLink size={15} />
                Open Rates Page
            </a>

            <div className="space-y-2">
                <ExpandableCard variant="script" title="How to present the net savings calculation">
                    {`"Let me walk you through the numbers. Your current monthly payment is approximately $[X]. The new package I'm recommending is [Bank] [Product] at [rate]%, which brings your monthly payment down to roughly $[Y]. That's a saving of $[Z] per month.

Over 2 years, that's $[Z × 24] in savings. Now, because you received a $[clawback] subsidy, you'd need to return that. After accounting for that, your net saving over 2 years is $[net amount]. That [is/is not] enough to justify refinancing — and here's why…"`}
                </ExpandableCard>
                <ExpandableCard variant="script" title='Handling "Is the saving worth it?"'>
                    {`"I completely understand if this feels like a lot of hassle for not much saving. Let me be honest with you — if the net saving is under $3,000–$5,000 over 2 years, it's borderline.

But if you're on an $800K loan and saving $400/month, that's $9,600 over 2 years even after clawback. That's real money. The question is whether the paperwork effort and 2–3 weeks of your time is worth [net amount] to you."`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="Net savings formula — what to include">
                    {`Full formula:
Net savings = (Current monthly − New monthly) × months until next refi window
  − Clawback to current bank
  − Legal/conveyancing fees if new bank doesn't subsidise (~$1,500–$2,500)
  − Penalty if currently in lock-in (typically 1.5% of outstanding)

If new bank offers legal fee subsidy, that offsets costs.

The months horizon should be until the end of the new lock-in period — that's the true comparison period.`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="Singapore bank packages — what to look for">
                    {`Key factors when comparing packages:
1. Rate during lock-in period — the headline selling point.
2. Reversion rate after lock-in — matters enormously for long-term holders. Some packages have attractive 2-year fixed rates but revert to a high board rate.
3. Lock-in length — shorter is better for clients who might sell or want flexibility.
4. Subsidies offered by new bank — legal fee rebates factor into net savings.
5. Partial redemption flexibility — can client make lump-sum payments without penalty during lock-in?`}
                </ExpandableCard>
            </div>

            {/* Reference data from earlier steps */}
            {(qualify.rough_monthly_payment || qualify.outstanding_loan) && (
                <div className="bg-slate-50 rounded-lg px-4 py-3 text-xs text-slate-600 space-y-1">
                    <p className="font-semibold text-slate-700 text-xs uppercase tracking-wide mb-1">Reference from earlier steps</p>
                    {qualify.current_bank && <p>Current bank: <span className="font-medium text-slate-800">{qualify.current_bank}</span></p>}
                    {qualify.current_rate && <p>Current rate: <span className="font-medium text-slate-800">{qualify.current_rate}%</span></p>}
                    {qualify.outstanding_loan && <p>Outstanding loan: <span className="font-medium text-slate-800">${qualify.outstanding_loan.toLocaleString()}</span></p>}
                    {qualify.rough_monthly_payment && <p>Current monthly payment: <span className="font-medium text-slate-800">${qualify.rough_monthly_payment.toLocaleString()}</span></p>}
                    {factFind.clawback_amount && factFind.clawback_amount > 0 && <p className="text-amber-700 font-semibold">⚠ Clawback: ${factFind.clawback_amount.toLocaleString()} (until {factFind.clawback_end_date ?? '?'})</p>}
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                    <Question label="Recommended package" required>
                        <FieldInput value={data.recommended_package} onChange={v => onChange({ recommended_package: v })} placeholder="e.g. DBS 2-Year Fixed @ 2.75%" />
                    </Question>
                </div>

                <Question label="New interest rate" required>
                    <FieldInput type="number" value={data.new_rate} onChange={v => onChange({ new_rate: v ? parseFloat(v) : undefined })} placeholder="e.g. 2.75" suffix="%" />
                </Question>

                <Question label="New estimated monthly payment">
                    <FieldInput type="number" value={data.new_monthly_payment} onChange={v => onChange({ new_monthly_payment: v ? parseFloat(v) : undefined })} placeholder="0" prefix="$" />
                </Question>

                <Question label="Monthly saving">
                    <FieldInput type="number" value={data.monthly_saving} onChange={v => onChange({ monthly_saving: v ? parseFloat(v) : undefined })} placeholder="0" prefix="$" />
                </Question>

                {qualify.lock_in_status === 'in_lock_in' && (
                    <Question label="Lock-in break penalty (1.5% of outstanding)">
                        <FieldInput type="number" value={data.penalty_if_in_lockin} onChange={v => onChange({ penalty_if_in_lockin: v ? parseFloat(v) : undefined })} placeholder="0" prefix="$" />
                    </Question>
                )}
            </div>

            {/* Auto-computed net savings */}
            {netSaving2yr !== null && (
                <div className={`rounded-lg px-4 py-3 border ${netSaving2yr > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                    <p className={`text-xs font-bold uppercase tracking-wide mb-1 ${netSaving2yr > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        Net savings estimate (auto-calculated)
                    </p>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <p className="text-slate-500 text-xs">Over 2 years</p>
                            <p className={`font-bold ${netSaving2yr > 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                                {netSaving2yr >= 0 ? '+' : ''}{netSaving2yr > 0 ? `$${netSaving2yr.toLocaleString()}` : `−$${Math.abs(netSaving2yr).toLocaleString()}`}
                            </p>
                        </div>
                        {netSaving3yr !== null && (
                            <div>
                                <p className="text-slate-500 text-xs">Over 3 years</p>
                                <p className={`font-bold ${netSaving3yr > 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                                    {netSaving3yr >= 0 ? '+' : ''}{netSaving3yr > 0 ? `$${netSaving3yr.toLocaleString()}` : `−$${Math.abs(netSaving3yr).toLocaleString()}`}
                                </p>
                            </div>
                        )}
                    </div>
                    {netSaving2yr <= 0 && (
                        <p className="text-xs text-red-700 mt-2 font-medium">⚠ Net savings are negative — consider whether refinancing is actually beneficial for this client.</p>
                    )}
                </div>
            )}

            <div className="pt-2">
                <CheckItem
                    checked={data.proposal_ready}
                    onChange={v => onChange({ proposal_ready: v })}
                    label="Proposal is ready to present to the client"
                    hint="Check only after verifying net savings are positive and the recommendation is solid"
                />
            </div>

            <Question label="Proposal notes">
                <FieldTextarea value={data.proposal_notes} onChange={v => onChange({ proposal_notes: v })} placeholder="Notes on package selection, competitor comparison, or anything relevant to the proposal…" />
            </Question>

            <StepActions isComplete={isComplete} onMarkComplete={onMarkComplete} onMarkIncomplete={onMarkIncomplete} completionLabel="Proposal built — ready to present" />
        </div>
    )
}
