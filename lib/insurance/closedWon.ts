import { computeAmortization } from '@/lib/insurance/amortCalc'
import { calculateCommission } from '@/lib/property/commission'
import type { RateScheduleEntry } from '@/lib/types/rates'
import type { SoraRates } from '@/lib/insurance/sora'
import type { Case, CaseType, ClosedLoanKind, ClosedWonLoan } from '@/lib/types'

// ─── Which loans a case type can close, and whether each is required ──────────
export interface ClosedLoanSpec {
    kind: ClosedLoanKind
    label: string
    required: boolean   // false → optional, gated behind a checkbox
}

export const CLOSED_LOAN_SPECS: Record<CaseType, ClosedLoanSpec[]> = {
    Purchase: [
        { kind: 'home', label: 'Home Loan', required: true },
    ],
    Refinancing: [
        { kind: 'home', label: 'Home Loan', required: true },
        { kind: 'equity', label: 'Equity Loan', required: false },
    ],
    'Equity Loan': [
        { kind: 'home', label: 'Home Loan', required: false },
        { kind: 'equity', label: 'Equity Loan', required: true },
    ],
    Decouple: [
        { kind: 'refi_home', label: 'Refinanced Home Loan', required: false },
        { kind: 'new_purchase_home', label: 'New Purchase Home Loan', required: false },
        { kind: 'equity', label: 'Equity Loan', required: false },
    ],
    // Divorce has no structured loan capture yet — treat like a single home loan.
    Divorce: [
        { kind: 'home', label: 'Home Loan', required: false },
    ],
}

export function loanSpecsFor(caseType: CaseType): ClosedLoanSpec[] {
    return CLOSED_LOAN_SPECS[caseType] ?? CLOSED_LOAN_SPECS.Purchase
}

export const CLOSED_LOAN_LABELS: Record<ClosedLoanKind, string> = {
    home: 'Home Loan',
    equity: 'Equity Loan',
    refi_home: 'Refinanced Home Loan',
    new_purchase_home: 'New Purchase Home Loan',
}

const n = (v: unknown): number | undefined => (typeof v === 'number' && v > 0 ? v : undefined)

/**
 * Best-effort prefill of a loan's amount + tenure from the case's workflow_data.
 * The LO may differ — the agent edits afterwards.
 */
export function prefillLoan(
    kind: ClosedLoanKind,
    caseData: Pick<Case, 'case_type' | 'loan_size' | 'existing_loan_amount'>,
    wf: Record<string, unknown>,
): { amount?: number; tenure?: number } {
    const num = (k: string) => n(wf[k])
    switch (caseData.case_type) {
        case 'Purchase':
            return { amount: n(caseData.loan_size), tenure: num('preferred_tenure') }
        case 'Refinancing':
            if (kind === 'equity') return { amount: num('outstanding_equity_loan') ?? num('equity_loan_amount'), tenure: num('preferred_tenure_equity') ?? num('current_equity_loan_tenure') }
            return { amount: n(caseData.existing_loan_amount) ?? num('outstanding_disbursed'), tenure: num('preferred_tenure_refi') ?? num('current_tenure') }
        case 'Equity Loan':
            if (kind === 'home') return { amount: n(caseData.existing_loan_amount) ?? num('outstanding_disbursed'), tenure: num('preferred_tenure_refi') ?? num('current_tenure') }
            return { amount: num('equity_loan_amount'), tenure: num('preferred_tenure_equity') }
        case 'Decouple':
            if (kind === 'refi_home') return { amount: num('outstanding_home_loan'), tenure: num('preferred_tenure_refi') }
            if (kind === 'new_purchase_home') return { amount: num('preferred_purchase_loan'), tenure: num('preferred_tenure_purchase') }
            return { amount: num('equity_loan_amount'), tenure: num('preferred_tenure_equity') }
        default:
            return {}
    }
}

/** Outstanding balance of one loan at the end of the lock-in period. */
export function outstandingAtLockin(
    loan: ClosedWonLoan,
    schedule: RateScheduleEntry[],
    lockinYears: number,
    sora: SoraRates | null,
): number | null {
    if (!loan.amount || !loan.tenure || !lockinYears) return null
    const rows = computeAmortization(loan.amount, loan.tenure, schedule, sora)
    if (!rows.length) return null
    // If lock-in outlasts the tenure, the loan is fully paid.
    const targetYear = Math.min(lockinYears, loan.tenure)
    return rows.find(r => r.year === targetYear)?.balance ?? null
}

export interface ClosedWonTotals {
    originalLoanTotal: number       // Σ loan amounts (this close)
    combinedOutstanding: number | null  // Σ balances at lock-in end (null if not computable)
    thisCommission: ReturnType<typeof calculateCommission>
    nextCommission: ReturnType<typeof calculateCommission> | null
}

/**
 * Roll up the closed loans into the commission earned this cycle and the
 * projected commission at the next refinance (post-lock-in outstanding × 0.15%).
 */
export function closedWonTotals(
    loans: ClosedWonLoan[],
    schedule: RateScheduleEntry[],
    lockinYears: number,
    sora: SoraRates | null,
): ClosedWonTotals {
    const valid = loans.filter(l => l.amount > 0 && l.tenure > 0)
    const originalLoanTotal = valid.reduce((s, l) => s + l.amount, 0)

    let combinedOutstanding: number | null = null
    if (lockinYears > 0 && schedule.length > 0) {
        let sum = 0
        let any = false
        for (const l of valid) {
            const bal = outstandingAtLockin(l, schedule, lockinYears, sora)
            if (bal != null) { sum += bal; any = true }
        }
        combinedOutstanding = any ? sum : null
    }

    return {
        originalLoanTotal,
        combinedOutstanding,
        thisCommission: calculateCommission(originalLoanTotal),
        nextCommission: combinedOutstanding != null ? calculateCommission(combinedOutstanding) : null,
    }
}

/** Short human summary stored on closed_package_details for list/overview display. */
export function packageSummary(schedule: RateScheduleEntry[], lockinYears: number): string {
    const years = schedule.filter(e => !e.thereafter)
    const first = years[0]
    let head = ''
    if (first) {
        head = first.type === 'fixed'
            ? `${years.length}-Year Fixed @ ${first.rate?.toFixed(2) ?? '—'}%`
            : `Floating ${first.reference ?? ''} + ${first.spread?.toFixed(2) ?? '—'}%`
    }
    const lock = lockinYears > 0 ? ` · ${lockinYears}-yr lock-in` : ''
    return head ? `${head}${lock}` : ''
}
