/**
 * Singapore mortgage calculation helpers.
 *
 * Extracted from the TLC loan eligibility calculator and adapted for the
 * insurance refinancing workflow. Pure functions, no DOM / framework deps.
 *
 * Regulatory context (as used by MAS / Singapore banks):
 * - TDSR (Total Debt Servicing Ratio): total monthly debt obligations cannot
 *   exceed 55% of gross monthly income. Applies to ALL property types.
 * - MSR (Mortgage Servicing Ratio): the mortgage repayment alone cannot exceed
 *   30% of gross monthly income. Applies ONLY to HDB flats and Executive
 *   Condominiums (EC). Does NOT apply to private condos or landed property.
 * - Stress-test floor rate: eligibility is computed at a floor rate (currently
 *   4.0% p.a.) even if the actual package rate is lower, to ensure the borrower
 *   can service the loan if rates rise.
 * - Variable income (bonus / NOA / self-employed) is haircut to 70% before use.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const TDSR_LIMIT = 0.55          // 55% of gross income
export const MSR_LIMIT = 0.30           // 30% of gross income (HDB/EC only)
export const STRESS_TEST_RATE = 0.04    // 4.0% p.a. floor for eligibility
export const NOA_FACTOR = 0.7           // variable income haircut to 70%

// Property types as stored in the workflow (RefinancingStep2_FactFind.property_type)
export type WorkflowPropertyType = 'hdb' | 'private_condo' | 'landed' | 'ec'

/** MSR applies only to HDB flats and Executive Condominiums. */
export function isMsrApplicable(propertyType?: WorkflowPropertyType | string | null): boolean {
    return propertyType === 'hdb' || propertyType === 'ec'
}

// ─── Core formulas ────────────────────────────────────────────────────────────

/**
 * Monthly installment for an amortising loan (standard annuity formula).
 *
 *   M = P · r · (1+r)^n / ((1+r)^n − 1)
 *
 * @param principal   Loan amount (SGD)
 * @param annualRatePct  Annual interest rate as a percentage, e.g. 2.75 for 2.75%
 * @param tenureYears Loan tenure in years
 * @returns Monthly payment (SGD), or 0 for invalid inputs
 */
export function monthlyInstallment(principal: number, annualRatePct: number, tenureYears: number): number {
    if (!principal || principal <= 0 || !tenureYears || tenureYears <= 0) return 0
    const n = tenureYears * 12
    const r = (annualRatePct / 100) / 12
    if (r === 0) return principal / n
    const factor = Math.pow(1 + r, n)
    return (principal * r * factor) / (factor - 1)
}

/**
 * Present value of an annuity — the maximum loan a given monthly payment can
 * support at a given rate over a given tenure.
 *
 *   PV = PMT · (1 − (1+r)^−n) / r
 *
 * @param monthlyPayment Monthly servicing capacity (SGD)
 * @param annualRatePct  Annual rate as a percentage (use the stress floor for eligibility)
 * @param tenureYears    Tenure in years
 */
export function maxLoanFromPayment(monthlyPayment: number, annualRatePct: number, tenureYears: number): number {
    if (!monthlyPayment || monthlyPayment <= 0 || !tenureYears || tenureYears <= 0) return 0
    const n = tenureYears * 12
    const r = (annualRatePct / 100) / 12
    if (r === 0) return monthlyPayment * n
    return monthlyPayment * (1 - Math.pow(1 + r, -n)) / r
}

// ─── Income & servicing ratios ────────────────────────────────────────────────

/** Effective monthly income from fixed salary + haircut variable income. */
export function effectiveMonthlyIncome(args: {
    basicMonthlySalary?: number
    annualVariableIncome?: number   // bonus / NOA for employed, or annual income for self-employed
    isSelfEmployed?: boolean
}): number {
    const basic = args.isSelfEmployed ? 0 : (args.basicMonthlySalary ?? 0)
    const variableMonthly = ((args.annualVariableIncome ?? 0) * NOA_FACTOR) / 12
    return basic + variableMonthly
}

