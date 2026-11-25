'use client'

import { invalidatePagedCases, clearPagedCasesCache } from '@/lib/insurance/usePagedCases'
import { ownCasesStore } from '@/lib/insurance/ownCasesStore'
import { actionCentreStore } from '@/lib/insurance/actionCentreStore'

/**
 * One entry point for "case data changed" and "user signed out".
 *
 * Case data lives in three client stores: admin's paged rows, an agent's own
 * lists (Cases, Track, Earnings, Dashboard) and the Action Centre's. A mutation almost always affects them all, and
 * leaving each call site to remember every one is how a screen quietly shows a
 * stale number.
 *
 * This replaces refreshCases() from the old whole-table store, which had grown
 * the same responsibility by accident.
 */

/** Call after any mutation that could change which cases match, or their totals. */
export function invalidateCaseData(): void {
    invalidateCaseLists()
    actionCentreStore.invalidate()
}

/** For the Action Centre itself, which has already moved the saved case. */
export function invalidateCaseLists(): void {
    invalidatePagedCases()
    ownCasesStore.invalidate()
}

/** For Track, which has already moved the saved card. */
export function invalidateAfterMove(): void {
    invalidatePagedCases()
    actionCentreStore.invalidate()
}

/** Call on sign-out so the next user never sees the previous user's data. */
export function clearCaseCaches(): void {
    clearPagedCasesCache()
    ownCasesStore.clear()
    actionCentreStore.clear()
}
