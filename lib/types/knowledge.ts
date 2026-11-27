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
    // category, case_types and step_keys are no longer used (columns kept).
    case_types: string[]
    step_keys: string[]
    status: KnowledgeStatus
    source?: string | null
    checked_by?: string | null
    checked_on?: string | null
    /** Drafted from this official page. */
    official_page_id?: string | null
    /** The official page changed since this was checked. */
    source_changed_at?: string | null
    created_by?: string | null
    created_at?: string
    updated_at?: string
}

// Create/update (admin). `tags` are "other ways agents ask".
export interface KnowledgeArticleInput {
    title: string
    content: string
    tags: string[]
    source: string | null
    status: KnowledgeStatus
    checked: boolean
    gapIds: string[]
}
