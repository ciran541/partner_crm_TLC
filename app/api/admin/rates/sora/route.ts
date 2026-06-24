import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { refreshSora, getCurrentSora, getAllBenchmarks, setBenchmark } from '@/lib/insurance/sora'

export const maxDuration = 60

// GET  /api/admin/rates/sora — current stored SORA + bank benchmarks (admin)
export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const [sora, benchmarks] = await Promise.all([getCurrentSora(), getAllBenchmarks()])
    return NextResponse.json({ sora, benchmarks })
}

// POST /api/admin/rates/sora — "refresh now": fetch latest from MAS and store
export async function POST() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const row = await refreshSora()
    if (!row) return NextResponse.json({ error: 'SORA refresh failed — check MAS_API_KEY.' }, { status: 502 })
    return NextResponse.json({ success: true, sora: row })
}

// PATCH /api/admin/rates/sora — update a bank benchmark { key, value }
export async function PATCH(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const body = await request.json()
    const { key, value } = body ?? {}
    if (typeof key !== 'string' || !key.trim()) {
        return NextResponse.json({ error: 'key is required' }, { status: 400 })
    }
    const v = parseFloat(value)
    if (!Number.isFinite(v) || v < 0 || v > 20) {
        return NextResponse.json({ error: 'value must be a rate percentage (0–20)' }, { status: 400 })
    }
    const ok = await setBenchmark(key.trim().toUpperCase(), v)
    if (!ok) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    return NextResponse.json({ success: true })
}
