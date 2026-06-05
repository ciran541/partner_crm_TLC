import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { refreshSora, getCurrentSora } from '@/lib/insurance/sora'

export const maxDuration = 60

// GET  /api/admin/rates/sora — current stored SORA (admin)
export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const sora = await getCurrentSora()
    return NextResponse.json({ sora })
}

// POST /api/admin/rates/sora — "refresh now": fetch latest from MAS and store
export async function POST() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const row = await refreshSora()
    if (!row) return NextResponse.json({ error: 'SORA refresh failed — check MAS_API_KEY.' }, { status: 502 })
    return NextResponse.json({ success: true, sora: row })
}
