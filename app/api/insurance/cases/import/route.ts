import { NextResponse } from 'next/server'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { applyMapping, mappingProblems, MATCH_FIELDS, type Mapping, type MatchField } from '@/lib/insurance/columnMatch'
import { toEditable } from '@/lib/insurance/importReview'
import { loadBankNames, ownMobileIndex } from '@/lib/insurance/caseIntakeServer'
import { MAX_ROWS, type Cell } from '@/lib/insurance/sheetImport'

/**
 * POST /api/insurance/cases/import — mass upload, step 2: apply the column
 * mapping the agent confirmed and hand back everything the REVIEW screen needs
 * to check and fix rows live in the browser. Nothing is written.
 *
 * Body: { rows: Cell[][], rowNumbers: number[], headers: string[], mapping: (MatchField | null)[] }
 *   (headers label the "Add to remarks" lines, e.g. "Status: Hot")
 *
 * Returns:
 *   rows      — each row as editable text per HUB field
 *   banks     — for canonical bank spelling (same list validateIntake uses here)
 *   existing  — the agent's OWN clients as [mobileKey, name], so a corrected
 *               mobile is re-checked for duplicates instantly. Only this agent's
 *               cases, which they can already see in HUB.
 *
 * The browser classifies rows with reviewRows() (importReview.ts); step 3
 * /import/commit re-validates everything server-side — this is never trusted.
 */
export async function POST(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    let rows: Cell[][], rowNumbers: number[], headers: string[], mapping: Mapping
    try {
        const body = await request.json()
        rows = Array.isArray(body?.rows) ? body.rows : []
        rowNumbers = Array.isArray(body?.rowNumbers) ? body.rowNumbers : []
        headers = Array.isArray(body?.headers) ? body.headers.map((h: unknown) => String(h ?? '')) : []
        const allowed = new Set<string>(MATCH_FIELDS)
        mapping = (Array.isArray(body?.mapping) ? body.mapping : [])
            .map((m: unknown) => (typeof m === 'string' && allowed.has(m) ? m as MatchField : null))
    } catch {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    if (rows.length === 0) return NextResponse.json({ error: 'No rows to check.' }, { status: 400 })
    if (rows.length > MAX_ROWS) return NextResponse.json({ error: `Up to ${MAX_ROWS} clients per upload.` }, { status: 400 })
    const problems = mappingProblems(mapping)
    if (problems.length) return NextResponse.json({ error: problems.join('. ') }, { status: 400 })

    const db = await createServerSupabaseClient()
    const [banks, existing] = await Promise.all([loadBankNames(db), ownMobileIndex(db, auth.userId)])

    return NextResponse.json({
        rows: rows.map((cells, i) => ({
            rowNumber: rowNumbers[i] ?? i + 2,
            raw: toEditable(applyMapping(Array.isArray(cells) ? cells : [], mapping, headers)),
        })),
        banks,
        existing: [...existing.entries()].map(([key, v]) => [key, v.name]),
    })
}
