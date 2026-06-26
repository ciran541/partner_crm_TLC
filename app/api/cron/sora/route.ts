import { NextResponse } from 'next/server'
import { refreshAll } from '@/lib/insurance/sora'

// GET /api/cron/sora — daily Vercel cron. Fetches MAS SORA and upserts the latest row
// into both sora_rates and domestic_rates (single MAS round-trip for both tables).
// Protected by CRON_SECRET (Vercel sends `Authorization: Bearer <CRON_SECRET>`).
export const dynamic = 'force-dynamic'
export const maxDuration = 60   // MAS returns a large payload; allow headroom

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET
    if (secret) {
        const auth = request.headers.get('authorization')
        if (auth !== `Bearer ${secret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
    }

    const row = await refreshAll()
    if (!row) return NextResponse.json({ error: 'SORA refresh failed' }, { status: 502 })
    return NextResponse.json({ success: true, sora: row })
}
