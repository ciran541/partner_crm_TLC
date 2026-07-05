/**
 * New Purchase loan-eligibility engine.
 *
 * This is the calculation framework underneath the New Purchase *workflow*. It
 * ports the TLC loan-eligibility calculator (LTV options, downpayment, pledge
 * fund, BSD/ABSD stamp duty, tenure rules) into pure TypeScript and extends it
 * with the new purchase rules (6 property types, prior-IPA path, and the
 * Outstanding-Housing-Loan LTV matrix).
 *
 * Pure functions, no DOM / framework deps. Income, TDSR/MSR and stress-test math
 * are reused from loanCalc.ts — this module only adds purchase-specific layers.
 */

import {
    monthlyInstallment,
    maxLoanFromPayment,
    effectiveMonthlyIncome,
    incomeWeightedAge,
    tdsrAvailable,
    msrAvailable,
    STRESS_TEST_RATE,
    DEFAULT_REFERENCE_RATE,
} from '@/lib/insurance/loanCalc'
import { calculateBSD, absdRate, worstResidency, type Residency } from '@/lib/insurance/stampDuty'
import type { PurchaseWorkflow } from '@/lib/types/workflow'

// ─── Property types ───────────────────────────────────────────────────────────

export type PurchasePropertyType =
    | 'resale_condo'        // TDSR only
    | 'new_launch_condo'    // TDSR only
    | 'resale_landed'       // TDSR only
    | 'ec_new_launch'       // TDSR + MSR (the lower binds)
    | 'resale_hdb'          // MSR only
    | 'bto'                 // MSR only

export type ServicingRule = 'tdsr' | 'msr' | 'both'

export interface PropertyTypeMeta {
    value: PurchasePropertyType
    label: string
    rule: ServicingRule
    /** HDB-class flats use the 25/30-yr tenure caps. */
    hdbClass: boolean
    /** EC New Launch + HDB-class restrict foreigner borrowers and lock outstanding loans to 0. */
    restricted: boolean
    /** Building-Under-Construction (BUC) — drives New-Launch remarks + package filter. */
    buc: boolean
}

export const PURCHASE_PROPERTY_TYPES: PropertyTypeMeta[] = [
    { value: 'resale_condo', label: 'Resale Condo', rule: 'tdsr', hdbClass: false, restricted: false, buc: false },
    { value: 'new_launch_condo', label: 'New Launch Condo', rule: 'tdsr', hdbClass: false, restricted: false, buc: true },
    { value: 'resale_landed', label: 'Resale Landed', rule: 'tdsr', hdbClass: false, restricted: false, buc: false },
    { value: 'ec_new_launch', label: 'EC New Launch', rule: 'both', hdbClass: false, restricted: true, buc: true },
    { value: 'resale_hdb', label: 'Resale HDB', rule: 'msr', hdbClass: true, restricted: false, buc: false },
    { value: 'bto', label: 'BTO', rule: 'msr', hdbClass: true, restricted: true, buc: true },
]

export function propertyMeta(type?: PurchasePropertyType | null): PropertyTypeMeta | undefined {
    return PURCHASE_PROPERTY_TYPES.find(p => p.value === type)
}

/** Map a purchase property type to the rates engine's vocabulary (RecommendCriteria.propertyType). */
export function ratesPropertyType(type?: PurchasePropertyType | null): 'hdb' | 'private_condo' | 'landed' | 'ec' | undefined {
    switch (type) {
        case 'resale_hdb':
        case 'bto': return 'hdb'
        case 'ec_new_launch': return 'ec'
        case 'resale_landed': return 'landed'
        case 'resale_condo':
        case 'new_launch_condo': return 'private_condo'
        default: return undefined
    }
}

/** EC New Launch, BTO and HDB-class flats can only ever be a first (0 outstanding) housing loan. */
export function locksOutstandingToZero(type?: PurchasePropertyType | null): boolean {
    const m = propertyMeta(type)
    return !!m && (m.hdbClass || m.value === 'ec_new_launch')
}

