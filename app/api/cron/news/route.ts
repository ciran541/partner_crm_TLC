import { NextResponse } from 'next/server'
import { ingestAll } from '@/lib/insurance/news'

// GET /api/cron/news — daily Vercel cron. Fetches all 7 mortgage-news sources
// (via Google News site-scoped RSS), classifies new items, and stores them.
// Protected by CRON_SECRET (Vercel sends `Authorization: Bearer <CRON_SECRET>`).
export const dynamic = 'force-dynamic'
export const maxDuration = 60   // up to 7 feeds + per-item Gemini classification

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET
    if (secret) {
        const auth = request.headers.get('authorization')
        if (auth !== `Bearer ${secret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
    }

    const result = await ingestAll()
    if (!result) return NextResponse.json({ error: 'News ingestion failed' }, { status: 502 })
    return NextResponse.json({ success: true, ...result })
}
