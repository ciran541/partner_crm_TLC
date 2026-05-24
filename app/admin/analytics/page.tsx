'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { PipelineStage } from '@/lib/types/insurance'
import { useRouter } from 'next/navigation'
import { BarChart3, DollarSign, Briefcase } from 'lucide-react'
import StatsCard from '@/components/shared/StatsCard'
import Spinner from '@/components/shared/Spinner'

export default function AdminAnalyticsPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [stats, setStats] = useState<{
        totalCases: number
        totalVolume: number
        won: number
        lost: number
        stageCounts: Record<string, number>
    }>({ totalCases: 0, totalVolume: 0, won: 0, lost: 0, stageCounts: {} })

    const pipelineStages: PipelineStage[] = [
        'Touched Base', 'Proposal Given', 'Referred to Bank',
        'Pending Approval', 'Pending Signature', 'Closed Won', 'Closed Lost',
    ]

    useEffect(() => { loadData() }, [])

    const loadData = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push('/login'); return }

        const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
        if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
            router.push('/admin')
            return
        }

        const { data: cases } = await supabase
            .from('cases')
            .select('stage, loan_size, existing_loan_amount')

        if (cases) {
            const newStats = { totalCases: cases.length, totalVolume: 0, won: 0, lost: 0, stageCounts: {} as Record<string, number> }
            pipelineStages.forEach((s) => (newStats.stageCounts[s] = 0))

            cases.forEach((c: any) => {
                if (c.loan_size) newStats.totalVolume += c.loan_size
                if (c.existing_loan_amount) newStats.totalVolume += c.existing_loan_amount
                if (c.stage === 'Closed Won') newStats.won++
                if (c.stage === 'Closed Lost') newStats.lost++
                if (newStats.stageCounts[c.stage] !== undefined) newStats.stageCounts[c.stage]++
            })

            setStats(newStats)
        }
        setLoading(false)
    }

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)

    const winRate = stats.totalCases > 0 ? Math.round((stats.won / stats.totalCases) * 100) : 0

    const WinRateIcon = useCallback(() => (
        <div style={{
            width: 24, height: 24, borderRadius: '50%',
            background: `conic-gradient(#059669 ${winRate * 3.6}deg, #e2e8f0 0deg)`,
        }} />
    ), [winRate])

    const maxStageCount = Math.max(...Object.values(stats.stageCounts), 1)

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
            <Spinner size="md" color="#03a9e7" label="Loading analytics…" />
        </div>
    )

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-2xl font-bold text-[#052d4a] flex items-center gap-2">
                    <BarChart3 size={28} color="#03a9e7" />
                    Analytics Overview
                </h1>
                <p className="text-slate-500">Insurance pipeline performance and volume metrics.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <StatsCard title="Total Cases" value={stats.totalCases} icon={Briefcase} color="#03a9e7" />
                <StatsCard title="Total Volume" value={formatCurrency(stats.totalVolume)} icon={DollarSign} color="#10b981" />
                <StatsCard
                    title="Win Rate"
                    value={`${winRate}%`}
                    icon={WinRateIcon}
                    color="#8b5cf6"
                    subtitle={`Won: ${stats.won} / Lost: ${stats.lost}`}
                />
            </div>

            <div className="card" style={{ padding: '24px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#052d4a', marginBottom: '24px' }}>
                    Pipeline Breakdown
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {pipelineStages.map((stage) => {
                        const count = stats.stageCounts[stage] || 0
                        const percentage = Math.round((count / maxStageCount) * 100)
                        const barColor = stage === 'Closed Won' ? '#10b981' : stage === 'Closed Lost' ? '#ef4444' : '#03a9e7'
                        return (
                            <div key={stage} style={{ display: 'grid', gridTemplateColumns: '160px 1fr', alignItems: 'center', gap: '16px' }}>
                                <div style={{ fontSize: '13px', color: '#64748b', fontWeight: '500' }}>{stage}</div>
                                <div style={{ height: '26px', background: '#f1f5f9', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
                                    <div style={{
                                        position: 'absolute', left: 0, top: 0, bottom: 0,
                                        width: `${percentage}%`,
                                        minWidth: count > 0 ? 32 : 0,
                                        background: barColor,
                                        borderRadius: '0 6px 6px 0',
                                        transition: 'width 0.5s ease-out',
                                        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                                        paddingRight: 8,
                                    }}>
                                        {count > 0 && (
                                            <span style={{ fontSize: 11, fontWeight: 700, color: 'white' }}>{count}</span>
                                        )}
                                    </div>
                                    {count === 0 && (
                                        <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#cbd5e1', fontWeight: 600 }}>0</span>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
