/**
 * Property commission calculation.
 * Formula: gross = outstanding_loan_amount × 0.15%
 * Split:   agent 90%, TLC 10%
 */

export const COMMISSION_RATE = 0.0015
export const AGENT_SHARE = 0.90
export const TLC_SHARE = 0.10

export interface CommissionResult {
    gross: number
    agent: number
    tlc: number
}

export function calculateCommission(outstandingLoanAmount: number): CommissionResult {
    const gross = round2(outstandingLoanAmount * COMMISSION_RATE)
    const agent = round2(gross * AGENT_SHARE)
    const tlc = round2(gross * TLC_SHARE)
    return { gross, agent, tlc }
}

function round2(value: number): number {
    return Math.round(value * 100) / 100
}
