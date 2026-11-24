/** Basic & Starter admin dashboard maths. Pure; pinned by adminAnalytics.test.ts. */

export interface PropertyAnalyticsCase {
    id: string; status: string; case_type: string; agent_id: string; created_at: string; is_duplicate: boolean | null
    gross_commission_amount: number | null; agent_commission_amount: number | null; tlc_commission_amount: number | null
    commission_status: string; follow_up_date: string | null; followup_completed_at: string | null
}

const sgtMonth = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 7)

export function propertyAnalytics(all: PropertyAnalyticsCase[], names: Record<string, string>, today: string) {
    // Same rule as Earnings: a draft isn't submitted, and a duplicate earns nothing.
    const cases = all.filter(c => c.status !== 'draft' && !c.is_duplicate)
    const sum = (f: (c: PropertyAnalyticsCase) => number | null) => Math.round(cases.reduce((s, c) => s + Number(f(c) ?? 0), 0) * 100) / 100
    const count = (f: (c: PropertyAnalyticsCase) => string) => cases.reduce<Record<string, number>>((m, c) => ({ ...m, [f(c)]: (m[f(c)] ?? 0) + 1 }), {})

    const commissionByPaymentStatus: Record<string, number> = { pending: 0, confirmed: 0, paid: 0 }
    const agents = new Map<string, { name: string; count: number; totalAgentCommission: number }>()
    for (const c of cases) {
        const amount = Number(c.agent_commission_amount ?? 0)
        commissionByPaymentStatus[c.commission_status] = (commissionByPaymentStatus[c.commission_status] ?? 0) + amount
        const a = agents.get(c.agent_id) ?? { name: names[c.agent_id] ?? 'Unknown', count: 0, totalAgentCommission: 0 }
        a.count++
        a.totalAgentCommission += amount
        agents.set(c.agent_id, a)
    }

    // Last six months, including empty ones.
    const [y, m] = today.split('-').map(Number)
    const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(y, m - 6 + i, 1)).toISOString().slice(0, 7))
    const byMonth = count(c => sgtMonth(c.created_at))
    const follow = cases.filter(c => c.follow_up_date)
    const open = follow.filter(c => !c.followup_completed_at)
    const statusCounts = count(c => c.status)
    return {
        totalCases: cases.length,
        // Submitted, or due for its next cycle. Paid and rejected cases are finished.
        activeCases: cases.filter(c => c.status === 'submitted' || c.status === 'opportunity_due').length,
        opportunityDue: statusCounts.opportunity_due ?? 0,
        totalGross: sum(c => c.gross_commission_amount),
        totalAgentCommission: sum(c => c.agent_commission_amount),
        totalTlcCommission: sum(c => c.tlc_commission_amount),
        statusCounts,
        typeCounts: count(c => c.case_type),
        commissionByPaymentStatus,
        topAgents: [...agents.values()].sort((a, b) => b.count - a.count).slice(0, 5),
        monthlyVolume: months.map(month => ({ month, count: byMonth[month] ?? 0 })),
        followUps: {
            total: follow.length, completed: follow.length - open.length, pending: open.length,
            overdue: open.filter(c => c.follow_up_date! < today).length,
        },
    }
}
