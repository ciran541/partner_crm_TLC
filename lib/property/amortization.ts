/**
 * Mortgage amortization projection.
 * Runs a standard annuity schedule to project the remaining loan balance
 * at lock-in maturity, then applies the commission formula.
 */

import { calculateCommission } from './commission'

export interface AmortizationInput {
    outstandingLoanAmount: number
    annualInterestRate: number      // e.g. 3.15 for 3.15%
    balanceTenureMonths: number     // total remaining loan months
    lockinMaturityMonths?: number   // months until lock-in expires (default 24)
}

export interface AmortizationResult {
    monthlyPayment: number
    projectedRemainingBalance: number
    projectedGrossCommission: number
    projectedAgentIncome: number
    projectedTlcIncome: number
}

const DEFAULT_LOCKIN_MONTHS = 24

export function projectAtLockinMaturity(input: AmortizationInput): AmortizationResult {
    const {
        outstandingLoanAmount,
        annualInterestRate,
        balanceTenureMonths,
        lockinMaturityMonths = DEFAULT_LOCKIN_MONTHS,
    } = input

    const r = annualInterestRate / 100 / 12

    // Standard annuity formula: P × r / (1 − (1+r)^−n)
    const monthlyPayment =
        r === 0
            ? outstandingLoanAmount / balanceTenureMonths
            : (outstandingLoanAmount * r) / (1 - Math.pow(1 + r, -balanceTenureMonths))

    // Step through the schedule up to the lock-in maturity month
    const runToMonth = Math.min(lockinMaturityMonths, balanceTenureMonths)
    let balance = outstandingLoanAmount

    for (let m = 0; m < runToMonth; m++) {
        const interestPaid = round2(balance * r)
        const principalPaid = round2(monthlyPayment - interestPaid)
        balance = round2(Math.max(0, balance - principalPaid))
    }

    const commission = calculateCommission(balance)

    return {
        monthlyPayment: round2(monthlyPayment),
        projectedRemainingBalance: balance,
        projectedGrossCommission: commission.gross,
        projectedAgentIncome: commission.agent,
        projectedTlcIncome: commission.tlc,
    }
}

function round2(value: number): number {
    return Math.round(value * 100) / 100
}
