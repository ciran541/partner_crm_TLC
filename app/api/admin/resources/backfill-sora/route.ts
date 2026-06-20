import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { fetchAllSoraFromMas } from '@/lib/insurance/sora'
import { createAdminClient } from '@/lib/supabase/admin'

// One-time admin route to backfill full SORA history from MAS into sora_rates.
// The MAS API returns ~20 years of daily data (~5000 rows). Upserted in batches of 500.
export const maxDuration = 60

export async function POST() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const rows = await fetchAllSoraFromMas()
    if (rows.length === 0) {
        return NextResponse.json({ error: 'No data returned from MAS' }, { status: 502 })
    }

    const admin = createAdminClient()
    const BATCH = 500
    let upserted = 0
    const now = new Date().toISOString()

    for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH).map(r => ({ ...r, fetched_at: now }))
        const { error } = await admin
            .from('sora_rates')
            .upsert(batch, { onConflict: 'value_date' })
        if (error) {
            return NextResponse.json({ error: error.message, upserted }, { status: 500 })
        }
        upserted += batch.length
    }

    return NextResponse.json({ success: true, upserted })
}
