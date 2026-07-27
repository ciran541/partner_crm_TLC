/**
 * "Documents to prepare" — the list of documents a client must gather for a case,
 * derived from what the workflow already captured (case type, property type,
 * current bank, each borrower's employment).
 *
 * Items backed by the HDB/CPF/IRAS retrieval guide carry a `guideDocId` so the UI
 * can offer a "How to retrieve" walkthrough; text-only items (payslips, a bank loan
 * statement) don't come from a self-service portal.
 *
 * Pure data — the "Documents to prepare" section in each workflow's Next-step card
 * renders it, and it applies to digital and manual banks alike.
 */

import { realBorrowers, type SubmissionBorrower } from '@/lib/insurance/bankSubmission'

export type CaseType = 'Refinancing' | 'Purchase' | 'Decouple' | 'Equity Loan'

export interface CaseDocument {
    /** Stable key for tick tracking (documents_done). */
    id: string
    label: string
    note?: string
    /** Document id in DOC_RETRIEVAL_GUIDE — set when a retrieval walkthrough exists. */
    guideDocId?: string
}

export interface CaseDocumentsInput {
    caseType: CaseType
    isHdb?: boolean          // HDB flat (only Refinancing can carry HDB docs)
    onHdbLoan?: boolean      // HDB flat financed by HDB itself (current_bank === 'HDB')
    fullyPaid?: boolean      // Equity Loan — no current loan, so no loan statement
    borrowers?: SubmissionBorrower[]
}

// ── Reusable document definitions ──────────────────────────────────────────────
const BANK_STATEMENT: CaseDocument = {
    id: 'bank-loan-statement',
    label: 'Latest loan statement from current bank',
    note: 'From your current bank',
}
const HDB_FINANCIAL: CaseDocument = {
    id: 'hdb-financial-info',
    label: 'HDB Financial Information',
    guideDocId: 'hdb-financial-info',
}
const HDB_SOA: CaseDocument = {
    id: 'hdb-soa',
    label: 'HDB Housing Loan Statement of Account',
    guideDocId: 'hdb-soa',
}
const HDB_FLAT_DETAILS: CaseDocument = {
    id: 'hdb-flat-details',
    label: 'HDB Flat Details',
    guideDocId: 'hdb-flat-details',
}
const CPF_HOME_OWNERSHIP: CaseDocument = {
    id: 'cpf-home-ownership',
    label: 'CPF Home Ownership Dashboard',
    guideDocId: 'cpf-home-ownership',
}
const CPF_WITHDRAWAL: CaseDocument = {
    id: 'cpf-property-withdrawal',
    label: 'CPF Property Withdrawal (accrued interest)',
    guideDocId: 'cpf-property-withdrawal',
}
const CPF_ACCOUNT_BALANCE: CaseDocument = {
    id: 'cpf-account-balance',
    label: 'CPF Account Balance',
    guideDocId: 'cpf-account-balance',
}
const IRAS_PROPERTY_SUMMARY: CaseDocument = {
    id: 'iras-property-summary',
    label: 'IRAS Property Summary',
    note: 'Confirms number of properties owned (ABSD)',
    guideDocId: 'iras-property-summary',
}

// Per-borrower income documents. Employed → payslips (from employer) + CPF
// contribution history; self-employed → 2-yr NOA + CPF contribution history.
function incomeDocs(borrowers?: SubmissionBorrower[]): CaseDocument[] {
    const real = realBorrowers(borrowers)
    const many = real.length > 1
    const docs: CaseDocument[] = []
    for (const { b, n } of real) {
        const who = many ? `Borrower ${n}` : 'Borrower'
        if (b.employment === 'self_employed') {
            docs.push({ id: `b${n}-noa`, label: `${who} — latest 2 years IRAS Notice of Assessment`, guideDocId: 'iras-noa' })
        } else {
            docs.push({ id: `b${n}-payslip`, label: `${who} — latest 3 months payslips`, note: 'From employer / HR' })
        }
        docs.push({ id: `b${n}-cpf-contrib`, label: `${who} — CPF Contribution History`, guideDocId: 'cpf-contribution-history' })
    }
    return docs
}

/**
 * The documents to prepare for a case, in a sensible collect-order (income first,
 * then loan/property/CPF). De-duped by id so a document never appears twice.
 */
export function caseDocuments(input: CaseDocumentsInput): CaseDocument[] {
    const { caseType, isHdb, onHdbLoan, fullyPaid, borrowers } = input
    const docs: CaseDocument[] = [...incomeDocs(borrowers)]

    switch (caseType) {
        case 'Refinancing':
            if (isHdb) {
                docs.push(HDB_FINANCIAL)
                if (onHdbLoan) docs.push(HDB_SOA)
                else docs.push(BANK_STATEMENT)
                docs.push(HDB_FLAT_DETAILS)
            } else {
                docs.push(BANK_STATEMENT)
            }
            docs.push(CPF_HOME_OWNERSHIP, CPF_WITHDRAWAL)
            break

        case 'Purchase':
            docs.push(IRAS_PROPERTY_SUMMARY, CPF_ACCOUNT_BALANCE)
            break

        case 'Decouple':
            docs.push(
                { ...CPF_WITHDRAWAL, label: 'CPF Property Withdrawal — both owners (accrued interest)' },
                CPF_HOME_OWNERSHIP,
                IRAS_PROPERTY_SUMMARY,
                CPF_ACCOUNT_BALANCE,
            )
            if (isHdb) {
                docs.push(HDB_FINANCIAL)
                if (onHdbLoan) docs.push(HDB_SOA)
                else docs.push(BANK_STATEMENT)
            } else {
                docs.push(BANK_STATEMENT)
            }
            break

        case 'Equity Loan':
            docs.push(CPF_HOME_OWNERSHIP, CPF_WITHDRAWAL)
            if (!fullyPaid) docs.push(BANK_STATEMENT)
            break
    }

    // De-dupe by id, keeping first occurrence (income docs first).
    const seen = new Set<string>()
    return docs.filter(d => (seen.has(d.id) ? false : (seen.add(d.id), true)))
}

// Fields the derivation reads out of a case's workflow_data. Kept loose because the
// public page reads it straight from JSONB; the typed workflow shapes all satisfy it.
interface WorkflowDocFields {
    borrowers?: SubmissionBorrower[]
    property_type?: string
    current_bank?: string
    fully_paid?: boolean
}

/**
 * The one place that maps a case's workflow_data → caseDocuments input, so the
 * agent's in-workflow list and the client's shared page can never drift apart.
 * (Decoupling and Equity Loan are private-property only, so never carry HDB docs.)
 */
export function caseDocumentsFromWorkflow(
    caseType: CaseType,
    wf: WorkflowDocFields | null | undefined,
): CaseDocument[] {
    const w = wf ?? {}
    switch (caseType) {
        case 'Refinancing':
            return caseDocuments({ caseType, isHdb: w.property_type === 'hdb', onHdbLoan: w.current_bank === 'HDB', borrowers: w.borrowers })
        case 'Purchase':
            return caseDocuments({ caseType, borrowers: w.borrowers })
        case 'Decouple':
            return caseDocuments({ caseType, isHdb: false, borrowers: w.borrowers })
        case 'Equity Loan':
            return caseDocuments({ caseType, fullyPaid: w.fully_paid, borrowers: w.borrowers })
    }
}