/** Foreigner borrowers are not eligible for HDB-class flats or EC New Launch. */
export function restrictsForeigner(type?: PurchasePropertyType | null): boolean {
    const m = propertyMeta(type)
    return !!m && (m.hdbClass || m.value === 'ec_new_launch')
}

// ─── Residency ────────────────────────────────────────────────────────────────

// Residency + stamp-duty primitives live in stampDuty.ts (single source for the
// IRAS tiers/rates); re-exported here for existing callers.
export { calculateBSD, absdRate, worstResidency, type Residency } from '@/lib/insurance/stampDuty'

export const RESIDENCY_OPTIONS: { value: Residency; label: string }[] = [
    { value: 'singaporean', label: 'Singapore Citizen' },
    { value: 'pr', label: 'PR' },
    { value: 'foreigner', label: 'Foreigner' },
]

// ─── Outstanding-loan → financing-option matrix ───────────────────────────────

export type OutstandingLoans = '0' | '1' | '2plus'

export interface FinancingOption {
    key: '1' | '2'
    minCashPct: number   // regulatory minimum cash downpayment (fraction)
    cashCpfPct: number   // headline cash/CPF downpayment for the full-LTV scenario (fraction)
    ltvPct: number       // max loan-to-valuation (fraction)
    ageCap: number       // tenure cannot take weighted age beyond this
    tenureCondoEC: number
    tenureHdb: number
}

/**
 * MAS LTV / downpayment rules keyed by the number of *existing* housing loans.
 * Each row: [Option 1 (max LTV / age 65), Option 2 (lower LTV / age 75)].
 * Invariant in every option: minCashPct + cashCpfPct + ltvPct = 1.
 */
export const OPTION_MATRIX: Record<OutstandingLoans, [FinancingOption, FinancingOption]> = {
    '0': [
        { key: '1', minCashPct: 0.05, cashCpfPct: 0.20, ltvPct: 0.75, ageCap: 65, tenureCondoEC: 30, tenureHdb: 25 },
        { key: '2', minCashPct: 0.10, cashCpfPct: 0.35, ltvPct: 0.55, ageCap: 75, tenureCondoEC: 35, tenureHdb: 30 },
    ],
    '1': [
        { key: '1', minCashPct: 0.25, cashCpfPct: 0.30, ltvPct: 0.45, ageCap: 65, tenureCondoEC: 30, tenureHdb: 25 },
        { key: '2', minCashPct: 0.25, cashCpfPct: 0.50, ltvPct: 0.25, ageCap: 75, tenureCondoEC: 35, tenureHdb: 30 },
    ],
    '2plus': [
        { key: '1', minCashPct: 0.25, cashCpfPct: 0.40, ltvPct: 0.35, ageCap: 65, tenureCondoEC: 30, tenureHdb: 25 },
        { key: '2', minCashPct: 0.25, cashCpfPct: 0.60, ltvPct: 0.15, ageCap: 75, tenureCondoEC: 35, tenureHdb: 30 },
    ],
}

// ─── Inputs ───────────────────────────────────────────────────────────────────

export interface BorrowerInput {
    employment?: 'employed' | 'self_employed'
    basicSalary?: number          // monthly basic salary (employed only)
    annualVariable?: number       // annual bonus/NOA (employed) or annual income (self-employed)
    age?: number
    residency?: Residency
    commitments?: number          // monthly debt commitments
    nonBorrower?: boolean         // owner not on the loan — excluded from income/IWAA, kept for ABSD
    cpfOa?: number                // available CPF (OA) toward the downpayment
}

