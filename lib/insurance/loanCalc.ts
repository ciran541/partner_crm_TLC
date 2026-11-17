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

// Shared across the refinancing / purchase / decoupling / equity engines —
// defined once here so a rate change can never update one workflow and miss
// another (each calc module re-exports these for its own callers).
export const CANCELLATION_FEE_RATE = 0.0075   // 0.75% on the undisbursed amount
export const MIN_TENURE = 5                    // years — standard across banks
export const DEFAULT_REFERENCE_RATE = 2.5      // % p.a. — planning default before a package is chosen
export const MIN_PURCHASE_AGE = 21             // minimum age to buy property in Singapore
export const EARLIEST_PURCHASE_YEAR = 1960     // anything earlier is treated as a typo

// ─── Borrower age vs. year of purchase ───────────────────────────────────────

export interface BorrowerAgeCheck {
    /** Year of purchase is in the future / implausibly old. */
    yearError: string | null
    /** Lowest valid age today, or null when the year is missing/invalid. */
    minAge: number | null
    /** Indexes (into the `ages` array) of borrowers below `minAge`. */
    invalid: number[]
    /** The blocking message to show — year error first, else the age error. null = all good. */
    error: string | null
}

/**
 * A borrower must have been at least 21 when the property was bought, so today
 * they must be at least 21 + years-since-purchase. We only capture whole ages and
 * a year (not dates), so the minimum is relaxed by ONE year: someone who bought in
 * Dec 2018 the month they turned 21 is still 28 in Nov 2026. That keeps every
 * real client valid while still catching the impossible ones (e.g. 25).
 *
 * Blank / 0 ages are skipped (not filled in yet). Pure — callers decide how to
 * block; every workflow treats a non-null `error` as "stop the calculation".
 */
export function checkBorrowerAges(
    ages: (number | null | undefined)[],
    yearOfPurchase: number | null | undefined,
    opts: { currentYear?: number; labels?: string[] } = {},
): BorrowerAgeCheck {
    const currentYear = opts.currentYear ?? new Date().getFullYear()
    const label = (i: number) => opts.labels?.[i] ?? `Borrower ${i + 1}`

    if (!yearOfPurchase) return { yearError: null, minAge: null, invalid: [], error: null }

    if (yearOfPurchase > currentYear) {
        const yearError = `Year of purchase (${yearOfPurchase}) can't be in the future.`
        return { yearError, minAge: null, invalid: [], error: yearError }
    }
    if (yearOfPurchase < EARLIEST_PURCHASE_YEAR) {
        const yearError = `Year of purchase (${yearOfPurchase}) looks wrong — please check it.`
        return { yearError, minAge: null, invalid: [], error: yearError }
    }

    const yearsSince = currentYear - yearOfPurchase
    const minAge = MIN_PURCHASE_AGE + Math.max(0, yearsSince - 1)
    const invalid = ages
        .map((a, i) => ({ a: a ?? 0, i }))
        .filter(({ a }) => a > 0 && a < minAge)
        .map(({ i }) => i)

    if (!invalid.length) return { yearError: null, minAge, invalid, error: null }

    const who = invalid.map(i => `${label(i)} (age ${ages[i]})`).join(', ')
    const error = `${who}: must be at least ${minAge}. The property was bought in ${yearOfPurchase}, `
        + `so they'd have been under ${MIN_PURCHASE_AGE} at purchase. Correct the age or the year of purchase to continue.`
    return { yearError: null, minAge, invalid, error }
}

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

/** One borrower's age + income, ready for IWAA weighting. */
export interface AgeIncomeEntry {
    age?: number | null
    monthlyIncome: number
}

/**
 * Income-Weighted Average Age (IWAA) — the age banks use for max-tenure rules
 * when there are multiple borrowers. Only borrowers with an entered age count,
 * each weighted by their effective monthly income.
 *
 * This is the ONE implementation — five near-identical copies used to live in
 * refiCalc / purchaseCalc / decoupleCalc / EquityLoanWorkflow / the TDSR
 * calculator, with silently different rounding and zero-income behavior. The
 * differences are now explicit options; callers state what they want:
 *
 * - `roundUp` — banks quote whole years; the purchase/decouple engines ceil,
 *   the refi engine keeps the raw value and ceils only at display time.
 * - `zeroIncomeFallback` — with no income captured the weighting is undefined:
 *   'simple-average' degrades to the plain mean; 'null' returns null so the
 *   caller can fall back itself (and e.g. label the result "Age", not "IWAA").
 */
export function incomeWeightedAge(
    entries: AgeIncomeEntry[],
    opts: { roundUp?: boolean; zeroIncomeFallback?: 'simple-average' | 'null' } = {},
): number | null {
    const { roundUp = false, zeroIncomeFallback = 'null' } = opts
    const valid = entries.filter(e => typeof e.age === 'number' && e.age! > 0)
    if (!valid.length) return null

    const totalIncome = valid.reduce((s, e) => s + (e.monthlyIncome > 0 ? e.monthlyIncome : 0), 0)
    if (totalIncome <= 0) {
        if (zeroIncomeFallback === 'null') return null
        const avg = valid.reduce((s, e) => s + e.age!, 0) / valid.length
        return roundUp ? Math.ceil(avg) : avg
    }

    const weighted = valid.reduce((s, e) => s + e.age! * Math.max(e.monthlyIncome, 0), 0) / totalIncome
    return roundUp ? Math.ceil(weighted) : weighted
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
