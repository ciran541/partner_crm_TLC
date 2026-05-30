'use client'

import { RefinancingStep7_SubmitBank } from '@/lib/types/workflow'
import { Question, FieldInput, FieldTextarea, ExpandableCard, ActionList, StepActions } from '../WorkflowStep'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'

interface Props {
    data: RefinancingStep7_SubmitBank
    onChange: (patch: Partial<RefinancingStep7_SubmitBank>) => void
    isComplete: boolean
    onMarkComplete: () => void
    onMarkIncomplete: () => void
}

export default function Step7SubmitBank({ data, onChange, isComplete, onMarkComplete, onMarkIncomplete }: Props) {
    return (
        <div className="space-y-5 pt-4">
            <ActionList actions={[
                'Compile all documents into a complete submission package (PDF or via bank\'s broker portal).',
                'Complete the bank\'s loan application form — double-check NRIC, loan amount, tenure, and property details.',
                'Attach subsidy letter if applicable; note the clawback clause to the bank relationship manager.',
                'Submit via the bank\'s broker portal or through your relationship manager.',
                'Record the submission date and reference number immediately.',
                'Notify the client: "I\'ve submitted your application to [Bank]. Expect a response within 5–10 business days."',
            ]} />

            <div className="space-y-2">
                <ExpandableCard variant="script" title="Client notification message after submission">
                    {`"Hi [Name], good news — I've just submitted your refinancing application to [Bank] today. Your reference number is [REF]. The bank typically takes 5–10 business days to come back with a decision.

I'll keep you updated and will chase if I don't hear by [date]. In the meantime, no action needed from you. I'll be in touch!"`}
                </ExpandableCard>
                <ExpandableCard variant="script" title="What to double-check before submitting">
                    {`Run through this mental checklist:
1. Is the property address exactly as per the title deed?
2. Is the outstanding loan amount as per the latest statement — not an estimate?
3. Are all payslips dated and employer-stamped?
4. Is the CPF statement showing the full 12 months requested?
5. Are all borrowers' NRICs valid and not expired?

A single document error can delay approval by 1–2 weeks.`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="How the submission process works in Singapore">
                    {`Most major banks have dedicated broker portals: DBS/POSB Broker Online, OCBC Broker Hub, UOB Mortgage Broker. Upload documents and submit there.

For smaller banks (Maybank, CIMB, Standard Chartered): submit via email to your relationship manager.

Processing time: typically 5–10 business days for straightforward cases, up to 15 days if additional verification needed.

Banks may issue an In-Principle Approval (IPA) first if they need to check the property valuation, followed by a formal Letter of Offer.`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="Valuation — who orders it">
                    {`For refinancing, the receiving bank typically orders the valuation themselves and absorbs the cost. The client does not need to arrange this.

However, if the client already has a recent valuation report (within 3–6 months), some banks will accept it, which speeds up the process.

Always check with the bank's relationship manager on their current policy before asking the client to pay for a valuation.`}
                </ExpandableCard>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Question label="Submission date" required>
                    <FieldInput type="date" value={data.submission_date} onChange={v => onChange({ submission_date: v })} />
                </Question>

                <Question label="Bank submitted to" required>
                    <InsuranceBankDropdown value={data.submitted_bank ?? ''} onChange={v => onChange({ submitted_bank: v })} placeholder="Select bank…" />
                </Question>

                <Question label="Package submitted for">
                    <FieldInput value={data.submitted_package} onChange={v => onChange({ submitted_package: v })} placeholder="e.g. 2-Year Fixed @ 2.75%" />
                </Question>

                <Question label="Reference / case number" required>
                    <FieldInput value={data.reference_number} onChange={v => onChange({ reference_number: v })} placeholder="Bank reference number" />
                </Question>
            </div>

            <Question label="Submission notes">
                <FieldTextarea value={data.submit_notes} onChange={v => onChange({ submit_notes: v })} placeholder="Bank contact, any issues during submission, notes for follow-up…" />
            </Question>

            <StepActions isComplete={isComplete} onMarkComplete={onMarkComplete} onMarkIncomplete={onMarkIncomplete} completionLabel="Application submitted to bank" />
        </div>
    )
}
