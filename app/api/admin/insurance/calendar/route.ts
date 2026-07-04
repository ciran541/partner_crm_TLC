import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { getAllEvents, createManualEvent, updateEvent, deleteEvent } from '@/lib/insurance/economicCalendar'
import type { EconomicCalendarEventInput } from '@/lib/types/calendar'

// Admin QA for the Economic Calendar. Guarded by requireAdminUser().
//   GET                     → list all events (incl. hidden)
//   POST   { input }        → manual create (MAS MPS entries, mainly)
//   PATCH  { id, patch }    → edit (impact_stars/hidden/admin_notes/values)
//   DELETE ?id=             → delete

export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const data = await getAllEvents()
    return NextResponse.json({ data })
}

export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const body = await request.json().catch(() => ({}))
    const input = body?.input as EconomicCalendarEventInput | undefined
    if (!input?.event_key || !input?.event_name || !input?.event_date) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const data = await createManualEvent(input)
    if (!data) return NextResponse.json({ error: 'Failed to create event' }, { status: 500 })
    return NextResponse.json({ data })
}

export async function PATCH(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const body = await request.json().catch(() => ({}))
    const { id, patch } = body as { id?: string; patch?: Partial<EconomicCalendarEventInput> }
    if (!id || !patch) return NextResponse.json({ error: 'Missing id or patch' }, { status: 400 })

    const ok = await updateEvent(id, patch)
    if (!ok) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const ok = await deleteEvent(id)
    if (!ok) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
    return NextResponse.json({ success: true })
}
