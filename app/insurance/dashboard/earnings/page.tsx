'use client'

import { useRouter } from 'next/navigation'
import { AlertCircle } from 'lucide-react'
import Skeleton from '@/components/shared/Skeleton'
import { useCases } from '@/lib/insurance/useCases'
import { AgentEarningsView } from '@/components/insurance/earnings/EarningsViews'

/**
 * Agent's own earnings (self-view). Admins manage team earnings + payouts from
 * the ops console at /admin/insurance/earnings.
 */
export default function InsuranceEarningsPage() {
    const router = useRouter()
    const { cases, loading, error } = useCases()

    if (loading) {
        return (
            <div className="max-w-[1200px] mx-auto flex flex-col gap-5">
                <Skeleton height={36} width={200} radius={8} />
                <Skeleton height={140} radius={14} />
                <Skeleton height={320} radius={14} />
            </div>
        )
    }
    if (error) {
        return (
            <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, color: '#dc2626', fontSize: 14 }}>
                <AlertCircle size={16} />{error}
            </div>
        )
    }

    return (
        <AgentEarningsView
            cases={cases}
            title="Earnings"
            subtitle="Your commission breakdown across all cases."
            onRowOpen={id => router.push(`/insurance/dashboard/cases/${id}`)}
        />
    )
}
