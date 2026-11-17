/**
 * Refinancing eligibility engine.
 *
 * The calculation framework underneath the New (reworked) Refinancing *workflow*.
 * Deliberately SEPARATE from the New Purchase engine (purchaseCalc.ts) — a
 * refinance is a different product: there's no LTV/downpayment/ABSD, the loan is
 * simply the existing outstanding, and the headline output is the **tenure range**
 * plus the cost of refinancing. Income is used ONLY to sharpen the average age
 * into an Income-Weighted Average Age (IWAA) for the tenure formula — it never
 * sizes the loan.
 *
 * Pure functions, no DOM / framework deps. Reuses neutral math from loanCalc.ts.
 */

import { effectiveMonthlyIncome, incomeWeightedAge, checkBorrowerAges, CANCELLATION_FEE_RATE, MIN_TENURE, type BorrowerAgeCheck } from '@/lib/insurance/loanCalc'
import type { RefinancingWorkflow } from '@/lib/types/workflow'

// ─── Property types ───────────────────────────────────────────────────────────

export type RefiPropertyType =
    | 'hdb'
    | 'landed'
    | 'completed_condo'          // Completed Condo (CSC obtained)
    | 'incomplete_condo'         // Incomplete Condo (No CSC) — BUC
    | 'completed_ec_mop'         // Completed EC (CSC & MOP obtained)
    | 'completed_ec_no_mop'      // Completed EC (CSC obtained / MOP not obtained)
    | 'incomplete_ec'            // Incomplete EC (No CSC) — BUC, MSR applies
    // Legacy values kept for backward compatibility
    | 'completed_condo_ec'
    | 'incompleted_condo_ec'

export interface RefiPropertyMeta {
    value: RefiPropertyType
    label: string
    isPrivate: boolean          // false only for HDB
    buc: boolean                // building-under-construction (no CSC) — has undisbursed field
    tenureCap: number           // 30 for HDB, 35 for private
    ratesType: 'hdb' | 'private_condo' | 'landed'
    useMsr: boolean             // MSR (30%) applies to home loan payment
    canDecouple: boolean        // decoupling is available for this type
    canEquityLoan: boolean      // equity loan is available for this type
}

// The 7 types shown in the UI
export const REFI_PROPERTY_TYPES: RefiPropertyMeta[] = [
    { value: 'hdb',                 label: 'HDB',                                               isPrivate: false, buc: false, tenureCap: 30, ratesType: 'hdb',          useMsr: true,  canDecouple: false, canEquityLoan: false },
    { value: 'landed',              label: 'Landed',                                            isPrivate: true,  buc: false, tenureCap: 35, ratesType: 'landed',        useMsr: false, canDecouple: true,  canEquityLoan: true  },
    { value: 'completed_condo',     label: 'Completed Condo (CSC obtained)',                    isPrivate: true,  buc: false, tenureCap: 35, ratesType: 'private_condo', useMsr: false, canDecouple: true,  canEquityLoan: true  },
    { value: 'incomplete_condo',    label: 'Incomplete Condo (No CSC)',                         isPrivate: true,  buc: true,  tenureCap: 35, ratesType: 'private_condo', useMsr: false, canDecouple: true,  canEquityLoan: false },
    { value: 'completed_ec_mop',    label: 'Completed EC (CSC & MOP obtained)',                 isPrivate: true,  buc: false, tenureCap: 35, ratesType: 'private_condo', useMsr: false, canDecouple: true,  canEquityLoan: true  },
    { value: 'completed_ec_no_mop', label: 'Completed EC (CSC obtained / MOP not obtained)',    isPrivate: true,  buc: false, tenureCap: 35, ratesType: 'private_condo', useMsr: true,  canDecouple: false, canEquityLoan: false },
    { value: 'incomplete_ec',       label: 'Incomplete EC (No CSC)',                            isPrivate: true,  buc: true,  tenureCap: 35, ratesType: 'private_condo', useMsr: true,  canDecouple: false, canEquityLoan: false },
]

