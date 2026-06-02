/**
 * Layer 4 — Embedded Knowledge Engine types.
 * Admin-managed repository surfaced to agents contextually + via search.
 */

export type KnowledgeStatus = 'published' | 'draft'

export interface KnowledgeArticle {
    id: string
    title: string
    content: string
    category: string
    tags: string[]
    case_types: string[]   // e.g. ['Refinancing']
    step_keys: string[]    // e.g. ['fact_find','risk_suitability'] — for contextual surfacing
    status: KnowledgeStatus
    created_by?: string | null
    created_at?: string
    updated_at?: string
}

// Input for create/update (admin)
export interface KnowledgeArticleInput {
    title: string
    content: string
    category: string
    tags: string[]
    case_types: string[]
    step_keys: string[]
    status: KnowledgeStatus
}

// Categories shown in the admin editor dropdown
export const KNOWLEDGE_CATEGORIES = [
    'Clawback',
    'Lock-in',
    'CPF',
    'TDSR/MSR',
    'Fixed vs Floating',
    'Refinancing Risks',
    'Documents',
    'Approval',
    'Retention',
    'General',
] as const

// Workflow step keys an article can be tagged to (mirrors RefinancingStepKey)
export const KNOWLEDGE_STEP_KEYS: { key: string; label: string }[] = [
    { key: 'qualify', label: 'Qualify' },
    { key: 'fact_find', label: 'Fact Find' },
    { key: 'risk_suitability', label: 'Risk & Suitability' },
    { key: 'research_proposal', label: 'Research & Proposal' },
    { key: 'present_proposal', label: 'Present Proposal' },
    { key: 'collect_documents', label: 'Collect Documents' },
    { key: 'submit_bank', label: 'Submit to Bank' },
    { key: 'followup_approval', label: 'Follow Up & Approval' },
    { key: 'letter_offer', label: 'Letter of Offer' },
    { key: 'close_retention', label: 'Close & Retention' },
]

// Case types an article can apply to
export const KNOWLEDGE_CASE_TYPES = ['Refinancing', 'Purchase', 'Decouple', 'Equity Loan', 'Divorce'] as const
