import { NextResponse } from 'next/server'
import { runDriveSync } from '@/lib/google/driveSyncRun'
import { requireCronAuth } from '@/lib/auth/requireCron'

// GET /api/cron/drive-sync — daily Vercel cron. Mirrors both apps' Storage
// document buckets into a shared Google Drive folder (Property CRM /
// Insurance CRM subfolders, then one subfolder per case) so ops can browse
// LO/case documents without touching Supabase Storage or R2 directly.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
    const auth = requireCronAuth(request)
    if (!auth.authorized) return auth.response

    try {
        const result = await runDriveSync()
        return NextResponse.json({ success: true, ...result })
    } catch (err) {
        console.error('[drive-sync] run failed', err)
        return NextResponse.json({ error: 'Drive sync failed' }, { status: 502 })
    }
}
