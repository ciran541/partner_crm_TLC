/**
 * Pre-determined, dynamic advisory remarks for the Refinancing workflow.
 *
 * Copy is fixed (the agent's standard talking points), but which bullets appear —
 * and the figures inside them — adapt to the client's inputs (property type,
 * outstanding amount, undisbursed/cancellation exposure, subsidy clawback, and the
 * plans they've flagged for the next 1–3 years).
 */

import type { RefiPropertyType, RefiCost, RefiConsiderationsInput } from '@/lib/insurance/refiCalc'

export interface RefiRemarkContext {
    propertyType?: RefiPropertyType
    isPrivate?: boolean
    buc?: boolean
    totalOutstanding?: number
    undisbursed?: number
    subsidyClawback?: number
    smallLoanNoSubsidy?: boolean
    considerations?: RefiConsiderationsInput
    cost?: RefiCost
    tenureError?: string | null
}

export interface RefiRemarks {
    alerts: string[]          // input-driven warnings (amber)
    standard: string[]        // always shown
    conditional: string[]     // tailored to the inputs / plans
    cost: string[]            // cost-of-refinancing block
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`

// Always shown, regardless of inputs.
const STANDARD_REMARKS: string[] = [
    'Most banks have a 6-month validity period on their Letter of Offer, so the lock-in end date cannot be more than 6 months away from the date on the LO. Maybank has a 4-month validity period.',
    'After accepting a fixed rate offer, the fixed rates start 3 months from the date on the Letter of Offer, or at loan disbursement — whichever comes earlier.',
    'Whenever a bank provides a subsidy, most come with a 3-year clawback period — if you sell or change banks within 3 years, you will need to return the subsidy to the bank.',
]

function conditionalRemarks(ctx: RefiRemarkContext): string[] {
    const out: string[] = []
    const c = ctx.considerations ?? {}

    if (ctx.buc || (ctx.undisbursed ?? 0) > 0) {
        out.push('As there will potentially be cancellation fees levied on your undisbursed loan amount, we will factor this additional cost into the financial planning.')
    }
    if (ctx.smallLoanNoSubsidy) {
        const threshold = ctx.isPrivate ? '$500k' : '$250k'
        out.push(`Due to the outstanding loan amount being small (below ${threshold}), the new bank may not provide any subsidy.`)
    }
    if ((ctx.subsidyClawback ?? 0) > 0) {
        out.push('As there is a potential subsidy clawback, we will factor this additional cost into the financial planning.')
    }
    if (c.sell) {
        out.push('As there is a chance of selling, ensure your next package has a "Waiver of Penalty due to Sale" clause — this waives the 1.5% penalty fee in the event of a sale.')
    }
    if (c.decouple) {
        out.push('A "Waiver of Penalty due to Sale" feature may not cover decoupling for certain banks.')
        out.push('Recommended to use the Decoupling Planner for more details.')
    }
    if (c.equity_loan) {
        out.push('Monthly instalments for an equity loan can only be paid by cash.')
        out.push('Tenure for an equity loan can go up to age 75, capped at 35 years.')
        out.push('Recommended to use the Equity Loan Planner for more details.')
    }
    if (c.partial_pay) {
        out.push('All banks charge a 1.5% penalty fee on partial repayments made during the lock-in, unless the package has a specific feature allowing partial repayment.')
        out.push('The most common method is to refinance and pay down the loan at the same time — the interest rate is quoted on the final loan amount. The new bank prepares the LO based on the final amount, and the law firm arranges for the shortfall to be paid via cash/CPF at completion of refinancing.')
        out.push('You cannot serve a partial repayment notice and a full repayment notice at the same time; the above method is most efficient as only a single full redemption notice is served.')
    }
    return out
}

/** Cost-of-refinancing block, figures from the computed RefiCost. */
function costRemarks(cost?: RefiCost): string[] {
    if (!cost) return []
    const out = [
        `Legal Fee: ${money(cost.legalFee)} ${cost.legalNote}`,
        `Valuation Fee: ${cost.valuationDisplay}`,
    ]
    if (cost.estSubsidy != null) {
        out.push(cost.estSubsidy > 0
            ? `Estimated Subsidy: ${money(cost.estSubsidy)} cash`
            : 'Estimated Subsidy: $0 (outstanding loan below $250k)')
    }
    return out
}

export function buildRefiRemarks(ctx: RefiRemarkContext): RefiRemarks {
    const alerts: string[] = []
    if (ctx.tenureError) alerts.push(ctx.tenureError)
    return {
        alerts,
        standard: STANDARD_REMARKS,
        conditional: conditionalRemarks(ctx),
        cost: costRemarks(ctx.cost),
    }
}

// ─── Next actions (guidance checklist) ─────────────────────────────────────────

export function refiNextActions(ctx: { buc?: boolean; considerations?: RefiConsiderationsInput }): string[] {
    const actions = [
        'Confirm the current loan details (outstanding, lock-in end date, current rate)',
        'Recommend a suitable package and use the Tenure Planner to show instalment & interest difference',
        'Get the client a copy of the latest loan statement and IGN/valuation where needed',
        'Submit the application to the chosen bank and track the Letter of Offer',
    ]
    if (ctx.buc) actions.splice(1, 0, 'Factor the undisbursed cancellation fee into the planning')
    return actions
}
