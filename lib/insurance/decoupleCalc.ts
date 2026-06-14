/**
 * Decoupling calculation engine.
 *
 * Pure functions, no DOM / framework deps. Two financing paths:
 *   - No financing: buyer pays cash/CPF for seller's share; existing loan
 *     is refinanced on buyer's name. Loan Liability ($A) = outstanding × buyerShare%.
 *   - Yes financing: buyer takes a new 75% LTV loan on the seller's share
 *     on top of their existing loan liability. New Total Loan (P%) flows in.
 *
 * SSD uses year of purchase (not months) — old rates for 2023/2024 purchases,
 * new rates for 2025+, none for 2022 or earlier.
 */

import {
    effectiveMonthlyIncome,
    maxLoanFromPayment,
    monthlyInstallment as calcInstallment,
    tdsrAvailable,
    STRESS_TEST_RATE,
} from '@/lib/insurance/loanCalc'
import type { DecoupleWorkflow, DecoupleBorrower } from '@/lib/types/workflow'

// ─── Constants ────────────────────────────────────────────────────────────────

export const CURRENT_YEAR = new Date().getFullYear()
export const DEFAULT_REFERENCE_RATE = 2.5
export const LEGAL_FEE = 3_000
export const MIN_EQUITY_LOAN = 50_000
export const MIN_TENURE = 5
export const MAX_AGE_CAP = 75
export const CANCELLATION_FEE_RATE = 0.0075   // 0.75% on undisbursed amount

export type DecouplePropertyType = 'hdb' | 'completed_condo_ec' | 'incompleted_condo_ec' | 'landed'

export const DECOUPLE_PROPERTY_TYPES: { value: DecouplePropertyType; label: string; tenureCap: number; buc: boolean }[] = [
    { value: 'hdb',                  label: 'HDB',                                   tenureCap: 30, buc: false },
    { value: 'completed_condo_ec',   label: 'Completed Condo / EC (CSC obtained)',   tenureCap: 35, buc: false },
    { value: 'incompleted_condo_ec', label: 'Incompleted Condo / EC (No CSC)',       tenureCap: 35, buc: true  },
    { value: 'landed',               label: 'Landed',                                tenureCap: 35, buc: false },
]

export function propertyTenureCap(type?: string): number {
    return type === 'hdb' ? 30 : 35
}

export const SUBSIDY_PRESETS = ['0', '2000', '2500']

// ─── Stamp duties ─────────────────────────────────────────────────────────────

/** BSD tiered slabs — same as purchaseCalc. */
export function calculateBSD(price: number): number {
    if (price <= 0) return 0
    let bsd = 0
    if (price <= 180_000) return price * 0.01
    bsd += 180_000 * 0.01
    if (price <= 360_000) return bsd + (price - 180_000) * 0.02
    bsd += 180_000 * 0.02
    if (price <= 1_000_000) return bsd + (price - 360_000) * 0.03
    bsd += 640_000 * 0.03
    if (price <= 1_500_000) return bsd + (price - 1_000_000) * 0.04
    bsd += 500_000 * 0.04
    if (price <= 3_000_000) return bsd + (price - 1_500_000) * 0.05
    bsd += 1_500_000 * 0.05
    return bsd + (price - 3_000_000) * 0.06
}

/** ABSD — simplified flat rates from the original decoupling calculator. */
export function calculateABSD(price: number, residency?: string): { amount: number; ratePct: number } {
    const rate = residency === 'pr' ? 0.05 : residency === 'foreigner' ? 0.60 : 0
    return { amount: price * rate, ratePct: rate * 100 }
}

/**
 * SSD — two rate tables based on year of purchase:
 *   ≤ 2022          → no SSD (past holding period)
 *   2023–2024       → old rates: 12% / 8% / 4% / 0% (3-year window)
 *   2025+           → new rates: 16% / 12% / 8% / 4% / 0% (4-year window)
 *
 * yearsHeld = currentYear − yearOfPurchase (year-only, client unlikely to recall month).
 * A remark pointing to IRAS should be shown in the UI for exact computation.
 */