export interface PurchaseInputs {
    propertyType?: PurchasePropertyType
    propertyPrice?: number
    referenceRatePct?: number     // for the headline monthly-installment estimate
    outstanding?: OutstandingLoans
    residentialPropertiesOwned?: '1' | '2' | '3plus'  // drives ABSD; separate from mortgage loans
    ipaDone?: boolean
    ipa?: { amount?: number; tenure?: number; ageCap?: 65 | 75 }
    married?: boolean             // co-owners are a married couple (affects ABSD for SC + PR/Foreigner)
    borrowers?: BorrowerInput[]   // used only when ipaDone is false
    // Agent/client preferred tenure (within computed range). Applied as effective tenure
    // for each option: min(preferredTenure, option.maxTenure). Undefined = use each option's max.
    preferredTenure?: number
}

/** Default rate used for the headline installment estimate when none entered. */
export { DEFAULT_REFERENCE_RATE } from '@/lib/insurance/loanCalc'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Income-weighted average age, rounded up (falls back to simple average when
 *  income is 0). Delegates to the shared engine in loanCalc.ts. */
export function weightedAge(borrowers: BorrowerInput[]): number | null {
    return incomeWeightedAge(
        borrowers.map(b => ({
            age: b.age,
            monthlyIncome: effectiveMonthlyIncome({
                basicMonthlySalary: b.basicSalary,
                annualVariableIncome: b.annualVariable,
                isSelfEmployed: b.employment === 'self_employed',
            }),
        })),
        { roundUp: true, zeroIncomeFallback: 'simple-average' },
    )
}

/** Monthly servicing capacity for the property's servicing rule. */
export function capacityForRule(rule: ServicingRule, grossMonthlyIncome: number, existingMonthlyDebts: number): number {
    const tdsr = tdsrAvailable(grossMonthlyIncome, existingMonthlyDebts)
    if (rule === 'tdsr') return tdsr
    const msr = msrAvailable(grossMonthlyIncome)
    if (rule === 'msr') return msr
    return Math.min(msr, tdsr)
}

/** Tenure = min(ageCap − weightedAge, property cap), floored at 0. */
export function optionTenure(option: FinancingOption, hdbClass: boolean, age: number | null): number {
    const propertyCap = hdbClass ? option.tenureHdb : option.tenureCondoEC
    if (age == null) return propertyCap
    return Math.max(0, Math.min(option.ageCap - age, propertyCap))
}

// ─── Stamp duty & fees ────────────────────────────────────────────────────────
// BSD tiers + ABSD rate primitives come from stampDuty.ts (re-exported above);
// this module keeps only the purchase-specific composition.

export function outstandingToCount(outstanding: OutstandingLoans): 1 | 2 | 3 {
    return outstanding === '0' ? 1 : outstanding === '1' ? 2 : 3
}

export function calculateABSD(args: {
    price: number
    residencies: (Residency | undefined)[]
    outstanding: OutstandingLoans
    residentialPropertiesOwned?: '1' | '2' | '3plus'
    married?: boolean
}): { amount: number; ratePct: number; residency: Residency } {
    // Married couples with at least one SC benefit from SC-rate ABSD (remission available).
    // Unmarried joint purchasers use the worst-case (highest) rate.
    const residency = args.married && args.residencies.includes('singaporean')
        ? 'singaporean'
        : worstResidency(args.residencies)
    // Residential properties owned drives ABSD; fall back to mortgage loans if not set.
    const propertyCount: 1 | 2 | 3 = args.residentialPropertiesOwned === '3plus' ? 3
        : args.residentialPropertiesOwned === '2' ? 2
        : args.residentialPropertiesOwned === '1' ? 1
        : outstandingToCount(args.outstanding)
    const rate = absdRate(residency, propertyCount)
    return { amount: args.price * rate, ratePct: rate * 100, residency }
}

export function legalFee(type?: PurchasePropertyType | null): number {
    switch (type) {
        case 'bto':            return 2000
        case 'resale_hdb':     return 1800
        case 'new_launch_condo':
        case 'ec_new_launch':  return 2800
        case 'resale_landed':  return 3000
        case 'resale_condo':
        default:               return 2500
    }
}

