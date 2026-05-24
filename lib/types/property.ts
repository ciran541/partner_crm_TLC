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

    // Lock-in (confirmed by admin only)
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
