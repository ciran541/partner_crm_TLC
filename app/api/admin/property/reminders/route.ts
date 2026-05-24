import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'

export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const admin = createAdminClient()

    const { data: reminders, error } = await admin
        .from('property_reminders')
        .select('id, case_id, reminder_type, trigger_date, is_sent, sent_at, created_at')
        .order('trigger_date', { ascending: true })
        .limit(200)

    if (error) {
        return NextResponse.json({ error: 'Failed to fetch reminders' }, { status: 500 })
    }

    // Enrich with case client_name
    const caseIds = [...new Set((reminders ?? []).map(r => r.case_id))]
    let caseMap: Record<string, string> = {}
    if (caseIds.length > 0) {
        const { data: cases } = await admin
            .from('property_cases')
            .select('id, client_name')
            .in('id', caseIds)
        caseMap = Object.fromEntries((cases ?? []).map(c => [c.id, c.client_name as string]))
    }

    const enriched = (reminders ?? []).map(r => ({
        ...r,
        client_name: caseMap[r.case_id] ?? '—',
    }))

    return NextResponse.json({ data: enriched })
}
