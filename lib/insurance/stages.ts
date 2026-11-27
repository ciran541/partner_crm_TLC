import type { PipelineStage } from '@/lib/types'

/**
 * The ONE list of insurance pipeline stages, in order, plus their badge colours.
 * Every screen imports from here — six screens used to keep their own copy,
 * which is how a new stage ends up missing from one of them.
 *
 * "Inactive" is a parking stage for past clients the agent has brought into HUB
 * purely so the follow-up reminders work (e.g. closed years ago, not due to
 * refinance yet). It sits outside the live pipeline: no commission, not in the
 * Active list. The agent moves the case to an active stage when it's time.
 * The SQL side of these rules is migration 20261118000000_inactive_stage.sql.
 */

export const INACTIVE_STAGE: PipelineStage = 'Inactive'

export const PIPELINE_STAGES: PipelineStage[] = [
    'Inactive',
    'Touched Base',
    'Pending Docs',
    'IPA',
    'Pending Approval',
    'Pending Signature',
    'Closed Won',
    'Closed Lost',
]

/** Live pipeline stages — the "Active" filter, and what a case can be moved into from Inactive. */
export const OPEN_STAGES: PipelineStage[] = ['Touched Base', 'Pending Docs', 'IPA', 'Pending Approval', 'Pending Signature']

/**
 * Stages a case can be CREATED in (New Case form, mass upload). Never Closed Won
 * or Closed Lost: those go through their closure modals, and Closed Won is what
 * triggers a payout, so it must never be reachable by typing it into a form or
 * a spreadsheet.
 */
export const CREATABLE_STAGES: PipelineStage[] = [INACTIVE_STAGE, ...OPEN_STAGES]

export const STAGE_BADGE: Record<PipelineStage, { bg: string; text: string }> = {
    'Inactive':          { bg: '#f1f5f9', text: '#64748b' },
    'Touched Base':      { bg: '#e0f2fe', text: '#0369a1' },
    'Pending Docs':      { bg: '#e0f2fe', text: '#0369a1' },
    'IPA':               { bg: '#ccfbf1', text: '#0f766e' },
    'Pending Approval':  { bg: '#fff7ed', text: '#9a3412' },
    'Pending Signature': { bg: '#fef3c7', text: '#92400e' },
    'Closed Won':        { bg: '#d1fae5', text: '#065f46' },
    'Closed Lost':       { bg: '#fee2e2', text: '#991b1b' },
}

/**
 * What agents SEE for each stage. "Touched Base" is shown as "Active" (product
 * decision 2026-11-20, matching its "Engage Prospect" follow-up). The stored
 * value stays 'Touched Base': DB rows, SQL functions, imports and Privyr all use
 * it, so only labels change. Always render a stage through stageLabel().
 */
export const STAGE_LABELS: Record<PipelineStage, string> = {
    'Inactive': 'Inactive',
    'Touched Base': 'Active',
    'Pending Docs': 'Pending Docs',
    'IPA': 'IPA',
    'Pending Approval': 'Pending Approval',
    'Pending Signature': 'Pending Signature',
    'Closed Won': 'Closed Won',
    'Closed Lost': 'Closed Lost',
}

export function stageLabel(stage: string | null | undefined): string {
    return STAGE_LABELS[stage as PipelineStage] ?? stage ?? ''
}

export function stageBadge(stage: string): { bg: string; text: string } {
    return STAGE_BADGE[stage as PipelineStage] ?? { bg: '#e0f2fe', text: '#0369a1' }
}

export function isInactive(stage: string | null | undefined): boolean {
    return stage === INACTIVE_STAGE
}
