'use client'

import { RefinancingStep6_CollectDocuments, RefinancingStep2_FactFind } from '@/lib/types/workflow'
import { Question, FieldTextarea, ExpandableCard, ActionList, StepActions, CheckItem } from '../WorkflowStep'

interface Props {
    data: RefinancingStep6_CollectDocuments
    factFind: RefinancingStep2_FactFind
    onChange: (patch: Partial<RefinancingStep6_CollectDocuments>) => void
    isComplete: boolean
    onMarkComplete: () => void
    onMarkIncomplete: () => void
}

export default function Step6CollectDocuments({ data, factFind, onChange, isComplete, onMarkComplete, onMarkIncomplete }: Props) {
    const requiredDocs = [
        { key: 'nric_ready' as const, label: 'NRIC (front and back)', hint: 'Check it is not expired' },
        ...(!factFind.is_self_employed
            ? [{ key: 'payslips_ready' as const, label: 'Last 3 months payslips', hint: 'Must be consecutive months, employer-stamped or with letterhead' }]
            : [{ key: 'noa_ready' as const, label: 'Notice of Assessment (NOA) — last 2 years', hint: 'From IRAS, for self-employed clients' }]),
        { key: 'cpf_contribution_ready' as const, label: 'CPF contribution history — 12 months', hint: 'Download from cpf.gov.sg → My Statement → CPF Transactions' },
        { key: 'loan_statement_ready' as const, label: 'Current bank loan statement', hint: 'Shows outstanding principal — must be the latest statement' },
        { key: 'property_valuation_ready' as const, label: 'Property valuation report', hint: 'New bank will usually order this — confirm with them first' },
        ...(factFind.subsidy_received
            ? [{ key: 'subsidy_letter_ready' as const, label: 'Subsidy/clawback letter from current bank', hint: 'Required to confirm clawback terms for the new bank' }]
            : []),
    ]

    const totalRequired = requiredDocs.filter(d => d.key !== 'property_valuation_ready').length
    const collected = requiredDocs.filter(d => d.key !== 'property_valuation_ready' && data[d.key]).length

    return (
        <div className="space-y-5 pt-4">
            <ActionList actions={[
                'Send the client the document checklist via WhatsApp immediately after verbal commitment.',
                'Follow up within 48 hours to confirm documents are being gathered.',
                'Check each document as received — validate completeness and dates.',
                'If client is self-employed: NOA instead of payslips; confirm bank will accept.',
                'Property valuation — confirm whether new bank orders this or client needs to arrange.',
                'Do not submit to bank until all required docs are in hand.',
            ]} />

            {/* Progress indicator */}
            <div className="bg-slate-50 rounded-lg px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold text-slate-600">Document collection progress</p>
                    <p className="text-xs font-bold text-slate-700">{collected}/{totalRequired} required docs</p>
                </div>
                <div className="h-1.5 bg-slate-200 rounded-full">
                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${totalRequired > 0 ? (collected / totalRequired) * 100 : 0}%` }} />
                </div>
            </div>

            <div className="space-y-2">
                <ExpandableCard variant="script" title="WhatsApp document checklist message to send">
                    {`"Hi [Name]! Great news — I have the recommendation ready and we're set to proceed. To submit to [Bank] on your behalf, I'll need the following documents from you:

1. NRIC (front and back)
2. ${factFind.is_self_employed ? 'Notice of Assessment (NOA) — last 2 years from IRAS' : 'Last 3 months payslips (most recent: [month])'}
3. CPF contribution history — 12 months (download from cpf.gov.sg)
4. Latest bank loan statement (showing outstanding balance)${factFind.subsidy_received ? '\n5. Subsidy/cashback letter from [Current Bank]' : ''}

Can you send these over WhatsApp? I'll handle everything from there. If any are hard to get, let me know and I'll guide you."`}
                </ExpandableCard>
                <ExpandableCard variant="script" title="If client delays sending documents">
                    {`"Hey [Name], just following up on the documents! I want to make sure we don't lose the window — [Bank]'s current rate is valid until end of [month]. If we can submit this week, we're in good shape.

The main one I'm waiting on is the [specific document]. Is that easy to get? I can guide you step by step if needed."`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="CPF contribution history — how to guide the client">
                    {`Clients often don't know where to find this. Guide them: go to cpf.gov.sg, log in with Singpass, navigate to 'My Statement', select 'CPF Transactions' and download the last 12 months.

The bank needs to see that CPF contributions match the income declared on payslips — it's a consistency check. For clients who changed jobs in the last year, make sure the statement covers both employment periods.`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="What banks check on each document">
                    {`Payslips: must be consecutive months with no gap. Banks verify employer name, NRIC, monthly salary, and CPF deduction.

CPF statement: cross-checked against payslips to verify income consistency.

Loan statement: needed to confirm outstanding principal (determines LTV) and check for any arrears.

NOA (self-employed): bank uses declared income from IRAS — sometimes significantly lower than actual drawings. This can affect TDSR. Warn self-employed clients early.

NRIC: check it is not expired. Expired NRIC is a common oversight that causes bank rejections.`}
                </ExpandableCard>
            </div>

            <div className="space-y-1">
                {requiredDocs.map(doc => (
                    <CheckItem
                        key={doc.key}
                        checked={data[doc.key] as boolean | undefined}
                        onChange={v => onChange({ [doc.key]: v })}
                        label={doc.label}
                        hint={doc.hint}
                    />
                ))}
            </div>

            <Question label="Document collection notes">
                <FieldTextarea value={data.docs_notes} onChange={v => onChange({ docs_notes: v })} placeholder="Any issues with documents, client follow-up notes…" />
            </Question>

            <StepActions isComplete={isComplete} onMarkComplete={onMarkComplete} onMarkIncomplete={onMarkIncomplete} completionLabel="All required documents collected" />
        </div>
    )
}