/** Monthly amount available for mortgage servicing under TDSR. */
export function tdsrAvailable(grossMonthlyIncome: number, existingMonthlyDebts: number): number {
    return Math.max(grossMonthlyIncome * TDSR_LIMIT - (existingMonthlyDebts ?? 0), 0)
}

/** Monthly amount available for mortgage servicing under MSR (HDB/EC only). */
export function msrAvailable(grossMonthlyIncome: number): number {
    return grossMonthlyIncome * MSR_LIMIT
}

/**
 * The binding monthly servicing capacity for the property type.
 * HDB/EC: the lower of MSR and TDSR. Private/landed: TDSR only.
 */
export function servicingCapacity(args: {
    grossMonthlyIncome: number
    existingMonthlyDebts: number
    propertyType?: WorkflowPropertyType | string | null
}): number {
    const tdsr = tdsrAvailable(args.grossMonthlyIncome, args.existingMonthlyDebts)
    if (isMsrApplicable(args.propertyType)) {
        return Math.min(msrAvailable(args.grossMonthlyIncome), tdsr)
    }
    return tdsr
}

/**
 * Maximum loan the borrower is eligible for based on income, at the stress-test
 * floor rate. This is the income-driven ceiling (separate from the LTV ceiling).
 */
export function maxEligibleLoan(args: {
    grossMonthlyIncome: number
    existingMonthlyDebts: number
    propertyType?: WorkflowPropertyType | string | null
    tenureYears: number
    stressRatePct?: number
}): number {
    const capacity = servicingCapacity(args)
    const stress = (args.stressRatePct ?? STRESS_TEST_RATE * 100)
    return maxLoanFromPayment(capacity, stress, args.tenureYears)
}

/**
 * The TDSR ratio (%) that a given mortgage payment would consume, including
 * existing debts. Compare against TDSR_LIMIT (55%). Uses the stress-test rate
 * payment for the new loan, matching how banks assess.
 */
export function tdsrRatioForLoan(args: {
    loanAmount: number
    tenureYears: number
    grossMonthlyIncome: number
    existingMonthlyDebts: number
    stressRatePct?: number
}): number {
    if (!args.grossMonthlyIncome || args.grossMonthlyIncome <= 0) return 0
    const stress = args.stressRatePct ?? STRESS_TEST_RATE * 100
    const stressedPayment = monthlyInstallment(args.loanAmount, stress, args.tenureYears)
    return ((stressedPayment + (args.existingMonthlyDebts ?? 0)) / args.grossMonthlyIncome) * 100
}

// ─── Refinancing-specific ─────────────────────────────────────────────────────

export interface RefiSavings {
    currentMonthly: number
    newMonthly: number
    monthlySaving: number       // can be negative if new rate is worse
    annualSaving: number
    saving2yr: number
    saving3yr: number
    netSaving2yr: number        // after clawback
    netSaving3yr: number
}

/**
 * Compute the monthly + net savings of refinancing from a current rate to a new
 * rate on the same outstanding loan and remaining tenure.
 */
export function computeRefiSavings(args: {
    outstandingLoan: number
    remainingTenureYears: number
    currentRatePct: number
    newRatePct: number
    clawbackAmount?: number
}): RefiSavings {
    const currentMonthly = monthlyInstallment(args.outstandingLoan, args.currentRatePct, args.remainingTenureYears)
    const newMonthly = monthlyInstallment(args.outstandingLoan, args.newRatePct, args.remainingTenureYears)
    const monthlySaving = currentMonthly - newMonthly
    const clawback = args.clawbackAmount ?? 0
    return {
        currentMonthly,
        newMonthly,
        monthlySaving,
        annualSaving: monthlySaving * 12,
        saving2yr: monthlySaving * 24,
        saving3yr: monthlySaving * 36,
        netSaving2yr: monthlySaving * 24 - clawback,
        netSaving3yr: monthlySaving * 36 - clawback,
    }
}
