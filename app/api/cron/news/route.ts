import { NextResponse } from 'next/server'
import { ingestAll } from '@/lib/insurance/news'
import { requireCronAuth } from '@/lib/auth/requireCron'

// GET /api/cron/news — daily Vercel cron. Fetches the native BT + CNA RSS feeds,
// classifies new items for relevance (AI), and stores them.
export const dynamic = 'force-dynamic'
export const maxDuration = 60   // feed fetches + batched AI classification

export async function GET(request: Request) {
    const auth = requireCronAuth(request)
    if (!auth.authorized) return auth.response

    const result = await ingestAll()
    if (!result) return NextResponse.json({ error: 'News ingestion failed' }, { status: 502 })
    return NextResponse.json({ success: true, ...result })
}