function _valuationAbove5m(price: number): number {
    return Math.round((700 + 0.0002 * (price - 5_000_000)) * 1.09)
}

export function valuationFee(type: PurchasePropertyType | null | undefined, price: number): number {
    switch (type) {
        case 'bto':            return 0
        case 'resale_hdb':     return 120
        case 'new_launch_condo':
        case 'ec_new_launch':  return 100
        case 'resale_landed':
            if (price < 3_000_000)  return 550
            if (price <= 5_000_000) return 750
            return _valuationAbove5m(price)
        case 'resale_condo':
        default:
            if (price < 3_000_000)  return 500
            if (price <= 5_000_000) return 700
            return _valuationAbove5m(price)
    }
}
// ─── Per-option computation ───────────────────────────────────────────────────

export interface PledgeData {
    shortfall: number
    pledgeFund: number   // funds to pledge (locked) to bridge the income shortfall
    showFund: number     // funds to show (unlocked) as an alternative
}

export interface OptionResult {
    key: '1' | '2'
    /** Whether this option came from IPA data or income-based TDSR/MSR calculation. */
    source: 'ipa' | 'income'
    ltvPct: number              // headline max LTV ceiling for this option (fraction) e.g. 0.75
    ageCap: number
    tenure: number              // effective tenure (preferred tenure applied if set, else maxTenure)
    maxTenure: number           // age-cap-constrained max (ignoring preferred tenure)
    ltvCeiling: number          // price × ltvPct — the maximum loan the bank can offer
    incomeEligibility: number | null   // null on the IPA path
    finalLoan: number           // actual loan (min of income eligibility and LTV ceiling)
    installment: number         // monthly installment for finalLoan at the reference rate
    minCashDown: number
    cashCpfDown: number         // actual balance: price − finalLoan − minCashDown
    minCashPct: number
    cashCpfPct: number          // actual balance fraction (cashCpfDown / price) — matches the $ shown
    pledge: PledgeData | null
}

/**
 * Compute pledge / show-fund amounts for a given shortfall.
 * Uses the same annuity formula as the internal computeOption path.
 */
export function computePledge(
    shortfall: number,
    tenure: number,
    rule: ServicingRule,
): PledgeData | null {
    if (shortfall <= 1 || tenure <= 0) return null
    const pledgeDivisor = rule === 'tdsr' ? 0.55 : 0.30
    const r = STRESS_TEST_RATE / 12
    const n = tenure * 12
    const shortfallPayment = shortfall * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
    const pledgeFund = Math.max(0, (shortfallPayment * 48) / pledgeDivisor)
    const showFund = Math.max(0, pledgeFund / 0.3)
    if (pledgeFund > 1 && showFund > 1) return { shortfall, pledgeFund, showFund }
    return null
}

