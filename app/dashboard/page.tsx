'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Case } from '@/lib/types'
import { Plus, Briefcase, TrendingUp, Clock, ChevronRight } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function DashboardHome() {
    const router = useRouter()
    const [stats, setStats] = useState({
        totalCases: 0,
        activeCases: 0,
        closedWon: 0
    })
    const [recentCases, setRecentCases] = useState<Case[]>([])
    const [loading, setLoading] = useState(true)
    const [user, setUser] = useState<any>(null)

    useEffect(() => {
        loadDashboardData()
    }, [])

    const loadDashboardData = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }
        setUser(user)

        // Fetch metrics
        const { data: cases } = await supabase
            .from('cases')
            .select('*')
            .eq('created_by', user.id)
            .order('updated_at', { ascending: false })

        if (cases) {
            setStats({
                totalCases: cases.length,
                activeCases: cases.filter(c => c.stage !== 'Closed Won' && c.stage !== 'Closed Lost').length,
                closedWon: cases.filter(c => c.stage === 'Closed Won').length
            })
            setRecentCases(cases.slice(0, 5)) // Top 5 recent
        }
        setLoading(false)
    }

    if (loading) return <div>Loading dashboard...</div>

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#052d4a' }}>Dashboard</h1>
                    <p style={{ color: '#64748b' }}>Welcome back, {user?.email?.split('@')[0]}</p>
                </div>
                <button
                    onClick={() => router.push('/dashboard/cases/new')}
                    className="btn-primary"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                    <Plus size={18} />
                    New Case
                </button>
            </div>

            {/* Stats Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '24px', marginBottom: '32px' }}>
                <StatsCard
                    title="Total Cases"
                    value={stats.totalCases}
                    icon={Briefcase}
                    color="#03a9e7"
                />
                <StatsCard
                    title="Active Pipeline"
                    value={stats.activeCases}
                    icon={Clock}
                    color="#f59e0b"
                />
                <StatsCard
                    title="Closed Won"
                    value={stats.closedWon}
                    icon={TrendingUp}
                    color="#10b981"
                />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '32px' }}>
                {/* Recent Cases Widget */}
                <div className="card" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: '#052d4a', margin: 0 }}>Recent Cases</h2>
                        <a href="/dashboard/cases" style={{ fontSize: '14px', color: '#03a9e7', textDecoration: 'none', fontWeight: '500' }}>View All</a>
                    </div>

                    {recentCases.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8' }}>
                            No recent activity.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {recentCases.map(c => (
                                <div key={c.id}
                                    onClick={() => router.push(`/dashboard/cases/${c.id}`)}
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '12px',
                                        borderRadius: '8px',
                                        background: '#f8fafc',
                                        cursor: 'pointer',
                                        transition: 'background 0.2s'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = '#f8fafc'}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <div style={{
                                            width: 40,
                                            height: 40,
                                            borderRadius: '50%',
                                            background: '#e0f2fe',
                                            color: '#0369a1',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontWeight: 'bold'
                                        }}>
                                            {c.client_name ? c.client_name[0].toUpperCase() : '?'}
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: '600', color: '#0f172a' }}>{c.client_name || 'Unnamed Client'}</div>
                                            <div style={{ fontSize: '12px', color: '#64748b' }}>{c.stage}</div>
                                        </div>
                                    </div>
                                    <ChevronRight size={16} color="#cbd5e1" />
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Quick Actions / Promo Widget */}
                <div className="card" style={{ padding: '24px', background: 'linear-gradient(135deg, #052d4a 0%, #0284c7 100%)', color: 'white' }}>
                    <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '12px' }}>Grow Your Business</h2>
                    <p style={{ opacity: 0.9, marginBottom: '24px', lineHeight: 1.5 }}>
                        Track your mortgage cases efficiently. Ensure you follow up with "Pending Signature" cases to close deals faster.
                    </p>
                    <button
                        onClick={() => router.push('/dashboard/cases')}
                        style={{
                            background: 'white',
                            color: '#052d4a',
                            padding: '10px 20px',
                            borderRadius: '6px',
                            border: 'none',
                            fontWeight: '600',
                            cursor: 'pointer'
                        }}
                    >
                        Go to Pipeline
                    </button>
                </div>
            </div>
        </div>
    )
}

function StatsCard({ title, value, icon: Icon, color }: { title: string, value: number, icon: any, color: string }) {
    return (
        <div className="card" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{
                width: 56,
                height: 56,
                borderRadius: '12px',
                background: `${color}15`, // 15% opacity hex
                color: color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                <Icon size={28} />
            </div>
            <div>
                <div style={{ fontSize: '14px', color: '#64748b', fontWeight: '500' }}>{title}</div>
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#0f172a', lineHeight: 1.2 }}>{value}</div>
            </div>
        </div>
    )
}
