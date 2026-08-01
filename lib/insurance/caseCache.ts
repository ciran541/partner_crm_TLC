'use client'

import { invalidatePagedCases, clearPagedCasesCache } from '@/lib/insurance/usePagedCases'
import { invalidateCaseSummary, clearCaseSummaryCache } from '@/lib/insurance/useCaseSummary'

/**
 * One entry point for "case data changed" and "user signed out".
 *
 * Case data is now split across two client stores — paged rows and server-
 * computed summaries — and a mutation almost always affects both: changing a
 * stage moves a row between lists AND shifts a commission total. Leaving each
 * call site to remember both is how one gets forgotten and a screen quietly
 * shows a stale number.
 *
 * This replaces refreshCases() from the old whole-table store, which had grown
 * the same responsibility by accident.
 */

/** Call after any mutation that could change which cases match, or their totals. */
export function invalidateCaseData(): void {
    invalidatePagedCases()
    invalidateCaseSummary()
}

/** Call on sign-out so the next user never sees the previous user's data. */
export function clearCaseCaches(): void {
    clearPagedCasesCache()
    clearCaseSummaryCache()
}
