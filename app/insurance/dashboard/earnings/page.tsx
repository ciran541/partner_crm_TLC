'use client'

import { useRouter } from 'next/navigation'
import { AgentEarningsView } from '@/components/insurance/earnings/EarningsViews'

/**
 * Agent's own earnings (self-view). Admins manage team earnings + payouts from
 * the ops console at /admin/insurance/earnings.
 *
 * AgentEarningsView fetches its own totals and rows — scoped to the session, so
 * no agent id is needed here — and renders its own loading state. This page is
 * just routing now.
 */
export default function InsuranceEarningsPage() {
    const router = useRouter()

    return (
        <AgentEarningsView
            title="Earnings"
            subtitle="Your commission breakdown across all cases."
            onRowOpen={id => router.push(`/insurance/dashboard/cases/${id}`)}
        />
    )
}
