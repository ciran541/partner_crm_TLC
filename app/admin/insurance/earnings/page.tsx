'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Skeleton from '@/components/shared/Skeleton'
import { invalidateCaseData } from '@/lib/insurance/caseCache'
import { AgentEarningsView } from '@/components/insurance/earnings/EarningsViews'
import RecordPayoutModal from '@/components/insurance/earnings/RecordPayoutModal'
import { commissionWithFee } from '@/lib/insurance/commission'
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

    useEffect(() => { if (!agentParam) router.replace('/admin/payouts') }, [agentParam, router])

    const [rows, setRows] = useState<AgentCommissionRow[] | null>(null)
    // Case whose payout ledger is open (record / reverse payouts).
    const [payoutCase, setPayoutCase] = useState<CaseListRow | null>(null)

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
        fetch('/api/admin/insurance/earnings/by-agent')
            .then(r => (r.ok ? r.json() : Promise.reject(new Error(`Request failed (${r.status})`))))
            .then(body => { if (active) setRows((body.rows ?? []) as AgentCommissionRow[]) })
            .catch(() => { /* only the agent's name comes from here */ })
        return () => { active = false }
    }, [agentParam, reload])

    // After a payout is recorded/reversed: refresh the paged rows and summary
    // totals behind the drill-down; the counter re-fetches the master table.
    const afterPayout = () => {
        invalidateCaseData()
        setReload(n => n + 1)
    }

    // Per-agent drill-down. The view scopes itself by agent id.
    if (agentParam) {
        const agentName = rows?.find(r => r.agentId === agentParam)?.agentName ?? 'Agent'
        return (
            <>
                <AgentEarningsView
                    agentId={agentParam}
                    title={agentName}
                    subtitle={`${agentName}'s commission breakdown`}
                    isAdmin
                    onRecordPayout={setPayoutCase}
                    onRowOpen={id => router.push(`/admin/insurance/cases/${id}`)}
                    onBack={() => router.push('/admin/payouts')}
                />
                {payoutCase && (
                    <RecordPayoutModal
                        caseId={payoutCase.id}
                        clientName={payoutCase.client_name || 'Case'}
                        owed={commissionWithFee(payoutCase.loan_value ?? 0, payoutCase.correction_fee).agent}
                        onClose={() => setPayoutCase(null)}
                        onSaved={afterPayout}
                    />
                )}
            </>
        )
    }

    // The all-agents view is Payouts → By agent.
    return null
}
