'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle } from 'lucide-react'
import Skeleton from '@/components/shared/Skeleton'
import { useCases, refreshCases } from '@/lib/insurance/useCases'
import { commissionByAgent } from '@/lib/insurance/commission'
import { MasterEarningsTable, AgentEarningsView } from '@/components/insurance/earnings/EarningsViews'
import type { Case } from '@/lib/types'

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
    const { cases, loading, error } = useCases()

    const [roster, setRoster] = useState<{ id: string; name: string }[]>([])
    const [savingId, setSavingId] = useState<string | null>(null)

    useEffect(() => {
        fetch('/api/admin/get-profiles')
            .then(r => (r.ok ? r.json() : []))
            .then((profiles) => {
                if (Array.isArray(profiles)) {
                    setRoster(
                        profiles
                            .filter((p: { role: string; app_type: string; status: string }) =>
                                p.role === 'agent' && p.app_type === 'insurance' && p.status !== 'disabled')
                            .map((p: { id: string; name: string }) => ({ id: p.id, name: p.name || 'Unnamed agent' })),
                    )
                }
            })
            .catch(() => {})
    }, [])

    const togglePaid = async (c: Case) => {
        const next = c.commission_status === 'paid' ? 'unpaid' : 'paid'
        setSavingId(c.id)
        try {
            const res = await fetch('/api/admin/update-case', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: c.id, updates: { commission_status: next } }),
            })
            if (!res.ok) throw new Error('Failed')
            await refreshCases()
        } catch { /* non-fatal */ } finally { setSavingId(null) }
    }

    if (loading) return <div className="max-w-[1200px] mx-auto flex flex-col gap-5"><Skeleton height={36} width={200} radius={8} /><Skeleton height={320} radius={14} /></div>
    if (error) return <div className="card p-4 flex items-center gap-2 text-red-600 text-sm"><AlertCircle size={16} />{error}</div>

    // Master view
    if (!agentParam) {
        return (
            <div className="space-y-5">
                <div>
                    <h1 className="text-2xl font-bold text-[#052d4a]">Insurance Earnings</h1>
                    <p className="text-sm text-slate-500 mt-1">Commission across all agents. Click an agent to review and confirm payouts.</p>
                </div>
                <MasterEarningsTable
                    rows={commissionByAgent(cases, roster)}
                    onOpen={id => router.push(`/admin/insurance/earnings?agent=${id}`)}
                />
            </div>
        )
    }

    // Per-agent drill-down
    const scoped = cases.filter(c => c.created_by === agentParam)
    const agentName = roster.find(a => a.id === agentParam)?.name ?? 'Agent'
    return (
        <AgentEarningsView
            cases={scoped}
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