function computeOption(
    option: FinancingOption,
    inputs: PurchaseInputs,
    ctx: { price: number; rule: ServicingRule; hdbClass: boolean; gross: number; debts: number; age: number | null },
    source: 'ipa' | 'income',
): OptionResult {
    const referenceRate = inputs.referenceRatePct || DEFAULT_REFERENCE_RATE
    const ltvCeiling = ctx.price * option.ltvPct
    const ageTenure = optionTenure(option, ctx.hdbClass, ctx.age)
    // IPA path: bank-approved tenure is the ceiling, not the age-cap-derived max.
    const maxTenure = inputs.ipaDone && inputs.ipa?.tenure
        ? Math.min(ageTenure, inputs.ipa.tenure)
        : ageTenure

    let tenure: number
    let incomeEligibility: number | null
    let finalLoan: number
    let pledge: PledgeData | null = null

    if (inputs.ipaDone) {
        // IPA path: the bank already told the client the loan + tenure — reflect them
        // directly, but never above the regulatory LTV ceiling for this option
        // (75% for a normal first-property Option 1, lower for Option 2 / extra loans).
        tenure = inputs.ipa?.tenure ?? maxTenure
        incomeEligibility = null
        finalLoan = Math.min(inputs.ipa?.amount ?? 0, ltvCeiling)

        // If the IPA loan is less than the LTV ceiling, compute pledge / show-fund amounts
        // so the agent can explain how the client could reach the full LTV.
        const shortfall = ltvCeiling - finalLoan
        if (shortfall > 1 && finalLoan > 0) {
            const pledgeDivisor = ctx.rule === 'tdsr' ? 0.55 : 0.30
            const r = STRESS_TEST_RATE / 12
            const n = tenure * 12
            const shortfallPayment = n > 0 ? shortfall * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : 0
            const pledgeFund = Math.max(0, (shortfallPayment * 48) / pledgeDivisor)
            const showFund = Math.max(0, pledgeFund / 0.3)
            if (pledgeFund > 1 && showFund > 1) pledge = { shortfall, pledgeFund, showFund }
        }
    } else {
        // Apply preferred tenure if set, capped at the age-limit max for this option.
        tenure = inputs.preferredTenure != null
            ? Math.min(inputs.preferredTenure, maxTenure)
            : maxTenure
        const capacity = capacityForRule(ctx.rule, ctx.gross, ctx.debts)
        incomeEligibility = maxLoanFromPayment(capacity, STRESS_TEST_RATE * 100, tenure)
        finalLoan = Math.min(incomeEligibility, ltvCeiling)

        // Pledge / show funds to bridge an income shortfall up to the LTV ceiling.
        const shortfall = ltvCeiling - incomeEligibility
        if (shortfall > 1) {
            const pledgeDivisor = ctx.rule === 'tdsr' ? 0.55 : 0.30
            let shortfallPayment: number
            if (incomeEligibility <= 0) {
                const r = (STRESS_TEST_RATE) / 12
                const n = tenure * 12
                shortfallPayment = n > 0 ? shortfall * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : 0
            } else {
                shortfallPayment = capacity * (shortfall / incomeEligibility)
            }
            const pledgeFund = Math.max(0, (shortfallPayment * 48) / pledgeDivisor)
            const showFund = Math.max(0, pledgeFund / 0.3)
            if (pledgeFund > 1 && showFund > 1) pledge = { shortfall, pledgeFund, showFund }
        }
    }

    finalLoan = Math.max(0, finalLoan)
    const minCashDown = ctx.price * option.minCashPct
    const cashCpfDown = Math.max(0, ctx.price - finalLoan - minCashDown)
    const installment = monthlyInstallment(finalLoan, referenceRate, tenure)

    return {
        key: option.key,
        source,
        ltvPct: option.ltvPct,
        ageCap: option.ageCap,
        tenure,
        maxTenure,
        ltvCeiling,
        incomeEligibility,
        finalLoan,
        installment,
        minCashDown,
        cashCpfDown,
        minCashPct: option.minCashPct,
        // actual balance fraction so the % label matches the dollar amount shown
        cashCpfPct: ctx.price > 0 ? cashCpfDown / ctx.price : option.cashCpfPct,
        pledge,
    }
}

// ─── Top-level computation ────────────────────────────────────────────────────

export interface PurchaseComputation {
    ready: boolean
    options: OptionResult[]      // 1 or 2 (one only on the IPA path)
    bsd: number
    absd: number
    absdRatePct: number
    absdResidency: Residency
    legalFee: number
    valuationFee: number
    weightedAge: number | null
    grossMonthlyIncome: number
    existingMonthlyDebts: number
    // Max tenure per option (derived from property type + IWAA alone, before preferred tenure).
    // Populated whenever property type and IWAA are known, even if income is not yet entered.
    tenureRange?: { opt1: number; opt2: number }
}