export function calculateSSD(
    yearOfPurchase: number,
    sellingPrice: number,
): { amount: number; ratePct: number; rateTable: 'old' | 'new' | 'none' } {
    if (!yearOfPurchase || sellingPrice <= 0 || yearOfPurchase <= 2022) {
        return { amount: 0, ratePct: 0, rateTable: 'none' }
    }
    const yearsHeld = CURRENT_YEAR - yearOfPurchase
    if (yearOfPurchase >= 2025) {
        const rate = yearsHeld < 1 ? 0.16 : yearsHeld < 2 ? 0.12 : yearsHeld < 3 ? 0.08 : yearsHeld < 4 ? 0.04 : 0
        return { amount: sellingPrice * rate, ratePct: rate * 100, rateTable: 'new' }
    }
    // 2023 or 2024 — old rates
    const rate = yearsHeld < 1 ? 0.12 : yearsHeld < 2 ? 0.08 : yearsHeld < 3 ? 0.04 : 0
    return { amount: sellingPrice * rate, ratePct: rate * 100, rateTable: 'old' }
}

// ─── Income helpers ───────────────────────────────────────────────────────────

/** Income-weighted average age, rounded up. */
export function decoupleWeightedAge(borrowers: DecoupleBorrower[]): number | null {
    const valid = borrowers.filter(b => typeof b.age === 'number' && b.age! > 0)
    if (!valid.length) return null
    if (valid.length === 1) return valid[0].age!
    const incomes = valid.map(b => effectiveMonthlyIncome({
        basicMonthlySalary: b.basic_salary,
        annualVariableIncome: b.annual_variable,
        isSelfEmployed: b.employment === 'self_employed',
    }))
    const total = incomes.reduce((a, x) => a + x, 0)
    if (total <= 0) return Math.ceil(valid.reduce((s, b) => s + b.age!, 0) / valid.length)
    return Math.ceil(valid.reduce((s, b, i) => s + b.age! * incomes[i], 0) / total)
}

// ─── Inputs / Outputs ─────────────────────────────────────────────────────────

export interface DecoupleInputs {
    propertyType?: DecouplePropertyType
    propertyValuation?: number
    yearOfPurchase?: number
    propertyUse?: 'own_stay' | 'investment'
    buyerSharePct?: number             // 1–99
    residency?: 'singaporean' | 'pr' | 'foreigner'
    requiresFinancing?: boolean
    fullyPaid?: boolean
    outstandingDisbursed?: number
    outstandingUndisbursed?: number
    currentTenure?: number
    sellerCpfUsage?: number
    buyerCpfUsage?: number
    buyerCpfOaBalance?: number
    borrowers?: DecoupleBorrower[]
    equityLoanAmount?: number
    referenceRatePct?: number
    preferredTenure?: number
}

export interface DecoupleComputation {
    ready: boolean
    // Shares
    buyerShareFrac: number
    sellerShareFrac: number
    // Prices
    purchasePrice: number            // valuation × sellerShare — what buyer acquires
    sellingPrice: number             // same — what seller receives
    outstandingLoan: number          // disbursed + undisbursed
    cancellationFee: number          // undisbursed × 0.75%
    // Liabilities
    buyerLoanLiability: number       // outstandingLoan × buyerShare — $A (no-fin path)
    sellerLoanLiability: number      // outstandingLoan × sellerShare
    // Seller perspective
    ssd: number
    ssdRatePct: number
    ssdRateTable: 'old' | 'new' | 'none'
    sellerLegalFee: number
    cashProceeds: number             // sellingPrice − sellerLoanLiability − sellerCpfUsage
    // Buyer stamp duties
    bsd: number
    absd: number
    absdRatePct: number
    buyerLegalFee: number
    // No-financing path
    cpfUsedForPurchase: number       // min(buyerCpfOaBalance, purchasePrice)
    cashRequired: number             // purchasePrice − cpfUsedForPurchase
    // Yes-financing path
    cash5: number
    cpfCash20: number
    bankLoan75: number
    newTotalLoan: number             // buyerLoanLiability + bankLoan75
    cpfUsedForDownpayment: number    // min(buyerCpfOaBalance, cpfCash20)
    monthlyInstallment: number       // yes-fin path installment on newTotalLoan
    // Ownership structure (shared, path-dependent)
    loanForStructure: number         // buyerLoanLiability (no-fin) | newTotalLoan (yes-fin)
    cpfUsedForStructure: number      // cpfUsedForPurchase | cpfUsedForDownpayment
    totalCpfUsed: number             // buyerCpfUsage + cpfUsedForStructure — $B
    loanPct: number                  // Z% or P%
    cpfPct: number                   // Y%
    cashPct: number                  // remainder
    // Equity availability
    equityPct: number                // 75% − loanPct − cpfPct
    availableEquity: number          // max(0, equityPct) × valuation
    equityEligible: boolean
    equityNotEligibleReason?: string
    // Tenure
    weightedAge: number | null
    maxTenure: number                // no-fin path max
    tenureSingle?: number            // yes-fin path: 65 − IWAA
    effectiveTenure: number          // the tenure actually used for TDSR
    // TDSR
    grossMonthlyIncome: number
    existingMonthlyDebts: number
    estLoanEligibility: number       // max loan from TDSR capacity at effectiveTenure
    tdsrPct: number                  // ratio for the actual loan (incl. equity if any)
    tdsrPass: boolean
}

