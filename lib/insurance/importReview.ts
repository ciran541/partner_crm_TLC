/**
 * Mass upload review — classifies every row so the agent can FIX problems in
 * place instead of going back to their spreadsheet.
 *
 * Runs in the browser on every edit (instant feedback, like Flatfile / HubSpot
 * imports), using the same validateIntake() the server uses. The server's
 * /import/commit re-validates everything regardless — this is UX, not trust.
 *
 * Rules:
 *   - a row with any problem blocks the import until it's fixed or the agent
 *     explicitly removes it (problems are never silently left behind)
 *   - a mobile already in the agent's HUB → skipped (can't create duplicates)
 *   - the same mobile twice in the file → the first one counts, later ones skip
 *
 * Pure — tested in __tests__/importReview.test.ts.
 */

import { validateIntake, mobileKey, type CaseIntake, type FieldErrors, type RawIntake } from '@/lib/insurance/caseIntake'

/** One uploaded row as the agent is editing it: field → typed text. */
export type EditableRaw = Partial<Record<keyof CaseIntake, string>>

export interface ReviewInput {
    rowNumber: number      // line in the agent's own file
    raw: EditableRaw
    removed?: boolean      // agent chose "Remove row"
}

export type ReviewStatus = 'ok' | 'error' | 'duplicate' | 'removed'

export interface ReviewRow {
    rowNumber: number
    status: ReviewStatus
    value?: CaseIntake           // ok / duplicate
    fieldErrors?: FieldErrors    // error
    reason?: string              // duplicate
}

export interface ReviewSummary {
    rows: ReviewRow[]
    counts: Record<ReviewStatus, number>
    /** The import is allowed only when no unresolved problem remains. */
    canImport: boolean
    ready: CaseIntake[]
}

/** Turn mapped cells into editable text (numbers/dates → strings, blanks dropped). */
export function toEditable(raw: RawIntake): EditableRaw {
    const out: EditableRaw = {}
    for (const [k, v] of Object.entries(raw)) {
        if (v == null) continue
        const s = String(v).trim()
        if (s) out[k as keyof CaseIntake] = s
    }
    return out
}

export function reviewRows(
    rows: ReviewInput[],
    banks: readonly string[],
    existing: ReadonlyMap<string, string | null>,   // mobileKey → existing client name
): ReviewSummary {
    const seen = new Map<string, number>()   // mobileKey → first row number in this file
    const out: ReviewRow[] = rows.map(r => {
        if (r.removed) return { rowNumber: r.rowNumber, status: 'removed' }
        const v = validateIntake(r.raw, banks)
        if (!v.ok) return { rowNumber: r.rowNumber, status: 'error', fieldErrors: v.fieldErrors }

        const key = mobileKey(v.value.client_mobile)
        if (existing.has(key)) {
            const name = existing.get(key)
            return { rowNumber: r.rowNumber, status: 'duplicate', value: v.value, reason: `Already in HUB${name ? ` as ${name}` : ''}` }
        }
        const first = seen.get(key)
        if (first != null) return { rowNumber: r.rowNumber, status: 'duplicate', value: v.value, reason: `Same mobile as row ${first}` }
        seen.set(key, r.rowNumber)
        return { rowNumber: r.rowNumber, status: 'ok', value: v.value }
    })

    const counts: Record<ReviewStatus, number> = { ok: 0, error: 0, duplicate: 0, removed: 0 }
    for (const r of out) counts[r.status]++
    return {
        rows: out,
        counts,
        canImport: counts.error === 0 && counts.ok > 0,
        ready: out.filter(r => r.status === 'ok').map(r => r.value!),
    }
}

/**
 * Bulk fix: rows (other than `exceptIndex`) whose `field` currently holds exactly
 * `value`. Lets one correction — e.g. a case type "Refi loan" HUB doesn't know —
 * be applied to every row with the same text instead of fixing 300 rows by hand.
 */
export function rowsWithSameValue(rows: ReviewInput[], field: keyof CaseIntake, value: string, exceptIndex: number): number[] {
    const target = value.trim()
    if (!target) return []
    return rows.flatMap((r, i) => (i !== exceptIndex && !r.removed && (r.raw[field] ?? '').trim() === target ? [i] : []))
}
