import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/auth/requireCron'
import { checkDuePages } from '@/lib/insurance/officialSources'

// GET /api/cron/official-sources — daily. Reads the official pages that are due,
// flags changed ones and drafts answers for new ones. Pages left over (time
// budget) are picked up the next day.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
    const auth = requireCronAuth(request)
    if (!auth.authorized) return auth.response
    try {
        const results = await checkDuePages()
        return NextResponse.json({ success: true, checked: results.length, results })
    } catch (e) {
        console.error('[cron/official-sources]', e)
        return NextResponse.json({ error: 'Official sources check failed' }, { status: 502 })
    }
}
