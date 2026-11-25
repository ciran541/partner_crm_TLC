'use client'

import { useState } from 'react'
import { useDebouncedValue } from '@/lib/insurance/usePagedCases'
import { MIN_SEARCH, ownCasesKey, type OwnCaseQuery } from '@/lib/insurance/ownCases'
import { ownCasesStore } from '@/lib/insurance/ownCasesStore'
import { useList } from '@/lib/shared/useList'
import type { CaseListRow } from '@/lib/insurance/caseQuery'

/**
 * Read one of the signed-in agent's lists. While a new filter loads, the previous
 * answer stays on screen (`refreshing`: dim it), so switching never blanks.
 */
export function useKeptList<M>(key: string, { enabled = true, settling = false }: { enabled?: boolean; settling?: boolean } = {}) {
    const q = useList<CaseListRow, M>(ownCasesStore, key, { enabled })
    const answered = q.status === 'ready' || q.status === 'empty'
    const [kept, setKept] = useState<{ rows: CaseListRow[]; total: number | null; meta?: M } | null>(null)
    if (answered && (kept?.rows !== q.rows || kept.meta !== q.meta || kept.total !== q.total)) {
        // `rows` is a new [] each time only when there is no page, and then we aren't answered.
        setKept({ rows: q.rows, total: q.total, meta: q.meta })
    }
    const shown = answered ? q : kept
    const failed = enabled && q.status === 'error'
    const waiting = enabled && (settling || q.status === 'loading')
    const hasRows = (shown?.rows.length ?? 0) > 0

    return {
        /** The server has answered THIS query: totals and "empty" can be trusted. */
        ready: answered && !settling,
        rows: shown?.rows ?? [],
        total: shown?.total ?? 0,
        meta: shown?.meta,
        hasMore: q.hasMore,
        loading: waiting && !hasRows,
        refreshing: waiting && hasRows,
        loadingMore: q.loadingMore,
        moreError: q.moreError,
        error: failed ? 'Could not load cases. Please try again.' : null,
        refreshError: q.outOfDate,
        loadMore: q.loadMore,
        refresh: q.retry,
    }
}

export function useOwnCases(query: OwnCaseQuery, options?: { enabled?: boolean }) {
    const typed = (query.search ?? '').trim().length >= MIN_SEARCH ? query.search!.trim() : ''
    const search = useDebouncedValue(typed)
    const q = useKeptList<{ loanVolume?: number }>(ownCasesKey({ ...query, search }), { enabled: options?.enabled, settling: search !== typed })
    return { ...q, loanVolume: q.meta?.loanVolume ?? 0 }
}
