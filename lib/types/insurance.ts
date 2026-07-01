/**
 * Insurance domain types.
 * These are copied verbatim from the original lib/types.ts.
 * Do NOT modify these without coordinating with insurance CRM changes.
 */

import type { RateScheduleEntry } from './rates'

// Case Types
export type CaseType = 'Refinancing' | 'Purchase' | 'Decouple' | 'Equity Loan' | 'Divorce'

// Pipeline Stages
export type PipelineStage =
    | 'Touched Base'
    | 'Pending Docs'
    | 'Pending Approval'
    | 'Pending Signature'
    | 'Closed Won'
    | 'Closed Lost'

// A banker a case has been referred to (bank + banker name, from BANKER_DATA).
export interface ReferredBanker {
    bank: string
    name: string
}

// Commission payout state (only meaningful once a case is Closed Won).
export type CommissionStatus = 'unpaid' | 'paid'

// ─── Closed-Won structured data ───────────────────────────────────────────────
// One package (lock-in + rate schedule) closes one or more loans. Which loans
// apply depends on the case type (see CLOSED_LOAN_KINDS_BY_CASE_TYPE in
// lib/insurance/closedWon.ts).
export type ClosedLoanKind = 'home' | 'equity' | 'refi_home' | 'new_purchase_home'

export interface ClosedWonLoan {
    kind: ClosedLoanKind
    amount: number
    tenure: number   // years
}

// A Letter-of-Offer file stored in the `insurance-documents` storage bucket.
export interface LoDocument {
    path: string     // storage object path
    name: string     // original filename
    type: string     // MIME type
}

export interface ClosedWonData {
    loans?: ClosedWonLoan[]
    package?: {
        lockin_years?: number
        schedule?: RateScheduleEntry[]
    }
    lo_documents?: LoDocument[]
    original_loan_total?: number    // Σ loan amounts in the LO (this close's commission base)
    combined_outstanding?: number   // Σ per-loan balances at end of lock-in (next-cycle base)
}

// Case Interface
export interface Case {
    id: string
    created_at: string
    updated_at: string
    created_by: string

    // Pipeline
    stage: PipelineStage

    // Case Classification
    case_type: CaseType

    // Client Basics (optional)
    client_name?: string
    client_mobile?: string
    client_email?: string

    // Loan & Property (optional)
    loan_size?: number
    property_type?: string
    property_price?: number

    // Refinancing-specific fields
    current_bank?: string
    existing_loan_amount?: number
    lock_in_end_date?: string

    // Follow-up reminder (date column in the cases table)
    follow_up_date?: string

    // Bankers this case has been referred to (jsonb array of { bank, name })
    referred_bankers?: ReferredBanker[]

    // Structured Closed-Won capture (loans, package, LO docs, computed outstanding)
    closed_won_data?: ClosedWonData

    // Commission payout state (Closed Won cases)
    commission_status?: CommissionStatus

    // Closure fields (only for Closed Won)
    closed_package_details?: string
    closed_interest_rate?: number
    closed_tenure?: number
    subsidy_provided?: string
    clawback_end_date?: string
    remarks?: string

    // Closed Lost fields
    closed_lost_reason?: string
    closed_lost_notes?: string

    // Workflow Engine data (JSONB, structure depends on case_type)
    workflow_data?: Record<string, unknown>

    // Legacy — superseded by workflow_data
    sales_assistant_data?: AssistantData

    profiles?: {
        id: string
        name: string
        role: string
    }
}

// Sales Assistant Data Structure
export interface AssistantData {
    reality: {
        interest_type: 'Fixed' | 'Floating' | ''
        lock_in_expiry: string // Date string or 'Unknown'
        is_expired: boolean
        days_remaining?: number
    }
    penalties: {
        subsidy_received: 'Yes' | 'No' | 'Not Sure' | ''
        clawback_remaining: 'Yes' | 'No' | 'Not Sure' | ''
    }
    timeline: {
        sell_plan: 'Within 2 Years' | '2-5 Years' | 'Long Term' | ''
        income_changes: 'Yes' | 'No' | 'Unsure' | ''
    }
    preferences: {
        rate_preference: 'Fixed' | 'Floating' | 'Unsure' | ''
        payment_sensitivity: 'Stable' | 'Flexible' | ''
    }
    summary?: string
    last_updated?: string
}

// Form data for creating a case
export interface CreateCaseInput {
    case_type: CaseType
    client_name?: string
    loan_size?: number
}

// Form data for updating a case
export interface UpdateCaseInput {
    stage?: PipelineStage
    client_name?: string
    client_mobile?: string
    client_email?: string
    loan_size?: number
    property_type?: string
    property_price?: number
    current_bank?: string
    existing_loan_amount?: number
    lock_in_end_date?: string
    closed_package_details?: string
    closed_interest_rate?: number
    closed_tenure?: number
    subsidy_provided?: string
    clawback_end_date?: string
    remarks?: string
    sales_assistant_data?: AssistantData
    referred_bankers?: ReferredBanker[]
    closed_won_data?: ClosedWonData
    commission_status?: CommissionStatus
}
