'use client'

import { createListStore } from '@/lib/shared/listStore'
import { applySave, MISSING_KEY, NOW_KEY, sectionKey, tabPages, type ActionMeta, type ActionRow } from '@/lib/insurance/actionCentre'
import { todaySgt } from '@/lib/insurance/promotions'

/**
 * Action Centre's lists, shared by the page and the sidebar's overdue count:
 * the 'now' request carries the counts and the first rows of the tabs, so one
 * call serves both (and the page opens instantly).
 */
export const actionCentreStore = createListStore({
    fetchJson: async url => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        return res.json()
    },
    onLoad: (key, body, seed) => {
        if (key !== NOW_KEY) return
        if (body.missing) seed(MISSING_KEY, body.missing as Record<string, unknown>)
        const counts = (body.meta as ActionMeta | undefined)?.counts
        if (!counts) return
        for (const { section, ...page } of tabPages((body.rows as ActionRow[]) ?? [], counts, todaySgt())) seed(sectionKey(section), page)
    },
})

export function applyFollowUpSave(before: ActionRow, after: ActionRow, today: string) {
    actionCentreStore.patch((key, page) => applySave(key, page, before, after, today))
}
