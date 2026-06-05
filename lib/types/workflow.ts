/**
 * Workflow Engine — per-case-type structured data stored in cases.workflow_data JSONB.
 * v2: 10-step Refinancing workflow with full Singapore mortgage expertise built in.
 */

// ─── Step keys ────────────────────────────────────────────────────────────────

export type RefinancingStepKey =
    | 'qualify'
    | 'fact_find'
    | 'risk_suitability'
    | 'research_proposal'
    | 'present_proposal'
    | 'collect_documents'
    | 'submit_bank'
    | 'followup_approval'
    | 'letter_offer'
    | 'close_retention'

// Backward-compat alias
export type WorkflowStepKey = RefinancingStepKey

export type StepStatus = 'locked' | 'active' | 'complete'

// ─── Flags ────────────────────────────────────────────────────────────────────

export interface WorkflowFlags {
    urgent_lock_in?: boolean    // lock-in expiry < 90 days
    clawback_risk?: boolean     // subsidy received + clawback > 0
    selling_risk?: boolean      // client plans to sell
    income_risk?: boolean       // income change expected
    tdsr_concern?: boolean      // computed TDSR > 45%
}

// ─── Step 1: Qualify ──────────────────────────────────────────────────────────

export interface RefinancingStep1_Qualify {
    lock_in_status?: 'in_lock_in' | 'expired' | 'no_lock_in'
    lock_in_expiry?: string
    interest_type?: 'fixed' | 'floating'
    lock_in_years?: number                // total lock-in period in years
    fixed_years?: number                  // how many of those years are fixed
    year_rates?: string[]                 // rate per year, index 0 = Year 1
    floating_rate_type?: FloatingRateType // SORA benchmark for floating years
    current_bank?: string
    outstanding_loan?: number
    remaining_tenure?: number
    rough_monthly_payment?: number
    worth_exploring?: boolean
    qualify_notes?: string
}

// ─── Step 2: Fact Find ────────────────────────────────────────────────────────

export type FloatingRateType = '1M SORA' | '3M SORA' | 'FD Rate'

export interface RefinancingStep2_FactFind {
    property_type?: 'hdb' | 'private_condo' | 'landed' | 'ec'
    property_address?: string
    property_valuation?: number
    interest_type?: 'fixed' | 'floating'
    lock_in_years?: number                // total lock-in period in years
    fixed_years?: number                  // how many of those years are fixed
    year_rates?: string[]                 // rate per year, index 0 = Year 1
    floating_rate_type?: FloatingRateType // SORA benchmark for floating years
    gross_monthly_income?: number
    other_monthly_debts?: number
    cpf_used_monthly?: boolean
    cpf_monthly_amount?: number
    subsidy_received?: boolean
    clawback_amount?: number
    clawback_end_date?: string
    is_self_employed?: boolean
    co_borrower?: boolean
    co_borrower_income?: number
    fact_find_notes?: string
}

// ─── Step 3: Risk & Suitability ───────────────────────────────────────────────

export interface RefinancingStep3_RiskSuitability {
    selling_plan?: 'no' | 'yes' | 'unsure'
    selling_timeline?: string
    income_change_expected?: boolean
    income_change_details?: string
    rate_preference?: 'fixed' | 'floating' | 'dont_mind'
    payment_sensitivity?: 'low' | 'medium' | 'high'
    holding_period?: 'short' | 'medium' | 'long'
    tdsr_computed?: number
    tdsr_concern?: boolean
    risk_notes?: string
}

// ─── Step 4: Research & Proposal ─────────────────────────────────────────────

// Frozen copy of the chosen package at selection time. The proposal must not
// silently change if an admin later edits the package's rates.
export interface SelectedPackageSnapshot {
    id: string
    bank: string
    package_name: string
    category: string
    lockin_years: number
    rate_schedule: import('./rates').RateScheduleEntry[]
    avg_rate_lockin_pct: number | null
    new_monthly: number | null
    monthly_saving: number | null
    net_saving_2yr: number | null
    net_saving_3yr: number | null
    sora_as_of: string | null
    selected_at: string
}

export interface RefinancingStep4_ResearchProposal {
    packages_reviewed?: number
    recommended_package?: string
    new_rate?: number
    new_monthly_payment?: number
    monthly_saving?: number
    net_saving_2yr?: number
    net_saving_3yr?: number
    penalty_if_in_lockin?: number
    selected_package_id?: string
    selected_package_snapshot?: SelectedPackageSnapshot
    proposal_notes?: string
    proposal_ready?: boolean
}

