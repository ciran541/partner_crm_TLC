import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'

export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const admin = createAdminClient()

    const [casesRes, followUpsRes] = await Promise.all([
        admin
            .from('property_cases')
            .select('id, status, case_type, gross_commission_amount, agent_commission_amount, tlc_commission_amount, commission_status, agent_id, created_at'),
        admin
            .from('property_cases')
            .select('id, follow_up_date, followup_completed_at')
            .not('follow_up_date', 'is', null),
    ])

    const cases = casesRes.data ?? []
    const followUps = followUpsRes.data ?? []

    // Enrich with agent names
    const agentIds = [...new Set(cases.map(c => c.agent_id))]
    let agentMap: Record<string, string> = {}
    if (agentIds.length > 0) {
        const { data: profiles } = await admin
            .from('profiles')
            .select('id, name')
            .in('id', agentIds)
        agentMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.name as string]))
    }

    // Aggregate stats
    const statusCounts: Record<string, number> = {}
    const typeCounts: Record<string, number> = {}
    const commissionByPaymentStatus: Record<string, number> = { pending: 0, confirmed: 0, paid: 0 }
    const agentStats: Record<string, { name: string; count: number; totalAgentCommission: number }> = {}
    const monthlyVolume: Record<string, number> = {}

    for (const c of cases) {
        statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1
        typeCounts[c.case_type] = (typeCounts[c.case_type] ?? 0) + 1

        const commStatus = c.commission_status as string
        commissionByPaymentStatus[commStatus] =
            (commissionByPaymentStatus[commStatus] ?? 0) + (c.agent_commission_amount ?? 0)

        if (!agentStats[c.agent_id]) {
            agentStats[c.agent_id] = { name: agentMap[c.agent_id] ?? 'Unknown', count: 0, totalAgentCommission: 0 }
        }
        agentStats[c.agent_id].count++
        agentStats[c.agent_id].totalAgentCommission += c.agent_commission_amount ?? 0

        const month = (c.created_at as string).slice(0, 7)
        monthlyVolume[month] = (monthlyVolume[month] ?? 0) + 1
    }

    const topAgents = Object.values(agentStats)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)

    const monthlyVolumeSorted = Object.entries(monthlyVolume)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-6)
        .map(([month, count]) => ({ month, count }))

    const totalGross = cases.reduce((s, c) => s + (c.gross_commission_amount ?? 0), 0)
    const totalAgentCommission = cases.reduce((s, c) => s + (c.agent_commission_amount ?? 0), 0)
    const totalTlcCommission = cases.reduce((s, c) => s + (c.tlc_commission_amount ?? 0), 0)
    const activeCases = cases.filter(c => !['closed_won', 'closed_lost'].includes(c.status)).length
    const opportunityDue = statusCounts['opportunity_due'] ?? 0

    return NextResponse.json({
        data: {
            totalCases: cases.length,
            activeCases,
            opportunityDue,
            totalGross,
            totalAgentCommission,
            totalTlcCommission,
            statusCounts,
            typeCounts,
            commissionByPaymentStatus,
            topAgents,
            monthlyVolume: monthlyVolumeSorted,
            followUps: {
                total: followUps.length,
                completed: followUps.filter(r => !!r.followup_completed_at).length,
                pending: followUps.filter(r => !r.followup_completed_at).length,
                overdue: followUps.filter(r => !r.followup_completed_at && r.follow_up_date < new Date().toISOString().split('T')[0]).length,
            },
        },
    })
}