export function computePurchase(inputs: PurchaseInputs): PurchaseComputation {
    const meta = propertyMeta(inputs.propertyType)
    const price = inputs.propertyPrice ?? 0
    const outstanding: OutstandingLoans = locksOutstandingToZero(inputs.propertyType) ? '0' : (inputs.outstanding ?? '0')
    const borrowers = inputs.borrowers ?? []
    // Non-borrowers are owners not on the loan — excluded from income, TDSR and IWAA,
    // but still owners (their residency drives ABSD below).
    const loanBorrowers = borrowers.filter(b => !b.nonBorrower)

    const gross = inputs.ipaDone ? 0 : loanBorrowers.reduce((s, b) => s + effectiveMonthlyIncome({
        basicMonthlySalary: b.basicSalary,
        annualVariableIncome: b.annualVariable,
        isSelfEmployed: b.employment === 'self_employed',
    }), 0)
    const debts = inputs.ipaDone ? 0 : loanBorrowers.reduce((s, b) => s + (b.commitments ?? 0), 0)
    // Always compute IWAA — used for display on both IPA and non-IPA paths.
    const age = weightedAge(loanBorrowers)

    const stamp = calculateABSD({
        price,
        residencies: borrowers.map(b => b.residency),
        outstanding,
        residentialPropertiesOwned: inputs.residentialPropertiesOwned,
        married: inputs.married,
    })

    // Tenure range: needs property type + IWAA only (shown on both paths when ages are known).
    let tenureRange: { opt1: number; opt2: number } | undefined
    if (meta && age != null) {
        const [o1, o2] = OPTION_MATRIX[outstanding]
        tenureRange = {
            opt1: optionTenure(o1, meta.hdbClass, age),
            opt2: optionTenure(o2, meta.hdbClass, age),
        }
    }

    const result: PurchaseComputation = {
        ready: price > 0 && (inputs.ipaDone ? (inputs.ipa?.amount ?? 0) > 0 && (inputs.ipa?.tenure ?? 0) > 0 : gross > 0),
        options: [],
        bsd: calculateBSD(price),
        absd: stamp.amount,
        absdRatePct: stamp.ratePct,
        absdResidency: stamp.residency,
        legalFee: legalFee(inputs.propertyType),
        valuationFee: valuationFee(inputs.propertyType, price),
        weightedAge: age,
        grossMonthlyIncome: gross,
        existingMonthlyDebts: debts,
        tenureRange,
    }

    if (!meta || price <= 0) return result

    const ctx = { price, rule: meta.rule, hdbClass: meta.hdbClass, gross, debts, age }
    const [opt1, opt2] = OPTION_MATRIX[outstanding]

    if (inputs.ipaDone) {
        const ipaKey: '1' | '2' = inputs.ipa?.ageCap === 75 ? '2' : '1'
        result.options.push(computeOption(ipaKey === '1' ? opt1 : opt2, inputs, ctx, 'ipa'))
    } else {
        result.options.push(computeOption(opt1, inputs, ctx, 'income'))
        result.options.push(computeOption(opt2, inputs, ctx, 'income'))
    }

    return result
}

/** Map the stored workflow shape (snake_case) to calc inputs. Shared by the panel and the case page. */
export function inputsFromWorkflow(d: PurchaseWorkflow): PurchaseInputs {
    return {
        propertyType: d.property_type,
        propertyPrice: d.property_price,
        referenceRatePct: d.reference_rate,
        outstanding: d.outstanding_housing_loans,
        residentialPropertiesOwned: d.residential_properties_owned,
        ipaDone: d.ipa_done,
        ipa: d.ipa ? { amount: d.ipa.amount, tenure: d.ipa.tenure, ageCap: d.ipa.age_cap } : undefined,
        married: d.married,
        preferredTenure: d.preferred_tenure,
        borrowers: (d.borrowers ?? []).map(b => ({
            employment: b.employment,
            basicSalary: b.basic_salary,
            annualVariable: b.annual_variable,
            age: b.age,
            residency: b.residency,
            commitments: b.commitments,
            nonBorrower: b.non_borrower,
            cpfOa: b.cpf_oa,
        })),
    }
}
