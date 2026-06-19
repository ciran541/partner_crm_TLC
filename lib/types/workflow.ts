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
    commitments?: number                            // monthly liabilities (informational for agent)
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
    priority_banks?: string[]                       // which banks the client has priority status with
    property_use?: 'own_stay' | 'investment'        // own-stay or investment property
    outstanding_equity_loan?: number                // private only: current equity loan outstanding
    current_equity_loan_tenure?: number             // private only: remaining equity loan tenure (years)
    decouple_now?: boolean                          // within decouple consideration: is client decoupling now?
    cpf_used?: number                               // total CPF accrued by all owners (equity section)
    equity_loan_amount?: number                     // desired new equity loan amount
    preferred_tenure_equity?: number                // equity loan tenure for TDSR calc
    year_of_purchase?: number
    current_tenure?: number                         // remaining home loan tenure (years)
    preferred_tenure_1?: number                     // Tenure Planner — comparison slot 1
    preferred_tenure_2?: number                     // Tenure Planner — comparison slot 2
    rate_preference?: 'fixed' | 'floating' | 'both'
    reference_lockin_years?: number                 // explicit lock-in years (overrides package value)
    manual_rate_schedule?: import('@/lib/types/rates').RateScheduleEntry[]  // agent-entered schedule when no package
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
    residential_properties_owned?: '1' | '2' | '3plus'
    borrowers?: PurchaseBorrower[]
    married?: boolean          // co-owners are a married couple (affects ABSD for SC + PR/Foreigner)
    property_price?: number
    reference_rate?: number
    reference_lockin_years?: number      // explicit lock-in years (overrides package value; used for interest calc)
    manual_rate_schedule?: import('@/lib/types/rates').RateScheduleEntry[]  // agent-entered schedule when no package
    // Preferred rate type — feeds package suggestions (completed properties only).
    rate_preference?: 'fixed' | 'floating' | 'either'
    // Personalization signals for the Remarks engine.
    selling_existing?: boolean   // client is selling an existing property to buy this one
    sell_at_top?: boolean        // (new launch / EC) intends to sell at TOP
    ec_payment_scheme?: 'pps' | 'dps'   // (EC New Launch) info only — no effect on the math
    bridging_loan?: boolean             // (when selling existing) does client need a bridging loan?
    intended_buy_date?: string          // (when OTP not yet obtained) rough intended purchase date
    // Frozen snapshot of the package the agent picked (mirrors the refi pattern so
    // a later admin edit to the package can't silently change a client's proposal).
    selected_package_snapshot?: Record<string, unknown>
    // Non-blocking "next actions" the agent has ticked off (guidance, not a gate).
    next_actions_done?: string[]
    completed_steps?: string[]
    flags?: WorkflowFlags
    // Agent/client chosen tenure (within the computed range). When set, both options
    // re-price at min(preferred, option_max). Undefined = use each option's max tenure.
    preferred_tenure?: number
}

export function getPurchaseWorkflow(data: unknown): PurchaseWorkflow {
    if (!data || typeof data !== 'object') return {}
    return data as PurchaseWorkflow
}

// ─── Decoupling workflow ───────────────────────────────────────────────────────
// Stored in cases.workflow_data when case_type === 'Decouple'.

export interface DecoupleBorrower {
    employment?: 'employed' | 'self_employed'
    basic_salary?: number
    annual_variable?: number
    age?: number
    commitments?: number
}

export interface DecoupleWorkflow {
    // Property
    property_type?: 'completed_condo' | 'completed_ec' | 'incompleted_condo' | 'landed'
    property_valuation?: number
    year_of_purchase?: number
    property_use?: 'own_stay' | 'investment'

    // Ownership split (buyer acquires seller's share)
    buyer_share?: number              // buyer's current ownership % (1–99)

    // Buyer profile
    residency?: 'singaporean' | 'pr' | 'foreigner'
    requires_financing?: boolean      // does buyer need a new loan for the part-purchase?

    // Mortgage details (existing loan on the property)
    fully_paid?: boolean
    outstanding_home_loan?: number
    outstanding_equity_loan?: number
    outstanding_undisbursed?: number  // incompleted_condo only (TOP but no CSC)
    current_bank?: string
    current_tenure?: number           // remaining years on the home loan
    current_tenure_equity_loan?: number  // remaining years on the existing equity loan (if any)
    lockin_end_date?: string
    current_rate?: number
    subsidy_return_amount?: number    // $0 / $2,000 / $2,500 / custom

    // CPF
    seller_cpf_usage?: number         // seller's CPF used on property (refunded to OA on sale)
    buyer_cpf_usage?: number          // buyer's CPF already used on the property
    buyer_cpf_oa_balance?: number     // buyer's available CPF OA balance

    // Borrowers — income for TDSR (always collected, both financing paths)
    borrowers?: DecoupleBorrower[]

    // Equity loan amount (filled in if the client wants one)
    equity_loan_amount?: number

    // Reference rate for monthly-installment estimate (yes-financing path)
    reference_rate?: number

    // Preferred tenures (scenario-dependent)
    preferred_tenure_refi?: number              // S1: refi tenure; S3: refi portion
    preferred_tenure_purchase?: number          // S2: purchase tenure; S3: purchase portion
    preferred_tenure_equity?: number            // equity loan tenure (if taken)
    preferred_tenure_equity_current?: number    // TDSR exploration tenure for existing equity loan
    preferred_purchase_loan?: number            // preferred bank loan amount for S2/S3 (min $100k, max 75% × purchasePrice)
    manual_rate_schedule?: import('@/lib/types/rates').RateScheduleEntry[]
    reference_lockin_years?: number

    // Rate preference + Tenure Planner (mirrors RefinancingWorkflow)
    rate_preference?: 'fixed' | 'floating' | 'both'
    preferred_tenure_1?: number         // Tenure Planner comparison slot 1
    preferred_tenure_2?: number         // Tenure Planner comparison slot 2
    selected_package_snapshot?: Record<string, unknown>

    completed_steps?: string[]
    flags?: WorkflowFlags
}

export function getDecoupleWorkflow(data: unknown): DecoupleWorkflow {
    if (!data || typeof data !== 'object') return {}
    return data as DecoupleWorkflow
}

// ─── Other case type placeholders (to be built out later) ─────────────────────

export interface EquityLoanWorkflow { completed_steps?: string[]; flags?: WorkflowFlags }
export interface DivorceWorkflow { completed_steps?: string[]; flags?: WorkflowFlags }

export type WorkflowData = RefinancingWorkflow | PurchaseWorkflow | DecoupleWorkflow | EquityLoanWorkflow | DivorceWorkflow
