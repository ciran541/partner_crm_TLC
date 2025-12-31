'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Case, PipelineStage } from '@/lib/types'
import { useRouter } from 'next/navigation'
import { BarChart3, PieChart, DollarSign, Briefcase } from 'lucide-react'

export default function AnalyticsPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [stats, setStats] = useState<{
        totalCases: number
        totalVolume: number
        won: number
        lost: number
        stageCounts: Record<string, number>
    }>({
        totalCases: 0,
        totalVolume: 0,
        won: 0,
        lost: 0,
        stageCounts: {}
    })

    const pipelineStages: PipelineStage[] = [
        'Touched Base',
        'Proposal Given',
        'Referred to Bank',
        'Pending Approval',
        'Pending Signature',
        'Closed Won',
        'Closed Lost'
    ]

    useEffect(() => {
        loadData()
    }, [])

    const loadData = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        // Check admin role
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()

        if (profile?.role !== 'admin') {
            router.push('/dashboard') // kick non-admins
            return
        }

        // Fetch all cases
        // Assuming Admin RLS allows seeing all rows, or use the admin API pattern if needed.
        // User requested "Fetch cases via Supabase", implying standard SDK.
        // If RLS blocks, we might need the API, but user said "Use existing cases data".
        // Let's try standard fetch first as dashboard works fine for total stats.
        const { data: cases, error } = await supabase
            .from('cases')
            .select('stage, loan_size, existing_loan_amount')

        if (cases) {
            const newStats = {
                totalCases: cases.length,
                totalVolume: 0,
                won: 0,
                lost: 0,
                stageCounts: {} as Record<string, number>
            }

            // Initialize counts
            pipelineStages.forEach(s => newStats.stageCounts[s] = 0)

            cases.forEach((c: any) => {
                // Volume
                if (c.loan_size) newStats.totalVolume += c.loan_size
                if (c.existing_loan_amount) newStats.totalVolume += c.existing_loan_amount

                // Won/Lost
                if (c.stage === 'Closed Won') newStats.won++
                if (c.stage === 'Closed Lost') newStats.lost++

                // Stage breakdown
                const s = c.stage as string
                if (newStats.stageCounts[s] !== undefined) {
                    newStats.stageCounts[s]++
                }
            })

            setStats(newStats)
        }
        setLoading(false)
    }

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 0
        }).format(val)
    }

    if (loading) return <div style={{ padding: 20 }}>Loading analytics...</div>

    const maxStageCount = Math.max(...Object.values(stats.stageCounts), 1)

    return (
        <div>
            {/* Header */}
            <div style={{ marginBottom: '32px' }}>
                <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#052d4a', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <BarChart3 size={28} color="#03a9e7" />
                    Analytics Overview
                </h1>
                <p style={{ color: '#64748b' }}>Pipeline performance and volume metrics.</p>
            </div>

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '24px', marginBottom: '32px' }}>
                <AnalyticsCard
                    title="Total Cases"
                    value={stats.totalCases}
                    icon={Briefcase}
                    color="#03a9e7"
                />
                <AnalyticsCard
                    title="Total Volume"
                    value={formatCurrency(stats.totalVolume)}
                    icon={DollarSign}
                    color="#10b981"
                />
                <AnalyticsCard
                    title="Win Rate"
                    value={`${stats.totalCases > 0 ? Math.round((stats.won / stats.totalCases) * 100) : 0}%`}
                    icon={PieChart}
                    color="#8b5cf6"
                    subtitle={`Won: ${stats.won} / Lost: ${stats.lost}`}
                />
            </div>

            {/* Pipeline Stage Chart (Simple CSS Bar Chart) */}
            <div className="card" style={{ padding: '24px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#052d4a', marginBottom: '24px' }}>Pipeline Breakdown</h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {pipelineStages.map(stage => {
                        const count = stats.stageCounts[stage] || 0
                        const percentage = Math.round((count / maxStageCount) * 100)

                        return (
                            <div key={stage} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 40px', alignItems: 'center', gap: '16px' }}>
                                <div style={{ fontSize: '13px', color: '#64748b', fontWeight: '500' }}>{stage}</div>
                                <div style={{ height: '24px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                                    <div style={{
                                        position: 'absolute',
                                        left: 0, top: 0, bottom: 0,
                                        width: `${percentage}%`,
                                        background: stage === 'Closed Won' ? '#10b981' : stage === 'Closed Lost' ? '#ef4444' : '#03a9e7',
                                        borderRadius: '4px',
                                        transition: 'width 0.5s ease-out'
                                    }} />
                                </div>
                                <div style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a', textAlign: 'right' }}>{count}</div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

function AnalyticsCard({ title, value, icon: Icon, color, subtitle }: { title: string, value: string | number, icon: any, color: string, subtitle?: string }) {
    return (
        <div className="card" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{
                width: 56,
                height: 56,
                borderRadius: '12px',
                background: `${color}15`,
                color: color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                <Icon size={28} />
            </div>
            <div>
                <div style={{ fontSize: '14px', color: '#64748b', fontWeight: '500' }}>{title}</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#0f172a', lineHeight: 1.2 }}>{value}</div>
                {subtitle && <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>{subtitle}</div>}
            </div>
        </div>
    )
}
