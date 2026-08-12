/**
 * Property domain types — matches the finalized property_cases DB schema.
 * Insurance types live in lib/types/insurance.ts — do not mix.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type PropertyCaseType =
    | 'new_purchase'
    | 'refinance'
    | 'decoupling'
    | 'equity'

export type PropertyCaseStatus =
    | 'draft'
    | 'submitted'
    | 'under_review'
    | 'verified'
    | 'paid'
    | 'rejected'
    | 'on_hold'
    | 'opportunity_due'

export type PropertyCommissionStatus = 'pending' | 'confirmed' | 'paid'

export type PropertyReminderType = 'lockin_90_day'

// ─── Domain Objects ───────────────────────────────────────────────────────────

export interface Bank {
    id: string
    name: string
    is_active: boolean
    sort_order: number
    created_at: string
}

export interface PropertyCase {
    id: string
    agent_id: string
    case_type: PropertyCaseType
    status: PropertyCaseStatus

    // Client
    client_name: string
    client_mobile: string
    client_email?: string
    property_address: string

    // Mortgage
    bank_id?: string
    interest_rate?: number
    balance_tenure_months?: number
    outstanding_loan_amount?: number
    subsidy_amount?: number

    // Mortgage package detail
    case_category?: 'residential' | 'commercial' | null
    banker_name?: string | null
    property_type?: string | null
    package_type?: 'fixed' | 'floating' | null
    free_conversion?: number | null
    fixed_years?: number | null
    floating_rate_type?: string | null
    year_rates?: string[] | null
    letter_of_offer_date?: string | null

    // Lock-in
    lock_in_period?: number | null
    lockin_confirmed_date?: string

    // Commission
    gross_commission_amount?: number
    agent_commission_amount?: number
    tlc_commission_amount?: number
    commission_status: PropertyCommissionStatus

    // Projection
    projected_remaining_balance?: number
    projected_gross_commission?: number
    projected_agent_income?: number
    projected_tlc_income?: number

    // Recurring
    actual_recurring_gross?: number
    actual_recurring_agent_income?: number
    actual_recurring_tlc_income?: number
    recurring_converted: boolean

    // Follow-up
    followup_preference?: 'self' | 'tlc' | null
    follow_up_date?: string | null
    followup_completed_at?: string | null

    // Ops
    is_duplicate: boolean
    duplicate_reason?: string
    notes?: string

    created_at: string
    updated_at: string

    // Joined relations (present when query selects with embed)
    banks?: Pick<Bank, 'id' | 'name'>
}

export interface PropertyCaseDocument {
    id: string
    case_id: string
    file_url: string
    file_name: string
    file_type: string
    uploaded_by: string
    created_at: string
}

export interface PropertyCaseActivityLog {
    id: string
    case_id: string
    actor_id: string
    action: string
    old_value?: Record<string, unknown>
    new_value?: Record<string, unknown>
    created_at: string
}

export interface PropertyReminder {
    id: string
    case_id: string
    reminder_type: PropertyReminderType
    trigger_date: string
    is_sent: boolean
    sent_at?: string
    created_at: string
}

// ─── API Input Types ──────────────────────────────────────────────────────────

export interface CreatePropertyCaseInput {
    case_type: PropertyCaseType
    client_name: string
    client_mobile: string
    client_email?: string
    property_address: string
    bank_id?: string
    interest_rate?: number
    balance_tenure_months?: number
    outstanding_loan_amount?: number
    subsidy_amount?: number
    notes?: string
    // Package detail fields
    case_category?: string
    banker_name?: string
    property_type?: string
    package_type?: string
    free_conversion?: number | null
    fixed_years?: number | null
    floating_rate_type?: string
    year_rates?: string[]
    letter_of_offer_date?: string
}

export interface UpdatePropertyProfileInput {
    full_name: string
    mobile: string
    cea_registration_no: string
    agency_name?: string
}

// ─── Preserved ────────────────────────────────────────────────────────────────

export interface PropertySignupInput {
    email: string
    password: string
    name: string
    terms_accepted: boolean
    privacy_accepted: boolean
    terms_version: string
    privacy_version: string
}

/**
 * One row of the admin Property Earnings master table, as returned by the
 * property_commission_by_agent() SQL function. Buckets are the three real
 * commission_status values, unlike insurance's open/closed_unpaid/closed_paid —
 * property tracks payout state on the case itself.
 */
export interface PropertyAgentCommissionRow {
    agentId: string
    agentName: string
    pending: number
    confirmed: number
    paid: number
    caseCount: number
    total: number
}
