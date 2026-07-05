import { NextResponse } from 'next/server'
import { refreshAll } from '@/lib/insurance/sora'
import { requireCronAuth } from '@/lib/auth/requireCron'

// GET /api/cron/sora — daily Vercel cron. Fetches MAS SORA and upserts the latest row
// into both sora_rates and domestic_rates (single MAS round-trip for both tables).
export const dynamic = 'force-dynamic'
export const maxDuration = 60   // MAS returns a large payload; allow headroom

export async function GET(request: Request) {
    const auth = requireCronAuth(request)
    if (!auth.authorized) return auth.response

    const row = await refreshAll()
    if (!row) return NextResponse.json({ error: 'SORA refresh failed' }, { status: 502 })
    return NextResponse.json({ success: true, sora: row })
}
