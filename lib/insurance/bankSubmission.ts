/**
 * Bank submission mode + the post-decision "what to do next" process checklist.
 *
 * Once the agent has picked a package, the bank is known — and every bank either
 * takes a fully digital application (banker emails the client a link; the FA does
 * nothing) or a manual document pack. This module classifies the bank and, for the
 * digital ones, builds the submission process checklist that replaces the generic
 * advisory steps in the workflow's "What to do next" list.
 *
 * The *documents* the client must gather live in the separate "Documents to prepare"
 * section (lib/insurance/caseDocuments.ts) — that list is comprehensive and applies
 * to digital and manual banks alike, so this checklist stays purely about the flow
 * (banker link → approval buffer → Letter of Offer → law firm).
 *
 * Bank names in a package snapshot are free-text (admins type them during rate
 * ingestion), so we normalise to a canonical key with aliases before classifying.
 * Manual banks (DBS/BOC/SBI) fall through to the existing generic steps for now.
 */

export type BankSubmissionMode = 'digital' | 'manual' | 'tbc'

// Canonical key → submission mode. Keys are the normalised form (see normalizeBankKey).
const BANK_SUBMISSION_MODE: Record<string, BankSubmissionMode> = {
    ocbc: 'digital',
    uob: 'digital',
    scb: 'digital',
    hsbc: 'digital',
    maybank: 'digital',

    dbs: 'manual',
    boc: 'manual',
    sbi: 'manual',

    cimb: 'tbc',
    citi: 'tbc',
    rhb: 'tbc',
}

// Free-text bank name → canonical key. Handles the common long-form / short-form
// aliases so "Standard Chartered", "SCB" and "Std Chartered" all land on `scb`.
export function normalizeBankKey(bank?: string): string {
    const s = (bank ?? '').toLowerCase().replace(/[^a-z]/g, '')
    if (!s) return ''
    if (s.includes('standardchartered') || s === 'scb' || s.includes('stdchartered')) return 'scb'
    if (s.includes('bankofchina') || s === 'boc') return 'boc'
    if (s.includes('statebankofindia') || s === 'sbi') return 'sbi'
    if (s.includes('maybank')) return 'maybank'
    if (s.includes('hsbc')) return 'hsbc'
    if (s.includes('ocbc')) return 'ocbc'
    if (s.includes('uob') || s.includes('unitedoverseas')) return 'uob'
    if (s.includes('dbs') || s.includes('posb')) return 'dbs'
    if (s.includes('cimb')) return 'cimb'
    if (s.includes('citi')) return 'citi'
    if (s.includes('rhb')) return 'rhb'
    return s
}

// Unknown / unclassified banks are treated as 'tbc' (no auto-checklist yet).
export function bankSubmissionMode(bank?: string): BankSubmissionMode {
    return BANK_SUBMISSION_MODE[normalizeBankKey(bank)] ?? 'tbc'
}

// A borrower, as far as the workflow guidance cares. Employment drives which income
// documents to ask for; age / basic_salary / non_borrower decide whether the slot is
// a real loan borrower at all (the workflows store a fixed-length borrowers array
// padded with empty slots, and purchase can flag an owner who isn't on the loan).
// All four workflow borrower shapes satisfy this.
export interface SubmissionBorrower {
    employment?: 'employed' | 'self_employed'
    age?: number
    basic_salary?: number
    non_borrower?: boolean       // owner not on the loan (purchase)
}

// A slot counts as a real loan borrower once it has an age or income (or an explicit
// employment) — and isn't flagged as a non-loan owner. Mirrors the workflows' own
// "aged borrowers" convention and drops the padded empty slots.
export function isLoanBorrower(b?: SubmissionBorrower): boolean {
    if (!b || b.non_borrower) return false
    return (b.age ?? 0) > 0 || (b.basic_salary ?? 0) > 0 || b.employment != null
}

// Real loan borrowers with their 1-based position preserved (empty/padded slots and
// non-loan owners dropped). Shared by the submission checklist and caseDocuments.
export function realBorrowers(borrowers?: SubmissionBorrower[]): { b: SubmissionBorrower; n: number }[] {
    return (borrowers ?? [])
        .map((b, i) => ({ b, n: i + 1 }))
        .filter(({ b }) => isLoanBorrower(b))
}

/**
 * The digital-bank submission process checklist. FA does nothing — the banker emails
 * the client the link; the client's documents are covered by the "Documents to
 * prepare" section, so this stays purely about the flow.
 */
export function digitalSubmissionActions(bankDisplay: string): string[] {
    return [
        `${bankDisplay} banker will be in touch and email you the digital application link`,
        'Upon completion of the application, allow ~5 working days for loan approval',
        `After accepting the Letter of Offer, choose a law firm on ${bankDisplay}'s panel`,
        'The law firm handles the conveyancing and disbursement of the loan from there',
    ]
}

/**
 * The post-decision submission checklist, or null when it doesn't apply yet.
 *
 * Returns the digital checklist once a digital bank has been picked; null for
 * manual/tbc/unpicked, so callers fall back to their generic advisory steps (refi /
 * purchase) or show nothing (equity loan / decoupling).
 */
export function submissionChecklist(bank?: string): string[] | null {
    if (bankSubmissionMode(bank) !== 'digital') return null
    return digitalSubmissionActions((bank ?? '').trim())
}
