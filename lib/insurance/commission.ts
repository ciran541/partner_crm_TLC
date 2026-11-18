import { calculateCommission, type CommissionResult } from '@/lib/property/commission'
import { isDraftCase } from '@/lib/insurance/caseFilters'
import type { Case } from '@/lib/types'

/**
 * Insurance commission model — reuses the property calculation (loan × 0.15%,
 * agent 90% / TLC 10%). Amounts are derived on the fly; only paid/unpaid state
 * is persisted on the case (commission_status).
 */

export type CommissionBucket = 'open' | 'closed_unpaid' | 'closed_paid'

const CLOSED_WON = 'Closed Won'
const CLOSED_LOST = 'Closed Lost'

export const CORRECTION_FEE = 50

export function commissionWithFee(loan: number, fee = 0): CommissionResult & { correctionFee: number } {
    const base = calculateCommission(loan)
    const correctionFee = Number.isFinite(fee) ? Math.max(0, Math.round(fee * 100) / 100) : 0
    return { ...base, agent: Math.round((base.agent - correctionFee) * 100) / 100, tlc: Math.round((base.tlc + correctionFee) * 100) / 100, correctionFee }
}

/** The loan figure a case's commission is based on. */
export function caseLoanBase(c: Case): number {
    if (c.stage === CLOSED_WON) {
        const total = c.closed_won_data?.original_loan_total
        if (total && total > 0) return total
    }
    const base = (c.case_type === 'Refinancing' || c.case_type === 'Equity Loan')
        ? c.existing_loan_amount
        : c.loan_size
    return base && base > 0 ? base : 0
}

/** Which earnings bucket a case falls into (null = excluded: drafts, closed lost, inactive). */
export function commissionBucket(c: Case): CommissionBucket | null {
    if (isDraftCase(c)) return null
    if (c.stage === CLOSED_LOST) return null
    // Past clients parked for follow-up — not live pipeline, so not potential
    // revenue. Mirrored in SQL by migration 20261118000000_inactive_stage.sql.
    if (c.stage === 'Inactive') return null
    if (c.stage === CLOSED_WON) return c.commission_status === 'paid' ? 'closed_paid' : 'closed_unpaid'
    return 'open'
}

export function caseCommission(c: Case) {
    return commissionWithFee(caseLoanBase(c), c.correction_fee)
}

export interface CommissionTotals {
    open: number            // agent-share $ of active pipeline
    closedUnpaid: number    // agent-share $ of closed-won, not yet paid
    closedPaid: number      // agent-share $ of closed-won, paid out
    activeCases: number     // count of active (open-bucket) cases
    total: number           // open + closedUnpaid + closedPaid
}

export function commissionTotals(cases: Case[]): CommissionTotals {
    let open = 0, closedUnpaid = 0, closedPaid = 0, activeCases = 0
    for (const c of cases) {
        const bucket = commissionBucket(c)
        if (!bucket) continue
        const agent = caseCommission(c).agent
        if (bucket === 'open') { open += agent; activeCases++ }
        else if (bucket === 'closed_unpaid') closedUnpaid += agent
        else closedPaid += agent
    }
    return { open, closedUnpaid, closedPaid, activeCases, total: open + closedUnpaid + closedPaid }
}

export interface AgentCommissionRow extends CommissionTotals {
    agentId: string
    agentName: string
}

/** Aggregate commission per agent across the full agent roster (zero-case agents included). */
export function commissionByAgent(
    cases: Case[],
    roster: { id: string; name: string }[],
): AgentCommissionRow[] {
    const byAgent = new Map<string, Case[]>()
    for (const c of cases) {
        if (!c.created_by) continue
        const arr = byAgent.get(c.created_by) ?? []
        arr.push(c)
        byAgent.set(c.created_by, arr)
    }
    return roster
        .map(a => ({ agentId: a.id, agentName: a.name, ...commissionTotals(byAgent.get(a.id) ?? []) }))
        .sort((a, b) => b.total - a.total)
}
