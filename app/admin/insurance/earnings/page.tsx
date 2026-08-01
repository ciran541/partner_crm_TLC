'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle } from 'lucide-react'
import Skeleton from '@/components/shared/Skeleton'
import { invalidateCaseData } from '@/lib/insurance/caseCache'
import { MasterEarningsTable, AgentEarningsView } from '@/components/insurance/earnings/EarningsViews'
import type { CaseListRow } from '@/lib/insurance/usePagedCases'
import type { AgentCommissionRow } from '@/lib/insurance/commission'

export default function AdminInsuranceEarningsPage() {
    return (
        <Suspense fallback={<Skeleton height={320} radius={14} />}>
            <Content />
        </Suspense>
    )
}

function Content() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const agentParam = searchParams.get('agent')

    const [rows, setRows] = useState<AgentCommissionRow[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [savingId, setSavingId] = useState<string | null>(null)

    // Per-agent commission is computed by the database across the whole roster —
    // including agents with no cases, who belong in the table as a row of zeros.
    // `reload` is a counter rather than a boolean so a payout toggle always
    // refetches, even twice in a row.
    const [reload, setReload] = useState(0)

    useEffect(() => {
        // Fetched for the drill-down too, not just the master table: it is where
        // the agent's display name comes from. Without it the drill-down header
        // falls back to a generic "Agent".
        let active = true
        setError(null)
        fetch('/api/admin/insurance/earnings/by-agent')
            .then(r => (r.ok ? r.json() : Promise.reject(new Error(`Request failed (${r.status})`))))
            .then(body => { if (active) setRows((body.rows ?? []) as AgentCommissionRow[]) })
            .catch(() => { if (active) setError('Could not load earnings. Please try again.') })
        return () => { active = false }
    }, [agentParam, reload])

    const togglePaid = async (c: CaseListRow) => {
        const next = c.commission_status === 'paid' ? 'unpaid' : 'paid'
        setSavingId(c.id)
        try {
            const res = await fetch('/api/admin/update-case', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: c.id, updates: { commission_status: next } }),
            })
            if (!res.ok) throw new Error('Failed')
            // Refreshes the paged rows and the summary totals behind the
            // drill-down; the counter re-fetches the master table.
            invalidateCaseData()
            setReload(n => n + 1)
        } catch { /* non-fatal */ } finally { setSavingId(null) }
    }

    // Per-agent drill-down. The view scopes itself by agent id.
    if (agentParam) {
        const agentName = rows?.find(r => r.agentId === agentParam)?.agentName ?? 'Agent'
        return (
            <AgentEarningsView
                agentId={agentParam}
                title={agentName}
                subtitle={`${agentName}'s commission breakdown`}
                isAdmin
                savingId={savingId}
                onTogglePaid={togglePaid}
                onRowOpen={id => router.push(`/admin/insurance/cases/${id}`)}
                onBack={() => router.push('/admin/insurance/earnings')}
            />
        )
    }

    if (error) {
        return <div className="card p-4 flex items-center gap-2 text-red-600 text-sm"><AlertCircle size={16} />{error}</div>
    }
    if (!rows) {
        return (
            <div className="max-w-[1200px] mx-auto flex flex-col gap-5">
                <Skeleton height={36} width={200} radius={8} />
                <Skeleton height={320} radius={14} />
            </div>
        )
    }

    return (
        <div className="space-y-5">
            <div>
                <h1 className="text-2xl font-bold text-[#052d4a]">Insurance Earnings</h1>
                <p className="text-sm text-slate-500 mt-1">Commission across all agents. Click an agent to review and confirm payouts.</p>
            </div>
            <MasterEarningsTable
                rows={rows}
                onOpen={id => router.push(`/admin/insurance/earnings?agent=${id}`)}
            />
        </div>
    )
}
