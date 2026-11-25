'use client'

import { createListStore } from '@/lib/shared/listStore'
import { applyMove, TRACK_API, trackColumnKey, trackFilterOf } from '@/lib/insurance/ownCases'
import type { CaseListRow } from '@/lib/insurance/caseQuery'

/**
 * Cases, Track, Earnings and Dashboard data. Answers without rows (Dashboard,
 * closed-by-month) are kept whole in `meta`.
 */
export const ownCasesStore = createListStore({
    pageSize: 25,
    fetchJson: async url => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        const body = await res.json()
        return 'rows' in body ? body : { rows: [], meta: body }
    },
    // One track request fills its four columns, always with the latest truth.
    onLoad: (key, body, seed) => {
        if (key.split('?')[0] !== TRACK_API) return
        const { columns } = body.meta as { columns: Record<string, Record<string, unknown>> }
        for (const [stage, page] of Object.entries(columns)) seed(trackColumnKey(stage, trackFilterOf(key)), page, true)
    },
})

/** A Track card was moved: show it at once; everything is re-read on its next visit. */
export function applyTrackMove(before: CaseListRow, after: CaseListRow) {
    ownCasesStore.patch((key, page) => applyMove(key, page, before, after))
}