// ─── Step 5: Present Proposal ─────────────────────────────────────────────────

export interface RefinancingStep5_PresentProposal {
    proposal_presented_date?: string
    client_response?: 'committed' | 'needs_time' | 'objection' | 'declined'
    objection_details?: string
    verbal_commitment?: boolean
    follow_up_date?: string
    present_notes?: string
}

// ─── Step 6: Collect Documents ───────────────────────────────────────────────

export interface RefinancingStep6_CollectDocuments {
    nric_ready?: boolean
    payslips_ready?: boolean
    cpf_contribution_ready?: boolean
    noa_ready?: boolean
    property_valuation_ready?: boolean
    loan_statement_ready?: boolean
    subsidy_letter_ready?: boolean
    all_docs_collected?: boolean
    docs_notes?: string
}

// ─── Step 7: Submit to Bank ───────────────────────────────────────────────────

export interface RefinancingStep7_SubmitBank {
    submission_date?: string
    submitted_bank?: string
    submitted_package?: string
    reference_number?: string
    submit_notes?: string
}

// ─── Step 8: Follow Up & Approval ────────────────────────────────────────────

export interface RefinancingStep8_FollowupApproval {
    last_chased_date?: string
    bank_queries?: string
    bank_queries_resolved?: boolean
    client_updated_date?: string
    approval_status?: 'pending' | 'approved' | 'conditional' | 'rejected'
    conditional_details?: string
    approval_date?: string
    approved_rate?: number
    followup_notes?: string
}

// ─── Step 9: Letter of Offer ─────────────────────────────────────────────────

export interface RefinancingStep9_LetterOffer {
    loo_received_date?: string
    loo_reviewed_with_client?: boolean
    loo_review_date?: string
    clawback_explained?: boolean
    lock_in_explained?: boolean
    client_accepted?: boolean
    acceptance_date?: string
    loo_notes?: string
}

// ─── Step 10: Close & Retention ──────────────────────────────────────────────

export interface RefinancingStep10_CloseRetention {
    final_package?: string
    final_rate?: number
    final_tenure?: number
    final_monthly_payment?: number
    subsidy_granted?: string
    clawback_end_date_new?: string
    retention_reminder_date?: string
    close_notes?: string
}

// ─── Root workflow object (stored in cases.workflow_data) ─────────────────────

export interface RefinancingWorkflow {
    qualify?: RefinancingStep1_Qualify
    fact_find?: RefinancingStep2_FactFind
    risk_suitability?: RefinancingStep3_RiskSuitability
    research_proposal?: RefinancingStep4_ResearchProposal
    present_proposal?: RefinancingStep5_PresentProposal
    collect_documents?: RefinancingStep6_CollectDocuments
    submit_bank?: RefinancingStep7_SubmitBank
    followup_approval?: RefinancingStep8_FollowupApproval
    letter_offer?: RefinancingStep9_LetterOffer
    close_retention?: RefinancingStep10_CloseRetention
    completed_steps?: RefinancingStepKey[]
    flags?: WorkflowFlags
}

// ─── Other case type placeholders (to be built out later) ─────────────────────

export interface PurchaseWorkflow { completed_steps?: string[]; flags?: WorkflowFlags }
export interface DecoupleWorkflow { completed_steps?: string[]; flags?: WorkflowFlags }
export interface EquityLoanWorkflow { completed_steps?: string[]; flags?: WorkflowFlags }
export interface DivorceWorkflow { completed_steps?: string[]; flags?: WorkflowFlags }

export type WorkflowData = RefinancingWorkflow | PurchaseWorkflow | DecoupleWorkflow | EquityLoanWorkflow | DivorceWorkflow

// ─── Step metadata ────────────────────────────────────────────────────────────

export interface StepMeta {
    key: RefinancingStepKey
    stepNumber: number
    title: string
    nextAction: string
    pipelineStage: string
    suggestStageTo?: string
}