// Legacy type metas kept for backward compat — not shown in the UI picker
const REFI_LEGACY_METAS: RefiPropertyMeta[] = [
    { value: 'completed_condo_ec',   label: 'Completed Condo or EC (CSC obtained)',  isPrivate: true, buc: false, tenureCap: 35, ratesType: 'private_condo', useMsr: false, canDecouple: true,  canEquityLoan: true  },
    { value: 'incompleted_condo_ec', label: 'Incompleted Condo or EC (No CSC)',       isPrivate: true, buc: true,  tenureCap: 35, ratesType: 'private_condo', useMsr: false, canDecouple: true,  canEquityLoan: false },
]

export function refiPropertyMeta(type?: RefiPropertyType | null): RefiPropertyMeta | undefined {
    return [...REFI_PROPERTY_TYPES, ...REFI_LEGACY_METAS].find(p => p.value === type)
}

export function ratesPropertyType(type?: RefiPropertyType | null): 'hdb' | 'private_condo' | 'landed' | undefined {
    return refiPropertyMeta(type)?.ratesType
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Cross-engine constants live in loanCalc.ts; re-exported for existing callers.
export { CANCELLATION_FEE_RATE, MIN_TENURE } from '@/lib/insurance/loanCalc'
export const MAX_AGE = 75                      // tenure cannot take age beyond this
const HDB_SMALL_LOAN = 250_000                 // below this an HDB may get no subsidy
const PRIVATE_SMALL_LOAN = 500_000             // below this a private property may get no subsidy

// ─── Considerations (next 1–3 years) ──────────────────────────────────────────

export interface RefiConsiderationsInput {
    sell?: boolean
    partial_pay?: boolean
    decouple?: boolean
    equity_loan?: boolean
}

// ─── Inputs ───────────────────────────────────────────────────────────────────

export interface RefiBorrowerInput {
    age?: number
    employment?: 'employed' | 'self_employed'
    basicSalary?: number
    annualVariable?: number
}

export interface RefiInputs {
    propertyType?: RefiPropertyType
    disbursed?: number
    equityLoan?: number          // private only: current outstanding equity loan
    newEquityLoan?: number       // private only: new equity loan being drawn down
    undisbursed?: number
    currentRatePct?: number
    subsidyReturn?: number
    considerations?: RefiConsiderationsInput
    marketPrice?: number
    borrowers?: RefiBorrowerInput[]
    provideIncome?: boolean
    yearOfPurchase?: number
    decoupleNow?: boolean        // client is decoupling during this refinancing → $6k legal fee
}

// ─── Age helpers ──────────────────────────────────────────────────────────────

/** Simple average of all borrower ages that have been entered (> 0). */
export function averageAge(ages: number[]): number | null {
    const valid = ages.filter(a => typeof a === 'number' && a > 0)
    if (!valid.length) return null
    return valid.reduce((a, b) => a + b, 0) / valid.length
}

/**
 * Income-Weighted Average Age — delegates to the shared engine in loanCalc.ts.
 * Refi semantics: raw (un-rounded) value, and null when no income is available
 * (the caller then falls back to the simple average and labels it "Age").
 */
export function iwaa(borrowers: RefiBorrowerInput[]): number | null {
    return incomeWeightedAge(
        borrowers.map(b => ({
            age: b.age,
            monthlyIncome: effectiveMonthlyIncome({
                basicMonthlySalary: b.basicSalary,
                annualVariableIncome: b.annualVariable,
                isSelfEmployed: b.employment === 'self_employed',
            }),
        })),
        { roundUp: false, zeroIncomeFallback: 'null' },
    )
}

// ─── Tenure range ─────────────────────────────────────────────────────────────

export interface TenureRange {
    min: number          // always 5
    max: number          // the smaller of the two bank formulas
    result1: number      // 75 − age
    result2: number      // (30 HDB | 35 private) − yearsSincePurchase − 1
    binding: 1 | 2       // which formula bound the max
    error: string | null
}

/**
 * Max tenure = the SHORTER of the two formulas banks use:
 *   Formula 1: 75 − age
 *   Formula 2: tenureCap − (currentYear − yearOfPurchase) − 1
 * Min tenure is a flat 5 years and cannot take age past 75 — so an age ≥ 71
 * (or a max that falls below 5) is an error.
 */
export function tenureRange(args: {
    ageForTenure: number
    tenureCap: number
    yearOfPurchase: number
    currentYear?: number
}): TenureRange {
    const currentYear = args.currentYear ?? new Date().getFullYear()
    const age = Math.ceil(args.ageForTenure)
    const result1 = Math.min(args.tenureCap, MAX_AGE - age)
    const yearsSince = currentYear - args.yearOfPurchase
    const result2 = args.tenureCap - yearsSince - 1
    const rawMax = Math.min(result1, result2)
    const binding: 1 | 2 = result1 <= result2 ? 1 : 2
    const error = age >= 71 || rawMax < MIN_TENURE
        ? 'Minimum tenure is 5 years and cannot exceed age 75.'
        : null
    return { min: MIN_TENURE, max: Math.max(rawMax, 0), result1, result2, binding, error }
}

// ─── Cost of refinancing ──────────────────────────────────────────────────────

export interface RefiCost {
    legalFee: number
    legalNote: string
    valuationDisplay: string
    valuationFee: number | null       // numeric only for HDB ($200)
    estSubsidy: number | null         // estimated subsidy FROM new bank
    subsidyClawback: number           // amount TO RETURN to current bank
}

export function refinancingCost(args: {
    propertyType: RefiPropertyType
    totalOutstanding: number
    decoupleNow?: boolean   // client is decoupling NOW → $6k; false/undefined = standard refi fee
    equityLoan?: boolean
    subsidyReturn?: number  // amount agent entered for subsidy to return to current bank
}): RefiCost | undefined {
    const meta = refiPropertyMeta(args.propertyType)
    if (!meta) return undefined
    const subsidyClawback = args.subsidyReturn ?? 0

    if (!meta.isPrivate) {
        // HDB
        return {
            legalFee: 1500,
            legalNote: 'nett cash/CPF',
            valuationDisplay: '$200 est cash',
            valuationFee: 200,
            estSubsidy: args.totalOutstanding >= HDB_SMALL_LOAN ? 2000 : 0,
            subsidyClawback,
        }
    }
    // Private — decoupling now supersedes everything, then equity loan, else standard.
    const legalFee = args.decoupleNow ? 6000 : args.equityLoan ? 2100 : 1800
    const legalNote = args.decoupleNow ? 'est cash/CPF (decoupling)'
        : args.equityLoan ? 'est cash/CPF (equity loan)'
        : 'nett cash/CPF'
    const estSubsidy = args.totalOutstanding >= 1_000_000 ? 2500
        : args.totalOutstanding >= PRIVATE_SMALL_LOAN ? 2000 : 0
    return {
        legalFee,
        legalNote,
        valuationDisplay: '$400–$1,000 cash est. (refer to valuation table)',
        valuationFee: null,
        estSubsidy,
        subsidyClawback,
    }
}

// ─── Top-level computation ────────────────────────────────────────────────────

export interface RefiComputation {
    ready: boolean                    // enough entered to price packages (loan + valid tenure)
    property?: RefiPropertyMeta
    totalOutstanding: number          // disbursed + undisbursed
    cancellationFee: number           // 0 unless incompleted with undisbursed > 0
    averageAge: number | null
    iwaa: number | null
    usingIwaa: boolean
    ageForTenure: number | null
    tenure: TenureRange | null
    /** Borrower ages vs. year of purchase. A non-null `error` blocks the whole result. */
    ageCheck: BorrowerAgeCheck
    subsidyClawback: number
    cost: RefiCost | undefined
    smallLoanNoSubsidy: boolean
}

export function computeRefi(inputs: RefiInputs): RefiComputation {
    const meta = refiPropertyMeta(inputs.propertyType)
    const disbursed = inputs.disbursed ?? 0
    // Equity loan only applies to private properties.
    const equityLoan = (meta?.isPrivate ? (inputs.equityLoan ?? 0) : 0)
    const newEquityLoan = (meta?.isPrivate ? (inputs.newEquityLoan ?? 0) : 0)
    // Undisbursed only counts for the BUC (incompleted) type.
    const undisbursed = meta?.buc ? (inputs.undisbursed ?? 0) : 0
    const totalOutstanding = disbursed + equityLoan + newEquityLoan + undisbursed
    const cancellationFee = meta?.buc ? undisbursed * CANCELLATION_FEE_RATE : 0

    const borrowers = inputs.borrowers ?? []
    const ages = borrowers.map(b => b.age ?? 0)
    const avg = averageAge(ages)
    const weighted = inputs.provideIncome ? iwaa(borrowers) : null
    const usingIwaa = weighted != null
    const ageForTenure = usingIwaa ? weighted : avg

    const ageCheck = checkBorrowerAges(ages, inputs.yearOfPurchase)

    let tenure: TenureRange | null = null
    if (meta && ageForTenure != null && inputs.yearOfPurchase) {
        tenure = tenureRange({ ageForTenure, tenureCap: meta.tenureCap, yearOfPurchase: inputs.yearOfPurchase })
        // An impossible age/year makes every tenure figure meaningless. Surface it as
        // the tenure error so every downstream consumer (results, proposal,
        // presentation, emailed report) stops on it.
        if (ageCheck.error) tenure = { ...tenure, error: ageCheck.error }
    }

    const subsidyClawback = inputs.subsidyReturn ?? 0
    const cost = meta ? refinancingCost({
        propertyType: meta.value,
        totalOutstanding,
        decoupleNow: inputs.decoupleNow,
        equityLoan: inputs.considerations?.equity_loan,
        subsidyReturn: inputs.subsidyReturn,
    }) : undefined

    const smallLoanNoSubsidy = !!meta && totalOutstanding > 0 && (
        meta.isPrivate ? totalOutstanding < PRIVATE_SMALL_LOAN : totalOutstanding < HDB_SMALL_LOAN
    )

    const ready = !!meta && totalOutstanding > 0 && tenure != null && !tenure.error && !ageCheck.error

    return {
        ready,
        property: meta,
        totalOutstanding,
        cancellationFee,
        averageAge: avg,
        iwaa: weighted,
        usingIwaa,
        ageForTenure,
        tenure,
        ageCheck,
        subsidyClawback,
        cost,
        smallLoanNoSubsidy,
    }
}

/** Map the stored workflow shape (snake_case) to calc inputs. Shared by the panel and the case page. */
export function inputsFromWorkflow(d: RefinancingWorkflow): RefiInputs {
    return {
        propertyType: d.property_type,
        disbursed: d.outstanding_disbursed,
        equityLoan: d.outstanding_equity_loan,
        newEquityLoan: d.equity_loan_amount,
        undisbursed: d.outstanding_undisbursed,
        currentRatePct: d.current_rate,
        subsidyReturn: d.subsidy_return_amount,
        considerations: d.considerations,
        marketPrice: d.market_price,
        provideIncome: true,   // always use income for IWAA when entered
        yearOfPurchase: d.year_of_purchase,
        decoupleNow: d.decouple_now,
        borrowers: (d.borrowers ?? []).map(b => ({
            age: b.age,
            employment: b.employment,
            basicSalary: b.basic_salary,
            annualVariable: b.annual_variable,
        })),
    }
}
