import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePropertyUser } from '@/lib/auth/requirePropertyUser'

export async function GET() {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    if (auth.isAdmin) {
        return NextResponse.json({ error: 'Admins do not have a follow-up list' }, { status: 403 })
    }

    const admin = createAdminClient()

    const { data, error } = await admin
        .from('property_cases')
        .select('*, banks(id, name)')
        .eq('agent_id', auth.userId)
        .eq('followup_preference', 'self')
        .not('follow_up_date', 'is', null)
        .is('followup_completed_at', null)
        .order('follow_up_date', { ascending: true })

    if (error) {
        console.error('Follow-up fetch error:', error)
        return NextResponse.json({ error: 'Failed to fetch follow-ups' }, { status: 500 })
    }

    return NextResponse.json({ data: data ?? [] })
}
