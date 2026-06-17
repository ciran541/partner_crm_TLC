/**
 * Decoupling calculation engine — four scenarios driven by two answers:
 *
 *   requires_financing  fully_paid   Scenario
 *   ─────────────────── ──────────── ─────────
 *   NO                  NO           S1 — refi only (has mortgage, no new loan)
 *   YES                 YES          S2 — purchase only (no mortgage, new loan)
 *   YES                 NO           S3 — both refi + purchase
 *   NO                  YES          S4 — cash/CPF only (no mortgage, no new loan)
 *
 * TDSR is not collected for S4. For S1-S3 the TDSR calculation is scenario-aware.
 * Equity loan eligibility uses two constraints: LTV structural + TDSR headroom.
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

export const CURRENT_YEAR           = new Date().getFullYear()
export const DEFAULT_REFERENCE_RATE = 2.5
export const LEGAL_FEE              = 3_000
export const MIN_EQUITY_LOAN        = 50_000
export const MIN_TENURE             = 5
export const AGE_CAP_REFI           = 75
export const AGE_CAP_PURCHASE       = 65
export const MAX_PURCHASE_TENURE    = 30
export const CANCELLATION_FEE_RATE  = 0.0075
export const TDSR_DIVISOR           = 0.55   // pledge formula divisor for TDSR cases
export const SHOW_DIVISOR           = 0.30   // showFund = pledgeFund × this

export interface DecouplePledge {
    shortfall:   number   // loan amount - TDSR-eligible loan
    pledgeFund:  number   // funds to pledge (locked)
    showFund:    number   // funds to show (unlocked alternative)
}

export type DecouplePropertyType = 'completed_condo' | 'completed_ec' | 'incompleted_condo' | 'landed'
export type DecoupleScenario     = 'S1' | 'S2' | 'S3' | 'S4'
export type TdsrOutcome          = 'both_pass' | 'refi_pass_purchase_fail' | 'both_fail'

export const DECOUPLE_PROPERTY_TYPES: { value: DecouplePropertyType; label: string; tenureCap: number; buc: boolean }[] = [
    { value: 'completed_condo',  label: 'Completed Condo (CSC obtained)',              tenureCap: 35, buc: false },
    { value: 'completed_ec',     label: 'Completed EC (MOP obtained)',                 tenureCap: 35, buc: false },
    { value: 'incompleted_condo', label: 'Incompleted Condo (TOP obtained, no CSC)',   tenureCap: 35, buc: true  },
    { value: 'landed',           label: 'Landed',                                      tenureCap: 35, buc: false },
]

export const SUBSIDY_PRESETS = ['0', '2000', '2500']

export function propertyTenureCap(_type?: string): number {
    return 35
}

// ─── Stamp duties ─────────────────────────────────────────────────────────────

export function calculateBSD(price: number): number {
    if (price <= 0) return 0
    let bsd = 0
    if (price <= 180_000)   return price * 0.01
    bsd += 180_000 * 0.01
    if (price <= 360_000)   return bsd + (price - 180_000) * 0.02
    bsd += 180_000 * 0.02
    if (price <= 1_000_000) return bsd + (price - 360_000) * 0.03
    bsd += 640_000 * 0.03
    if (price <= 1_500_000) return bsd + (price - 1_000_000) * 0.04
    bsd += 500_000 * 0.04
    if (price <= 3_000_000) return bsd + (price - 1_500_000) * 0.05
    bsd += 1_500_000 * 0.05
    return bsd + (price - 3_000_000) * 0.06
}

export function calculateABSD(price: number, residency?: string): { amount: number; ratePct: number } {
    const rate = residency === 'pr' ? 0.05 : residency === 'foreigner' ? 0.60 : 0
    return { amount: price * rate, ratePct: rate * 100 }
}

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
    const rate = yearsHeld < 1 ? 0.12 : yearsHeld < 2 ? 0.08 : yearsHeld < 3 ? 0.04 : 0
    return { amount: sellingPrice * rate, ratePct: rate * 100, rateTable: 'old' }
}

// ─── Income helpers ───────────────────────────────────────────────────────────

export function decoupleWeightedAge(borrowers: DecoupleBorrower[]): number | null {
    const valid = borrowers.filter(b => typeof b.age === 'number' && b.age! > 0)
    if (!valid.length) return null
    if (valid.length === 1) return valid[0].age!
    const incomes = valid.map(b => effectiveMonthlyIncome({
        basicMonthlySalary:   b.basic_salary,
        annualVariableIncome: b.annual_variable,
        isSelfEmployed:       b.employment === 'self_employed',
    }))
    const total = incomes.reduce((a, x) => a + x, 0)
    if (total <= 0) return Math.ceil(valid.reduce((s, b) => s + b.age!, 0) / valid.length)
    return Math.ceil(valid.reduce((s, b, i) => s + b.age! * incomes[i], 0) / total)
}

// ─── Inputs / Outputs ─────────────────────────────────────────────────────────

export interface DecoupleInputs {
    propertyType?:            DecouplePropertyType
    propertyValuation?:       number
    yearOfPurchase?:          number
    propertyUse?:             'own_stay' | 'investment'
    buyerSharePct?:           number
    residency?:               'singaporean' | 'pr' | 'foreigner'
    requiresFinancing?:       boolean
    fullyPaid?:               boolean
    outstandingHomeLoan?:          number
    outstandingEquityLoan?:        number
    outstandingUndisbursed?:       number
    currentTenure?:                number   // home loan remaining tenure
    currentTenureEquityLoan?:      number   // existing equity loan remaining tenure
    sellerCpfUsage?:          number
    buyerCpfUsage?:           number
    buyerCpfOaBalance?:       number
    borrowers?:               DecoupleBorrower[]
    equityLoanAmount?:        number   // amount the client wants to take (from UI input)
    referenceRatePct?:        number
    preferredTenureRefi?:     number
    preferredTenurePurchase?: number
    preferredTenureEquity?:   number
}

export interface DecoupleComputation {
    ready:    boolean
    scenario: DecoupleScenario | null

    // Shares & prices
    buyerShareFrac:       number
    sellerShareFrac:      number
    purchasePrice:        number   // valuation × sellerShare
    sellingPrice:         number   // same
    outstandingLoan:      number
    cancellationFee:      number
    buyerLoanLiability:   number   // outstandingLoan × buyerShare  ($A)
    sellerLoanLiability:  number

    // Buyer stamp duties & fees
    bsd:          number
    absd:         number
    absdRatePct:  number
    buyerLegalFee: number

    // No-financing breakdown (S1, S4)
    cpfUsedForPurchase: number
    cashRequired:       number

    // Yes-financing breakdown (S2, S3)
    cash5:                  number
    cpfCash20:              number
    bankLoan75:             number
    cpfUsedForDownpayment:  number
    monthlyInstallment:     number   // purchase loan at reference rate

    // Ownership structure (post-decoupling, as sole owner)
    loanForStructure:   number
    cpfUsedForStructure: number
    totalCpfUsed:       number      // buyerCpfUsage + cpfUsedForStructure ($B)
    loanPct:            number
    cpfPct:             number
    cashPct:            number

    // Equity loan — two constraints
    equityPct:            number    // 75% − loanPct − cpfPct
    equityLoanMaxLtv:     number    // structural limit (LTV-based)

    equityLoanMax:        number    // actual cap = min(ltv, tdsr) for S1-S3; ltv for S4
    equityEligible:       boolean
    equityNotEligibleReason?: string

    // Seller perspective
    ssd:            number
    ssdRatePct:     number
    ssdRateTable:   'old' | 'new' | 'none'
    sellerLegalFee: number
    cashProceeds:   number

    // Income (0 for S4 — not collected)
    weightedAge:          number | null
    grossMonthlyIncome:   number
    existingMonthlyDebts: number
    availableTdsr:        number   // gross × 55% − commitments

    // Refi tenure & TDSR (S1, S3)
    refiTenureMin:                    number
    refiTenureMax:                    number
    effectiveRefiTenure:              number
    effectiveCurrentEquityLoanTenure: number   // tenure used for existing equity loan TDSR stress
    homeLoanStressInstallment:        number   // home loan stress at 4%
    equityLoanCurrentStressInstallment: number // existing equity loan stress at 4%
    refiStressInstallment:            number   // sum of the two above
    refiMonthlyInstallment:           number
    refiLoanEligibility:              number

    // Purchase tenure & TDSR (S2, S3)
    purchaseTenureMin:          number
    purchaseTenureMax:          number
    effectivePurchaseTenure:    number
    purchaseStressInstallment:  number
    purchaseLoanEligibility:    number  // S3: from balance after refi; S2: from full capacity

    // S3 summary
    balanceTdsrForPurchase: number  // available − refiStress (refi gets priority)
    tdsrOutcome:            TdsrOutcome | null

    // Pass/fail + pledge/show guidance (null = no shortfall)
    refiTdsrPass:     boolean
    purchaseTdsrPass: boolean
    refiPledge:       DecouplePledge | null
    purchasePledge:   DecouplePledge | null

    // Equity loan TDSR check (only active when equityLoanAmount > 0 and scenario ≠ S4)
    equityTenureMin:         number
    equityTenureMax:         number
    effectiveEquityTenure:   number
    remainingTdsrAfterLoans: number   // availableTdsr − refi − purchase (what's left for equity)
    equityStressInstallment: number   // monthly payment on requested equity amount at 4%
    equityLoanEligibility:   number   // max equity loan the remaining TDSR can service
    equityTdsrPass:          boolean
    equityPledge:            DecouplePledge | null
}

// ─── Core computation ─────────────────────────────────────────────────────────

export function computeDecouple(inputs: DecoupleInputs): DecoupleComputation {
    const valuation      = inputs.propertyValuation ?? 0
    const buyerShareFrac = Math.max(0.01, Math.min(0.99, (inputs.buyerSharePct ?? 50) / 100))
    const sellerShareFrac = 1 - buyerShareFrac
    const homeLoan       = inputs.outstandingHomeLoan ?? 0
    const equityOutstanding = inputs.outstandingEquityLoan ?? 0
    const undisbursed    = inputs.outstandingUndisbursed ?? 0
    // Refinanced liability = existing home loan + existing equity loan (item 6).
    const outstandingLoan = inputs.fullyPaid ? 0 : homeLoan + equityOutstanding
    const cancellationFee = undisbursed * CANCELLATION_FEE_RATE
    const sellerCpf      = inputs.sellerCpfUsage ?? 0
    const buyerCpfUsage  = inputs.buyerCpfUsage ?? 0
    const buyerCpfOa     = inputs.buyerCpfOaBalance ?? 0
    const refRate        = inputs.referenceRatePct ?? DEFAULT_REFERENCE_RATE
    const borrowers      = inputs.borrowers ?? []
    const cap            = propertyTenureCap(inputs.propertyType)
    const yearsOwned     = inputs.yearOfPurchase ? Math.max(0, CURRENT_YEAR - inputs.yearOfPurchase) : 0

    // ── Scenario ──────────────────────────────────────────────────────────────
    const scenario: DecoupleScenario | null =
        inputs.requiresFinancing === undefined || inputs.fullyPaid === undefined ? null
        : !inputs.requiresFinancing &&  inputs.fullyPaid ? 'S4'
        : !inputs.requiresFinancing && !inputs.fullyPaid ? 'S1'
        :  inputs.requiresFinancing &&  inputs.fullyPaid ? 'S2'
        : 'S3'

    const isRefi     = scenario === 'S1' || scenario === 'S3'
    const isPurchase = scenario === 'S2' || scenario === 'S3'

    // ── Prices & liabilities ──────────────────────────────────────────────────
    const purchasePrice       = valuation * sellerShareFrac
    const sellingPrice        = purchasePrice
    const buyerLoanLiability  = outstandingLoan * buyerShareFrac
    const sellerLoanLiability = outstandingLoan * sellerShareFrac

    // ── Stamp duties ──────────────────────────────────────────────────────────
    const bsd = calculateBSD(purchasePrice)
    const { amount: absd, ratePct: absdRatePct } = calculateABSD(purchasePrice, inputs.residency)
    const { amount: ssd, ratePct: ssdRatePct, rateTable: ssdRateTable } = calculateSSD(inputs.yearOfPurchase ?? 0, sellingPrice)
    const buyerLegalFee  = LEGAL_FEE
    const sellerLegalFee = LEGAL_FEE

    // ── No-financing breakdown (S1, S4) ───────────────────────────────────────
    const cpfUsedForPurchase = Math.min(buyerCpfOa, purchasePrice)
    const cashRequired       = Math.max(0, purchasePrice - cpfUsedForPurchase)

    // ── Yes-financing breakdown (S2, S3) ─────────────────────────────────────
    const cash5              = purchasePrice * 0.05
    const cpfCash20          = purchasePrice * 0.20
    const bankLoan75         = purchasePrice * 0.75
    const cpfUsedForDownpay  = Math.min(buyerCpfOa, cpfCash20)

    // ── Ownership structure ───────────────────────────────────────────────────
    const cpfUsedForStructure = isPurchase ? cpfUsedForDownpay : cpfUsedForPurchase
    const loanForStructure    = isPurchase
        ? buyerLoanLiability + bankLoan75   // S2: buyerLoanLiability=0 since fullyPaid
        : buyerLoanLiability                // S1: refi loan; S4: 0 (fully paid + no new)
    const totalCpfUsed = buyerCpfUsage + cpfUsedForStructure

    const loanPct = valuation > 0 ? loanForStructure / valuation : 0
    const cpfPct  = valuation > 0 ? totalCpfUsed / valuation : 0
    const cashPct = Math.max(0, 1 - loanPct - cpfPct)

    // ── Seller proceeds ───────────────────────────────────────────────────────
    const cashProceeds = sellingPrice - sellerLoanLiability - sellerCpf

    // ── Income (S4 = not collected) ───────────────────────────────────────────
    const grossMonthlyIncome = scenario === 'S4' ? 0 : borrowers.reduce((s, b) => s + effectiveMonthlyIncome({
        basicMonthlySalary:   b.basic_salary,
        annualVariableIncome: b.annual_variable,
        isSelfEmployed:       b.employment === 'self_employed',
    }), 0)
    const existingMonthlyDebts = scenario === 'S4' ? 0 : borrowers.reduce((s, b) => s + (b.commitments ?? 0), 0)
    const wa             = scenario === 'S4' ? null : decoupleWeightedAge(borrowers)
    const availableTdsr  = tdsrAvailable(grossMonthlyIncome, existingMonthlyDebts)

    // ── Tenure — refi path (S1, S3) ──────────────────────────────────────────
    const refiMaxByAge  = wa != null ? Math.max(0, AGE_CAP_REFI - wa) : cap
    const refiMaxByProp = Math.max(0, cap - yearsOwned)
    const refiTenureMax = Math.max(MIN_TENURE, Math.min(refiMaxByAge, refiMaxByProp))
    const refiTenureMin = MIN_TENURE
    const effectiveRefiTenure = Math.max(MIN_TENURE, Math.min(
        inputs.preferredTenureRefi ?? refiTenureMax,
        refiTenureMax,
    ))

    // ── Tenure — purchase path (S2, S3) ──────────────────────────────────────
    const purchaseMaxByAge = wa != null ? Math.max(0, AGE_CAP_PURCHASE - wa) : MAX_PURCHASE_TENURE
    const purchaseTenureMax = Math.max(MIN_TENURE, Math.min(purchaseMaxByAge, MAX_PURCHASE_TENURE))
    const purchaseTenureMin = MIN_TENURE
    const effectivePurchaseTenure = Math.max(MIN_TENURE, Math.min(
        inputs.preferredTenurePurchase ?? purchaseTenureMax,
        purchaseTenureMax,
    ))

    // ── TDSR calculations (scenario-aware) ───────────────────────────────────
    // Existing equity loan has its own remaining tenure — stress computed separately.
    const equityLoanCurrentTenureMax = refiTenureMax
    const effectiveCurrentEquityLoanTenure = equityOutstanding > 0
        ? Math.max(MIN_TENURE, Math.min(inputs.currentTenureEquityLoan ?? equityLoanCurrentTenureMax, equityLoanCurrentTenureMax))
        : 0
    const homeLoanStressInstallment = isRefi && homeLoan > 0
        ? calcInstallment(homeLoan * buyerShareFrac, STRESS_TEST_RATE * 100, effectiveRefiTenure)
        : 0
    const equityLoanCurrentStressInstallment = isRefi && equityOutstanding > 0
        ? calcInstallment(equityOutstanding * buyerShareFrac, STRESS_TEST_RATE * 100, effectiveCurrentEquityLoanTenure)
        : 0
    const refiStressInstallment = homeLoanStressInstallment + equityLoanCurrentStressInstallment
    const purchaseStressInstallment = isPurchase
        ? calcInstallment(bankLoan75, STRESS_TEST_RATE * 100, effectivePurchaseTenure)
        : 0

    // Refi: assessed against full available TDSR
    const refiLoanEligibility = isRefi
        ? maxLoanFromPayment(availableTdsr, STRESS_TEST_RATE * 100, effectiveRefiTenure)
        : 0

    // Purchase (S3): balance after refi takes priority; (S2): full capacity
    const balanceTdsrForPurchase = Math.max(0, availableTdsr - refiStressInstallment)
    const purchaseLoanEligibility = isPurchase
        ? maxLoanFromPayment(
            scenario === 'S3' ? balanceTdsrForPurchase : availableTdsr,
            STRESS_TEST_RATE * 100,
            effectivePurchaseTenure,
          )
        : 0

    // Pass/fail
    const refiTdsrPass     = !isRefi     || refiStressInstallment     <= availableTdsr
    const purchaseTdsrPass = !isPurchase || (
        scenario === 'S3'
            ? purchaseStressInstallment <= balanceTdsrForPurchase
            : purchaseStressInstallment <= availableTdsr
    )

    // S3 combined outcome
    let tdsrOutcome: TdsrOutcome | null = null
    if (scenario === 'S3' && grossMonthlyIncome > 0) {
        tdsrOutcome = refiTdsrPass && purchaseTdsrPass ? 'both_pass'
            : refiTdsrPass ? 'refi_pass_purchase_fail'
            : 'both_fail'
    }

    // Pledge / show funds (same formula as purchaseCalc — TDSR divisor 0.55)
    function computePledge(
        loanAmt: number, eligibility: number, capacity: number, tenure: number,
    ): DecouplePledge | null {
        const shortfall = loanAmt - eligibility
        if (shortfall <= 1) return null
        // When capacity <= 0 (no TDSR headroom), eligibility is 0 so we fall through
        // to the installment-based formula — capacity is not used in that branch.
        const shortfallPayment = eligibility > 0 && capacity > 0
            ? capacity * (shortfall / eligibility)
            : calcInstallment(shortfall, STRESS_TEST_RATE * 100, tenure)
        const pledgeFund = (shortfallPayment * 48) / TDSR_DIVISOR
        const showFund   = pledgeFund / SHOW_DIVISOR
        return pledgeFund > 1 && showFund > 1 ? { shortfall, pledgeFund, showFund } : null
    }

    const refiPledge = isRefi && !refiTdsrPass
        ? computePledge(buyerLoanLiability, refiLoanEligibility, availableTdsr, effectiveRefiTenure)
        : null
    const purchasePledge = isPurchase && !purchaseTdsrPass
        ? computePledge(
            bankLoan75, purchaseLoanEligibility,
            scenario === 'S3' ? balanceTdsrForPurchase : availableTdsr,
            effectivePurchaseTenure,
          )
        : null

    // Monthly installments at reference rate (display)
    const monthlyInstallment    = isPurchase ? calcInstallment(bankLoan75, refRate, effectivePurchaseTenure) : 0
    const refiMonthlyInstallment = isRefi    ? calcInstallment(buyerLoanLiability, refRate, effectiveRefiTenure) : 0

    // ── Equity loan — structural (LTV only) ──────────────────────────────────
    const equityPct        = 0.75 - loanPct - cpfPct
    const equityLoanMaxLtv = valuation > 0 ? Math.max(0, equityPct) * valuation : 0
    const equityLoanMax    = equityLoanMaxLtv   // size = LTV only; TDSR is a separate check
    const equityEligible   = equityPct > 0 && equityLoanMax >= MIN_EQUITY_LOAN

    let equityNotEligibleReason: string | undefined
    if (valuation > 0 && !equityEligible) {
        equityNotEligibleReason = equityPct <= 0
            ? 'Not eligible — combined loan and CPF already reach 75% of property value.'
            : `Available equity (${money(equityLoanMax)}) is below the $50,000 minimum.`
    }

    // ── Equity loan — TDSR affordability check ────────────────────────────────
    // Equity loan tenure: 75 − age only (no property cap / year-of-purchase constraint).
    const equityTenureMax        = Math.max(MIN_TENURE, refiMaxByAge)
    const equityTenureMin        = MIN_TENURE
    const effectiveEquityTenure  = Math.max(MIN_TENURE, Math.min(
        inputs.preferredTenureEquity ?? equityTenureMax,
        equityTenureMax,
    ))

    // Remaining TDSR after refi + purchase obligations — can be negative (shown to agent).
    const remainingTdsrAfterLoans = availableTdsr - refiStressInstallment - purchaseStressInstallment

    // What the remaining TDSR can service (shown as "Est. Loan Eligibility" in the equity block).
    const equityLoanEligibility = scenario !== 'S4' && remainingTdsrAfterLoans > 0
        ? maxLoanFromPayment(remainingTdsrAfterLoans, STRESS_TEST_RATE * 100, effectiveEquityTenure)
        : 0

    // Check the actual requested equity amount against remaining TDSR.
    const reqEquity              = inputs.equityLoanAmount ?? 0
    const equityStressInstallment = reqEquity > 0 && scenario !== 'S4'
        ? calcInstallment(reqEquity, STRESS_TEST_RATE * 100, effectiveEquityTenure)
        : 0
    const equityTdsrPass = reqEquity === 0 || scenario === 'S4'
        || equityStressInstallment <= remainingTdsrAfterLoans
    const equityPledge = reqEquity > 0 && !equityTdsrPass
        ? computePledge(reqEquity, equityLoanEligibility, remainingTdsrAfterLoans, effectiveEquityTenure)
        : null

    return {
        ready: valuation > 0 && (inputs.buyerSharePct ?? 0) > 0,
        scenario,
        buyerShareFrac, sellerShareFrac,
        purchasePrice, sellingPrice,
        outstandingLoan, cancellationFee,
        buyerLoanLiability, sellerLoanLiability,
        bsd, absd, absdRatePct, buyerLegalFee,
        cpfUsedForPurchase, cashRequired,
        cash5, cpfCash20, bankLoan75, cpfUsedForDownpayment: cpfUsedForDownpay,
        monthlyInstallment,
        loanForStructure, cpfUsedForStructure, totalCpfUsed,
        loanPct, cpfPct, cashPct,
        equityPct, equityLoanMaxLtv, equityLoanMax,
        equityEligible, equityNotEligibleReason,
        ssd, ssdRatePct, ssdRateTable, sellerLegalFee, cashProceeds,
        weightedAge: wa, grossMonthlyIncome, existingMonthlyDebts, availableTdsr,
        refiTenureMin, refiTenureMax, effectiveRefiTenure,
        effectiveCurrentEquityLoanTenure,
        homeLoanStressInstallment, equityLoanCurrentStressInstallment,
        refiStressInstallment, refiMonthlyInstallment, refiLoanEligibility,
        purchaseTenureMin, purchaseTenureMax, effectivePurchaseTenure,
        purchaseStressInstallment, purchaseLoanEligibility,
        balanceTdsrForPurchase, tdsrOutcome,
        refiTdsrPass, purchaseTdsrPass,
        refiPledge, purchasePledge,
        equityTenureMin, equityTenureMax, effectiveEquityTenure,
        remainingTdsrAfterLoans,
        equityStressInstallment, equityLoanEligibility,
        equityTdsrPass, equityPledge,
    }
}

function money(n: number) { return `$${Math.round(n).toLocaleString()}` }

/** Map stored workflow shape to calc inputs. */
export function inputsFromDecoupleWorkflow(d: DecoupleWorkflow): DecoupleInputs {
    return {
        propertyType:          d.property_type,
        propertyValuation:     d.property_valuation,
        yearOfPurchase:        d.year_of_purchase,
        propertyUse:           d.property_use,
        buyerSharePct:         d.buyer_share,
        residency:             d.residency,
        requiresFinancing:     d.requires_financing,
        fullyPaid:             d.fully_paid,
        outstandingHomeLoan:   d.outstanding_home_loan,
        outstandingEquityLoan: d.outstanding_equity_loan,
        outstandingUndisbursed: d.outstanding_undisbursed,
        currentTenure:            d.current_tenure,
        currentTenureEquityLoan:  d.current_tenure_equity_loan,
        sellerCpfUsage:        d.seller_cpf_usage,
        buyerCpfUsage:         d.buyer_cpf_usage,
        buyerCpfOaBalance:     d.buyer_cpf_oa_balance,
        borrowers:             d.borrowers,
        equityLoanAmount:      d.equity_loan_amount,
        referenceRatePct:      d.reference_rate,
        preferredTenureRefi:     d.preferred_tenure_refi,
        preferredTenurePurchase: d.preferred_tenure_purchase,
        preferredTenureEquity:   d.preferred_tenure_equity,
    }
}