export const REFINANCING_STEP_META: StepMeta[] = [
    { key: 'qualify',           stepNumber: 1,  title: 'Qualify the Opportunity',          nextAction: 'Call the client and collect their current mortgage situation — bank, rate, lock-in status, and outstanding loan.',                                 pipelineStage: 'Touched Base' },
    { key: 'fact_find',         stepNumber: 2,  title: 'Deep Fact Find',                   nextAction: 'Call the client for a 15-minute deep fact-find to capture income, CPF usage, property details, and any subsidy received from the current bank.',   pipelineStage: 'Touched Base' },
    { key: 'risk_suitability',  stepNumber: 3,  title: 'Risk & Suitability Assessment',    nextAction: 'Review all risk flags with the client and determine their rate preference and holding period to shortlist suitable package types.',                  pipelineStage: 'Touched Base' },
    { key: 'research_proposal', stepNumber: 4,  title: 'Research Packages & Build Proposal', nextAction: 'Open the Rates page, shortlist 2–3 packages matching the client\'s preference, and compute net savings before calling the client.',               pipelineStage: 'Touched Base',   suggestStageTo: 'Proposal Given' },
    { key: 'present_proposal',  stepNumber: 5,  title: 'Present Proposal to Client',       nextAction: 'Call the client to present your recommendation — walk through the savings, explain the package, and get a verbal yes to proceed.',                   pipelineStage: 'Proposal Given' },
    { key: 'collect_documents', stepNumber: 6,  title: 'Collect Documents',                nextAction: 'Send the client a WhatsApp document checklist and follow up within 48 hours to confirm all documents are received.',                                 pipelineStage: 'Proposal Given', suggestStageTo: 'Referred to Bank' },
    { key: 'submit_bank',       stepNumber: 7,  title: 'Submit to Bank',                   nextAction: 'Compile all documents, complete the bank application form, and submit the full package. Record the submission reference number.',                    pipelineStage: 'Referred to Bank', suggestStageTo: 'Pending Approval' },
    { key: 'followup_approval', stepNumber: 8,  title: 'Follow Up & Approval',             nextAction: 'Chase the bank for a status update if no response in 5 business days, then notify the client of the outcome.',                                      pipelineStage: 'Pending Approval', suggestStageTo: 'Pending Signature' },
    { key: 'letter_offer',      stepNumber: 9,  title: 'Letter of Offer & Signing',        nextAction: 'Call the client to review the Letter of Offer together — walk through every key term before they sign.',                                             pipelineStage: 'Pending Signature', suggestStageTo: 'Closed Won' },
    { key: 'close_retention',   stepNumber: 10, title: 'Close & Retention Setup',          nextAction: 'Record the final closed package details, congratulate the client, and set a 2.5-year reminder to contact them for the next refinancing review.',     pipelineStage: 'Closed Won' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getRefinancingWorkflow(data: unknown): RefinancingWorkflow {
    if (!data || typeof data !== 'object') return {}
    return data as RefinancingWorkflow
}

export function isStepComplete(workflow: RefinancingWorkflow, step: RefinancingStepKey): boolean {
    return workflow.completed_steps?.includes(step) ?? false
}

export function getCompletedStepCount(workflow: RefinancingWorkflow): number {
    return workflow.completed_steps?.length ?? 0
}

export function getCurrentStep(workflow: RefinancingWorkflow): RefinancingStepKey {
    const completed = workflow.completed_steps ?? []
    const allKeys = REFINANCING_STEP_META.map(s => s.key)
    const next = allKeys.find(k => !completed.includes(k))
    return next ?? 'close_retention'
}

export function computeRefinancingFlags(workflow: RefinancingWorkflow): WorkflowFlags {
    const flags: WorkflowFlags = {}
    const q = workflow.qualify ?? {}
    const ff = workflow.fact_find ?? {}
    const rs = workflow.risk_suitability ?? {}

    if (q.lock_in_status === 'in_lock_in' && q.lock_in_expiry) {
        const days = Math.ceil((new Date(q.lock_in_expiry).getTime() - Date.now()) / 86400000)
        // Only flag urgent if expiry is in the FUTURE and within 90 days
        if (days > 0 && days <= 90) flags.urgent_lock_in = true
    }
    if (ff.subsidy_received && ff.clawback_amount && ff.clawback_amount > 0) {
        flags.clawback_risk = true
    }
    if (rs.selling_plan && rs.selling_plan !== 'no') flags.selling_risk = true
    if (rs.income_change_expected) flags.income_risk = true
    if (rs.tdsr_computed && rs.tdsr_computed > 45) flags.tdsr_concern = true

    return flags
}
