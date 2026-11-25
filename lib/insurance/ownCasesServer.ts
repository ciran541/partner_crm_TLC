import { isDay } from '@/lib/insurance/actionCentre'
import { MIN_SEARCH, parseOwnCursor } from '@/lib/insurance/ownCases'

/** Shared request handling for the own-case routes. */

export interface OwnCasesResult { rows: unknown[]; next_cursor: string | null; total?: number; loan_volume?: number }

export const toListBody = (d: OwnCasesResult) => ({
    rows: d.rows ?? [],
    nextCursor: d.total != null && (d.rows ?? []).length >= d.total ? null : d.next_cursor ?? null,
    total: d.total ?? null,
    meta: d.loan_volume == null ? undefined : { loanVolume: Number(d.loan_volume) },
})

export const limitOf = (sp: URLSearchParams) => Math.min(200, Math.max(1, Number.parseInt(sp.get('limit') ?? '25', 10) || 25))

export function searchOf(sp: URLSearchParams): string | null {
    const s = sp.get('search')?.trim().slice(0, 80) ?? ''
    return s.length >= MIN_SEARCH ? s : null
}

/** null = malformed (answer 400); {} = first page. */
export function cursorOf(sp: URLSearchParams): Record<string, string> | null {
    const raw = sp.get('cursor')
    if (!raw) return {}
    const c = parseOwnCursor(raw)
    return c ? { p_cursor_key: c.key, p_cursor_id: c.id } : null
}

/** 'YYYY' or 'YYYY-MM'. */
export const isPeriod = (v: string) => /^\d{4}$/.test(v) || (/^\d{4}-\d{2}$/.test(v) && isDay(`${v}-01`))
