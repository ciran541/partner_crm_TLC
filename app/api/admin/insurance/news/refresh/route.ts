import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { ingestAll } from '@/lib/insurance/news'

// POST /api/admin/insurance/news/refresh — manual "Refresh now" trigger,
// same effect as the daily cron. Guarded by requireAdminUser().
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const result = await ingestAll()
    if (!result) return NextResponse.json({ error: 'News refresh failed' }, { status: 502 })
    return NextResponse.json({ success: true, ...result })
}
