import { NextResponse } from 'next/server'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { validateIntake, intakeToCaseRow, mobileKey, type RawIntake } from '@/lib/insurance/caseIntake'
import { loadBankNames, ownMobileIndex } from '@/lib/insurance/caseIntakeServer'
import { MAX_ROWS } from '@/lib/insurance/sheetImport'

/**
 * POST /api/insurance/cases/import/commit — mass upload, step 3: SAVE the rows
 * the agent approved on the preview screen.
 *
 * Body: { rows: RawIntake[] } (the preview's normalised values).
 *
 * Everything is re-checked here rather than trusted from the browser: each row
 * is validated again, and duplicates are re-checked against the database at
 * this moment (so two quick clicks, or a second tab, can't import twice).
 * Inserted with the caller's own session, so RLS and the admin-field trigger
 * apply exactly as for any other write.
 *
 * Calendar note: unlike a single New Case, imported follow-up dates are not
 * pushed to Google Calendar one by one (up to 2,000 calendar calls would outlast
 * the request). They still appear in HUB's Follow-ups and the reminder cron.
 */

const CHUNK = 100

export async function POST(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    let rows: RawIntake[]
    try {
        const body = await request.json()
        rows = Array.isArray(body?.rows) ? body.rows : []
    } catch {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    if (rows.length === 0) return NextResponse.json({ error: 'Nothing to import.' }, { status: 400 })
    if (rows.length > MAX_ROWS) return NextResponse.json({ error: `Up to ${MAX_ROWS} clients per upload.` }, { status: 400 })

    const db = await createServerSupabaseClient()
    const [banks, existing] = await Promise.all([loadBankNames(db), ownMobileIndex(db, auth.userId)])

    const toInsert: ReturnType<typeof intakeToCaseRow>[] = []
    let skipped = 0
    const seen = new Set<string>()
    for (const raw of rows) {
        const r = validateIntake(raw, banks)
        if (!r.ok) { skipped++; continue }
        const key = mobileKey(r.value.client_mobile)
        if (existing.has(key) || seen.has(key)) { skipped++; continue }
        seen.add(key)
        toInsert.push(intakeToCaseRow(r.value, auth.userId))
    }

    let created = 0
    for (let i = 0; i < toInsert.length; i += CHUNK) {
        const { error, count } = await db.from('cases').insert(toInsert.slice(i, i + CHUNK), { count: 'exact' })
        if (error) {
            console.error('[POST /api/insurance/cases/import/commit]', error)
            return NextResponse.json(
                { error: `Saved ${created} client${created === 1 ? '' : 's'}, then hit an error. Re-upload the same file — clients already saved are skipped automatically.`, created, skipped },
                { status: 500 },
            )
        }
        created += count ?? Math.min(CHUNK, toInsert.length - i)
    }

    return NextResponse.json({ created, skipped })
}
