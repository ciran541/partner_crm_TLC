import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePropertyUser } from '@/lib/auth/requirePropertyUser'
import { syncFollowUpToCalendar } from '@/lib/google/syncFollowUp'

export async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    const { id } = await params
    const admin = createAdminClient()

    const { data: caseData, error } = await admin
        .from('property_cases')
        .select('agent_id, follow_up_date, followup_preference, client_name, followup_completed_at')
        .eq('id', id)
        .single()

    if (error || !caseData) {
        return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    if (!auth.isAdmin && caseData.agent_id !== auth.userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!caseData.follow_up_date) {
        return NextResponse.json({ error: 'No follow-up date set for this case' }, { status: 400 })
    }

    if (caseData.followup_completed_at) {
        return NextResponse.json({ error: 'Follow-up already completed' }, { status: 400 })
    }

    if (!caseData.followup_preference) {
        return NextResponse.json({ error: 'No follow-up preference set for this case' }, { status: 400 })
    }

    await syncFollowUpToCalendar(
        caseData.agent_id,
        id,
        caseData.followup_preference as 'self' | 'tlc',
        'upsert',
        caseData.follow_up_date,
        caseData.client_name,
        `${process.env.NEXT_PUBLIC_APP_URL}/property/cases/${id}`
    )

    return NextResponse.json({ success: true })
}
