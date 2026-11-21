/**
 * Insurance domain types.
 * These are copied verbatim from the original lib/types.ts.
 * Do NOT modify these without coordinating with insurance CRM changes.
 */

import type { RateScheduleEntry } from './rates'

// Case Types
export type CaseType = 'Refinancing' | 'Purchase' | 'Decouple' | 'Equity Loan' | 'Divorce'

// Pipeline Stages
// Full ordered list + rules live in lib/insurance/stages.ts.
export type PipelineStage =
    | 'Inactive'          // past client parked for follow-up only — outside the live pipeline
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

export interface CaseCorrection {
    at: string
    by: string
    reason: string
    fee: number
    mode: 'reopen' | 'record'
    from_stage: PipelineStage
}

/** One entry in a case's follow-up history (case_follow_ups table, newest first). */
export interface CaseFollowUp {
    id: string
    case_id: string
    follow_up_date: string | null   // null = cleared / "Don't follow up"
    remark: string | null
    stage: PipelineStage            // the case's stage when this was set
    no_follow_up: boolean
    set_by: string | null
    created_at: string
}

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
    uploaded_at?: string  // ISO time it was uploaded to HUB (older files: see loUploadedAt())
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
    // Captured from the Letter of Offer. Both live here rather than in their own
    // columns: the insurance `cases` table has neither (property_address belongs
    // to property_cases, a different app), and closed_won_data is already jsonb.
    property_address?: string
    package_features?: string[]     // free conversion, legal/valuation subsidy, waivers, etc.
    // Recorded at closing so the NEXT cycle (a revisit) can be set up correctly:
    // which bank now holds the loan, and when the lock-in started.
    bank?: string
    closed_at?: string              // YYYY-MM-DD (SGT) the case was closed
}

// Case Interface
export interface Case {
    id: string
    created_at: string
    updated_at: string
    created_by: string

    // Pipeline
    stage: PipelineStage

    // The case this one continues (a "revisit" of a Closed Won case) — following
    // these links gives the client's journey across refinancing cycles.
    parent_case_id?: string | null

    // Where the lead came from (lib/insurance/leadSources.ts) and when it first
    // became a live opportunity (stamped once by DB trigger, never changes).
    lead_source?: string | null
    lead_source_other?: string | null
    first_activated_at?: string | null

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
    property_address?: string

    // Refinancing-specific fields
    current_bank?: string
    existing_loan_amount?: number
    lock_in_end_date?: string

    // Follow-up: the current next date + remark. Every change is also kept in
    // case_follow_ups (written by a DB trigger) — see CaseFollowUp.
    follow_up_date?: string
    follow_up_remark?: string | null
    // Closed Lost only: the agent chose to stop following up this client.
    no_follow_up?: boolean
    // Closed Won only: client agreed to a reminder (WhatsApp + email) on the follow-up date.
    client_reminder_opt_in?: boolean
    // The follow_up_date the client reminder was last sent for (stops double sends).
    client_reminder_sent_for?: string | null

    // Bankers this case has been referred to (jsonb array of { bank, name })
    referred_bankers?: ReferredBanker[]

    // Structured Closed-Won capture (loans, package, LO docs, computed outstanding)
    closed_won_data?: ClosedWonData

    // Commission payout state (Closed Won cases)
    commission_status?: CommissionStatus
    // Payout ledger (commission_payouts, migration 20261202000000): Σ payouts,
    // and when the final one made it fully paid. Both kept by the DB — never set them.
    commission_paid_at?: string | null
    commission_paid_total?: number
    correction_fee?: number
    corrections?: CaseCorrection[]

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
