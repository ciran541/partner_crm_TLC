import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'

export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const admin = createAdminClient()

    // Fetch all cases that have a follow_up_date set
    const { data: cases, error } = await admin
        .from('property_cases')
        .select('id, client_name, client_mobile, follow_up_date, followup_preference, followup_completed_at, agent_id, lock_in_period, projected_agent_income')
        .not('follow_up_date', 'is', null)
        .order('follow_up_date', { ascending: true })

    if (error) {
        return NextResponse.json({ error: 'Failed to fetch follow-ups' }, { status: 500 })
    }

    // Enrich with agent names
    const agentIds = [...new Set((cases ?? []).map(c => c.agent_id))]
    let agentMap: Record<string, string> = {}
    if (agentIds.length > 0) {
        const { data: profiles } = await admin
            .from('profiles')
            .select('id, full_name, name')
            .in('id', agentIds)
        agentMap = Object.fromEntries(
            (profiles ?? []).map(p => [p.id, p.full_name ?? p.name ?? 'Agent'])
        )
    }

    const enriched = (cases ?? []).map(c => ({
        id: c.id,
        client_name: c.client_name,
        client_mobile: c.client_mobile,
        follow_up_date: c.follow_up_date,
        followup_preference: c.followup_preference,
        followup_completed_at: c.followup_completed_at,
        agent_id: c.agent_id,
        agent_name: agentMap[c.agent_id] ?? 'Agent',
        lock_in_period: c.lock_in_period,
        projected_agent_income: c.projected_agent_income,
    }))

    return NextResponse.json({ data: enriched })
}
