import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { importCpiIcsDates } from '@/lib/insurance/economicCalendar'

// POST /api/admin/insurance/calendar/import-cpi-ics
// Body: { icsContent: string } — the raw contents of BLS's bls.ics file,
// downloaded manually by the admin (BLS blocks automated fetches of it).
// Guarded by requireAdminUser().
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const body = await request.json().catch(() => ({}))
    const icsContent = body?.icsContent as string | undefined
    if (!icsContent?.trim()) {
        return NextResponse.json({ error: 'Missing icsContent' }, { status: 400 })
    }

    const result = await importCpiIcsDates(icsContent)
    return NextResponse.json({ success: true, ...result })
}
