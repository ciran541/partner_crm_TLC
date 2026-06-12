import type { Case } from '@/lib/types'

/**
 * A "draft" case is one started from the Mortgage Planner but not yet committed
 * to the pipeline: it has no client name and is still at the first stage.
 *
 * Drafts are intentionally HIDDEN from the back-of-house pipeline (Dashboard,
 * Cases list) so that a planner session left half-finished in front of a client
 * never clutters the agent's pipeline. The moment the agent adds a client name
 * OR advances the stage, the case stops being a draft and appears normally —
 * the rule is self-maintaining, no flag column required.
 *
 * Drafts are still resumable from the Planner's "In progress" list.
 */
export function isDraftCase(c: Case): boolean {
    return !c.client_name?.trim() && c.stage === 'Touched Base'
}
