// Case Types
export type CaseType = 'Refinancing' | 'Purchase' | 'Decouple' | 'Equity Loan' | 'Divorce'

// Pipeline Stages
export type PipelineStage =
    | 'Touched Base'
    | 'Proposal Given'
    | 'Referred to Bank'
    | 'Pending Approval'
    | 'Pending Signature'
    | 'Closed Won'
    | 'Closed Lost'

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

    // Closure fields (only for Closed Won)
    closed_package_details?: string
    closed_interest_rate?: number
    closed_tenure?: number
    subsidy_provided?: string
    clawback_end_date?: string
    remarks?: string
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
}