// ─── Core computation ─────────────────────────────────────────────────────────

export function computeDecouple(inputs: DecoupleInputs): DecoupleComputation {
    const valuation       = inputs.propertyValuation ?? 0
    const buyerShareFrac  = Math.max(0.01, Math.min(0.99, (inputs.buyerSharePct ?? 50) / 100))
    const sellerShareFrac = 1 - buyerShareFrac
    const disbursed       = inputs.outstandingDisbursed ?? 0
    const undisbursed     = inputs.outstandingUndisbursed ?? 0
    const outstandingLoan = inputs.fullyPaid ? 0 : disbursed + undisbursed
    const cancellationFee = undisbursed * CANCELLATION_FEE_RATE
    const sellerCpf       = inputs.sellerCpfUsage ?? 0
    const buyerCpfUsage   = inputs.buyerCpfUsage ?? 0
    const buyerCpfOa      = inputs.buyerCpfOaBalance ?? 0
    const refRate         = inputs.referenceRatePct ?? DEFAULT_REFERENCE_RATE
    const borrowers       = inputs.borrowers ?? []
    const requiresFin     = inputs.requiresFinancing ?? false

    const purchasePrice       = valuation * sellerShareFrac
    const sellingPrice        = purchasePrice
    const buyerLoanLiability  = outstandingLoan * buyerShareFrac
    const sellerLoanLiability = outstandingLoan * sellerShareFrac

    // Stamp duties
    const bsd                                              = calculateBSD(purchasePrice)
    const { amount: absd, ratePct: absdRatePct }          = calculateABSD(purchasePrice, inputs.residency)
    const { amount: ssd, ratePct: ssdRatePct, rateTable: ssdRateTable } = calculateSSD(inputs.yearOfPurchase ?? 0, sellingPrice)
    const buyerLegalFee  = LEGAL_FEE
    const sellerLegalFee = LEGAL_FEE

    // Seller cash proceeds
    const cashProceeds = sellingPrice - sellerLoanLiability - sellerCpf

    // Income
    const grossMonthlyIncome = borrowers.reduce((s, b) => s + effectiveMonthlyIncome({
        basicMonthlySalary:   b.basic_salary,
        annualVariableIncome: b.annual_variable,
        isSelfEmployed:       b.employment === 'self_employed',
    }), 0)
    const existingMonthlyDebts = borrowers.reduce((s, b) => s + (b.commitments ?? 0), 0)

    const wa = decoupleWeightedAge(borrowers)

    // Tenure
    const cap         = propertyTenureCap(inputs.propertyType)
    const yearsOwned  = inputs.yearOfPurchase ? Math.max(0, CURRENT_YEAR - inputs.yearOfPurchase) : 0
    const maxByAge    = wa != null ? Math.max(0, MAX_AGE_CAP - wa) : cap
    const maxByProp   = Math.max(0, cap - yearsOwned)
    const maxTenure   = Math.max(Math.min(maxByAge, maxByProp), MIN_TENURE)

    // No-fin: preferred tenure defaulting to current tenure or max
    const noFinTenure = Math.max(MIN_TENURE, Math.min(
        inputs.preferredTenure ?? inputs.currentTenure ?? maxTenure,
        maxTenure,
    ))

    // Yes-fin: 65 − IWAA, capped at 30
    const tenureSingle = requiresFin && wa != null ? Math.max(0, Math.min(30, 65 - wa)) : undefined
    const effectiveTenure = requiresFin ? (tenureSingle ?? 30) : noFinTenure

    // TDSR capacity
    const capacity         = tdsrAvailable(grossMonthlyIncome, existingMonthlyDebts)
    const estLoanEligibility = maxLoanFromPayment(capacity, STRESS_TEST_RATE * 100, effectiveTenure)

    // No-financing breakdown
    const cpfUsedForPurchase = Math.min(buyerCpfOa, purchasePrice)
    const cashRequired       = Math.max(0, purchasePrice - cpfUsedForPurchase)

    // Yes-financing breakdown
    const cash5               = purchasePrice * 0.05
    const cpfCash20           = purchasePrice * 0.20
    const bankLoan75          = purchasePrice * 0.75
    const newTotalLoan        = buyerLoanLiability + bankLoan75
    const cpfUsedForDownpay   = Math.min(buyerCpfOa, cpfCash20)
    const installment         = calcInstallment(newTotalLoan, refRate, tenureSingle ?? 30)

    // Ownership structure
    const cpfUsedForStructure = requiresFin ? cpfUsedForDownpay : cpfUsedForPurchase
    const totalCpfUsed        = buyerCpfUsage + cpfUsedForStructure
    const loanForStructure    = requiresFin ? newTotalLoan : buyerLoanLiability

    const loanPct  = valuation > 0 ? loanForStructure / valuation : 0
    const cpfPct   = valuation > 0 ? totalCpfUsed / valuation : 0
    const cashPct  = Math.max(0, 1 - loanPct - cpfPct)

    // Equity
    const equityPct      = 0.75 - loanPct - cpfPct
    const availableEquity = valuation > 0 ? Math.max(0, equityPct) * valuation : 0
    const equityEligible  = equityPct > 0 && availableEquity >= MIN_EQUITY_LOAN
    let equityNotEligibleReason: string | undefined
    if (valuation > 0) {
        if (equityPct <= 0) {
            equityNotEligibleReason = 'Not eligible for equity loan — combined loan and CPF exceed 75% of property value.'
        } else if (availableEquity < MIN_EQUITY_LOAN) {
            equityNotEligibleReason = `Available equity ($${Math.round(availableEquity).toLocaleString()}) is below the $50,000 minimum — a higher valuation is required.`
        }
    }

    // TDSR for actual loan (incl. equity if taken)
    const loanForTdsr    = loanForStructure + (inputs.equityLoanAmount ?? 0)
    const stressPayment  = calcInstallment(loanForTdsr, STRESS_TEST_RATE * 100, effectiveTenure)
    const tdsrPct        = grossMonthlyIncome > 0
        ? ((stressPayment + existingMonthlyDebts) / grossMonthlyIncome) * 100
        : 0
    const tdsrPass = grossMonthlyIncome <= 0 || tdsrPct <= 55

    return {
        ready: valuation > 0 && (inputs.buyerSharePct ?? 0) > 0,
        buyerShareFrac,
        sellerShareFrac,
        purchasePrice,
        sellingPrice,
        outstandingLoan,
        cancellationFee,
        buyerLoanLiability,
        sellerLoanLiability,
        ssd,
        ssdRatePct,
        ssdRateTable,
        sellerLegalFee,
        cashProceeds,
        bsd,
        absd,
        absdRatePct,
        buyerLegalFee,
        cpfUsedForPurchase,
        cashRequired,
        cash5,
        cpfCash20,
        bankLoan75,
        newTotalLoan,
        cpfUsedForDownpayment: cpfUsedForDownpay,
        monthlyInstallment: installment,
        loanForStructure,
        cpfUsedForStructure,
        totalCpfUsed,
        loanPct,
        cpfPct,
        cashPct,
        equityPct,
        availableEquity,
        equityEligible,
        equityNotEligibleReason,
        weightedAge: wa,
        maxTenure,
        tenureSingle,
        effectiveTenure,
        grossMonthlyIncome,
        existingMonthlyDebts,
        estLoanEligibility,
        tdsrPct,
        tdsrPass,
    }
}

/** Map stored workflow shape (snake_case) to calc inputs. */
export function inputsFromDecoupleWorkflow(d: DecoupleWorkflow): DecoupleInputs {
    return {
        propertyType:        d.property_type,
        propertyValuation:   d.property_valuation,
        yearOfPurchase:      d.year_of_purchase,
        propertyUse:         d.property_use,
        buyerSharePct:       d.buyer_share,
        residency:           d.residency,
        requiresFinancing:   d.requires_financing,
        fullyPaid:           d.fully_paid,
        outstandingDisbursed:   d.outstanding_disbursed,
        outstandingUndisbursed: d.outstanding_undisbursed,
        currentTenure:       d.current_tenure,
        sellerCpfUsage:      d.seller_cpf_usage,
        buyerCpfUsage:       d.buyer_cpf_usage,
        buyerCpfOaBalance:   d.buyer_cpf_oa_balance,
        borrowers:           d.borrowers,
        equityLoanAmount:    d.equity_loan_amount,
        referenceRatePct:    d.reference_rate,
        preferredTenure:     d.preferred_tenure,
    }
}
