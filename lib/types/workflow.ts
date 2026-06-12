/**
 * Workflow Engine — per-case-type structured data stored in cases.workflow_data JSONB.
 *
 * Each case type stores a single advisory shape (calculator inputs + the selected
 * package), not a step pipeline. Refinancing and New Purchase are fully separate
 * products with their own engines (refiCalc.ts / purchaseCalc.ts).
 */

// SORA benchmark options for a floating-rate package (used by the rates types).
export type FloatingRateType = '1M SORA' | '3M SORA' | 'FD Rate'

// ─── Flags ────────────────────────────────────────────────────────────────────

export interface WorkflowFlags {
    urgent_lock_in?: boolean    // lock-in expiry < 90 days
    clawback_risk?: boolean     // subsidy received + clawback > 0
    selling_risk?: boolean      // client plans to sell
    income_risk?: boolean       // income change expected
    tdsr_concern?: boolean      // computed TDSR > 45%
}

// ─── Refinancing workflow (advice-first single screen) ────────────────────────
// Stored in cases.workflow_data when case_type === 'Refinancing'. The shape is
// the refinancing-calculator inputs + the selected package. The property-type
// union mirrors lib/insurance/refiCalc.ts (kept as a local literal to avoid a
// type cycle).

export interface RefiConsiderations {
    sell?: boolean
    partial_pay?: boolean
    decouple?: boolean
    equity_loan?: boolean
}

export interface RefiBorrower {
    age?: number                                    // default 0 in the UI; ages drive the average age
    employment?: 'employed' | 'self_employed'       // only asked when providing income for IWAA
    basic_salary?: number
    annual_variable?: number
}

export interface RefinancingWorkflow {
    property_type?: 'hdb' | 'completed_condo_ec' | 'incompleted_condo_ec' | 'landed'
    outstanding_disbursed?: number
    outstanding_undisbursed?: number                // only for Incompleted Condo/EC (no CSC)
    current_bank?: string
    lockin_end_date?: string
    current_rate?: number
    subsidy_return_amount?: number                  // $0 / $2,000 / $2,500 / custom
    considerations?: RefiConsiderations             // plans in the next 1–3 years
    market_price?: number
    borrowers?: RefiBorrower[]                       // up to 4
    provide_income?: boolean                        // Yes → IWAA for tenure; No → simple average age
    priority_client?: boolean                       // captured agent context
    year_of_purchase?: number
    rate_preference?: 'fixed' | 'floating' | 'both'
    // Frozen snapshot of the package the agent picked (so a later admin edit to the
    // package can't silently change a client's proposal).
    selected_package_snapshot?: Record<string, unknown>
    // Non-blocking "next actions" the agent has ticked off (guidance, not a gate).
    next_actions_done?: string[]
    completed_steps?: string[]
    flags?: WorkflowFlags
}

export function getRefinancingWorkflow(data: unknown): RefinancingWorkflow {
    if (!data || typeof data !== 'object') return {}
    return data as RefinancingWorkflow
}

// ─── New Purchase workflow (loan-eligibility tool, not a step pipeline) ───────
// Stored in cases.workflow_data when case_type === 'Purchase'. This is a single
// advisory screen, so the shape is the calculator inputs + the selected package,
// not a sequence of steps. The property/residency/outstanding unions mirror
// lib/insurance/purchaseCalc.ts (kept as local literals to avoid a type cycle).

export interface PurchaseOtpDates {
    option_expiry?: string          // Resale Condo / Resale HDB / Landed
    completion?: string             // Resale Condo / Resale HDB / Landed
    top_year?: string               // New Launch Condo / EC New Launch
    snp_date?: string               // New Launch Condo / EC New Launch (S&P exercise date)
    key_collection_year?: string    // BTO
}

export interface PurchaseIpa {
    bank?: string
    date?: string
    amount?: number
    tenure?: number
    age_cap?: 65 | 75
}

export interface PurchaseBorrower {
    employment?: 'employed' | 'self_employed'
    basic_salary?: number
    annual_variable?: number
    age?: number
    residency?: 'singaporean' | 'pr' | 'foreigner'
    commitments?: number
}

export interface PurchaseWorkflow {
    property_type?: 'resale_condo' | 'new_launch_condo' | 'resale_landed' | 'ec_new_launch' | 'resale_hdb' | 'bto'
    otp_obtained?: boolean
    otp_dates?: PurchaseOtpDates
    ipa_done?: boolean
    ipa?: PurchaseIpa
    outstanding_housing_loans?: '0' | '1' | '2plus'
    borrowers?: PurchaseBorrower[]
    property_price?: number
    reference_rate?: number
    // Preferred rate type — feeds package suggestions (completed properties only).
    rate_preference?: 'fixed' | 'floating' | 'either'
    // Personalization signals for the Remarks engine.
    selling_existing?: boolean   // client is selling an existing property to buy this one
    sell_at_top?: boolean        // (new launch / EC) intends to sell at TOP
    ec_payment_scheme?: 'pps' | 'dps'   // (EC New Launch) info only — no effect on the math
    // Frozen snapshot of the package the agent picked (mirrors the refi pattern so
    // a later admin edit to the package can't silently change a client's proposal).
    selected_package_snapshot?: Record<string, unknown>
    // Non-blocking "next actions" the agent has ticked off (guidance, not a gate).
    next_actions_done?: string[]
    completed_steps?: string[]
    flags?: WorkflowFlags
}

export function getPurchaseWorkflow(data: unknown): PurchaseWorkflow {
    if (!data || typeof data !== 'object') return {}
    return data as PurchaseWorkflow
}

// ─── Other case type placeholders (to be built out later) ─────────────────────

export interface DecoupleWorkflow { completed_steps?: string[]; flags?: WorkflowFlags }
export interface EquityLoanWorkflow { completed_steps?: string[]; flags?: WorkflowFlags }
export interface DivorceWorkflow { completed_steps?: string[]; flags?: WorkflowFlags }

export type WorkflowData = RefinancingWorkflow | PurchaseWorkflow | DecoupleWorkflow | EquityLoanWorkflow | DivorceWorkflow
