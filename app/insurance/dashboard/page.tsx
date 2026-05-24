'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Case } from '@/lib/types'
import { Plus, Briefcase, TrendingUp, Clock, ChevronRight, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function DashboardHome() {
    const router = useRouter()
    const [stats, setStats] = useState({
        totalCases: 0,
        activeCases: 0,
        closedWon: 0,
        upcomingLockIns: 0
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
            .order('updated_at', { ascending: false })

        if (cases) {
            const now = new Date()
            const ninetyDaysFromNow = new Date()
            ninetyDaysFromNow.setDate(now.getDate() + 90)

            const lockIns = cases.filter(c => {
                if (!c.lock_in_end_date || c.stage === 'Closed Lost') return false
                const d = new Date(c.lock_in_end_date)
                return d >= now && d <= ninetyDaysFromNow
            })

            setStats({
                totalCases: cases.length,
                activeCases: cases.filter(c => c.stage !== 'Closed Won' && c.stage !== 'Closed Lost').length,
                closedWon: cases.filter(c => c.stage === 'Closed Won').length,
                upcomingLockIns: lockIns.length
            })
            setRecentCases(cases.slice(0, 5)) // Top 5 recent
        }
        setLoading(false)
    }

    if (loading) return <div>Loading dashboard...</div>

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[#052d4a]">Dashboard</h1>
                    <p className="text-slate-500">Welcome back, {user?.email?.split('@')[0]}</p>
                </div>
                <button
                    onClick={() => router.push('/insurance/dashboard/cases/new')}
                    className="btn-primary flex items-center justify-center gap-2 w-full sm:w-auto"
                >
                    <Plus size={18} />
                    <span>New Case</span>
                </button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
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
                <div onClick={() => router.push('/insurance/dashboard/cases/lock-in-end')} className="cursor-pointer">
                    <StatsCard
                        title="Upcoming Lock-ins"
                        value={stats.upcomingLockIns}
                        icon={AlertTriangle}
                        color="#ef4444"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Recent Cases Widget */}
                <div className="card p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-lg font-bold text-[#052d4a]">Recent Cases</h2>
                        <a href="/insurance/dashboard/cases" className="text-sm font-medium text-[#03a9e7] hover:underline">View All</a>
                    </div>

                    {recentCases.length === 0 ? (
                        <div className="text-center py-8 text-slate-400">
                            No recent activity.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {recentCases.map(c => (
                                <div key={c.id}
                                    onClick={() => router.push(`/insurance/dashboard/cases/${c.id}`)}
                                    className="flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors group"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-10 h-10 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-bold shrink-0">
                                            {c.client_name ? c.client_name[0].toUpperCase() : '?'}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-semibold text-slate-900 truncate">{c.client_name || 'Unnamed Client'}</div>
                                            <div className="text-xs text-slate-500">{c.stage}</div>
                                        </div>
                                    </div>
                                    <ChevronRight size={16} className="text-slate-300 group-hover:text-slate-400 transition-colors" />
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
                        onClick={() => router.push('/insurance/dashboard/cases')}
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
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#0f172a', lineHeight: 1.2 }}>{value}</div>
            </div>
        </div>
    )
}
