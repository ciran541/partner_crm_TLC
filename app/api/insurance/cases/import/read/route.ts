import { NextResponse } from 'next/server'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { readSheet, MAX_BYTES } from '@/lib/insurance/sheetImport'
import { guessMapping } from '@/lib/insurance/columnMatch'
import { loadBankNames } from '@/lib/insurance/caseIntakeServer'

/**
 * POST /api/insurance/cases/import/read — mass upload, step 1: open the agent's
 * own file (multipart `file`, Excel or CSV, any layout) and suggest which column
 * is which. Nothing is written.
 *
 * Returns the grid so the browser can show the mapping screen and send the
 * confirmed mapping + rows to /import for the row-by-row check. The file never
 * leaves our server — no third-party service sees client data.
 */
export async function POST(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    let file: File | null = null
    try {
        const f = (await request.formData()).get('file')
        file = f instanceof File ? f : null
    } catch { /* handled below */ }
    if (!file) return NextResponse.json({ error: 'No file received.' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File is too large (8 MB max).' }, { status: 400 })

    const sheet = await readSheet(await file.arrayBuffer(), file.name)
    if (!sheet.ok) return NextResponse.json({ error: sheet.error }, { status: 400 })

    const banks = await loadBankNames(await createServerSupabaseClient())
    const guesses = guessMapping(sheet.headers, sheet.rows, banks)

    return NextResponse.json({
        fileName: file.name,
        sheetName: sheet.sheetName,
        headers: sheet.headers,
        rows: sheet.rows,
        rowNumbers: sheet.rowNumbers,
        guesses,
    })
}
