'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import { Users, Briefcase, BarChart3, Shield, ArrowRight } from 'lucide-react'
import StatsCard from '@/components/shared/StatsCard'
import Spinner from '@/components/shared/Spinner'
import Link from 'next/link'

export default function AdminHomePage() {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [stats, setStats] = useState({
        totalUsers: 0,
        insuranceAgents: 0,
        propertyAgents: 0,
        totalCases: 0,
    })

    useEffect(() => {
        loadStats()
    }, [])

    const loadStats = async () => {
        const {
            data: { user },
        } = await supabase.auth.getUser()
        if (!user) { router.push('/login'); return }

        // Fetch user counts from profiles
        const { data: profiles } = await supabase.from('profiles').select('role, app_type')

        // Fetch insurance case count
        const { count: caseCount } = await supabase
            .from('cases')
            .select('*', { count: 'exact', head: true })

        if (profiles) {
            setStats({
                totalUsers: profiles.length,
                insuranceAgents: profiles.filter((p: any) => p.app_type === 'insurance' || !p.app_type).length,
                propertyAgents: profiles.filter((p: any) => p.app_type === 'property').length,
                totalCases: caseCount ?? 0,
            })
        }

        setLoading(false)
    }

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
            <Spinner size="md" color="#8b5cf6" label="Loading admin panel…" />
        </div>
    )

    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <div className="flex items-center gap-3 mb-1">
                    <Shield size={28} color="#8b5cf6" />
                    <h1 className="text-2xl font-bold text-[#052d4a]">Admin Panel</h1>
                </div>
                <p className="text-slate-500">Platform overview across all plans.</p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                <StatsCard title="Total Users" value={stats.totalUsers} icon={Users} color="#8b5cf6" />
                <StatsCard title="Premium Agents" value={stats.insuranceAgents} icon={Briefcase} color="#03a9e7" />
                <StatsCard title="Basic & Starter Agents" value={stats.propertyAgents} icon={Users} color="#10b981" />
                <StatsCard title="Premium Cases" value={stats.totalCases} icon={BarChart3} color="#f59e0b" />
            </div>

            {/* Quick Navigation */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Link
                    href="/admin/users"
                    className="card p-6 flex items-center justify-between group hover:shadow-md transition-shadow no-underline"
                    style={{ borderLeft: '4px solid #8b5cf6' }}
                >
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <Users size={20} color="#8b5cf6" />
                            <h2 className="text-lg font-bold text-[#052d4a]">User Management</h2>
                        </div>
                        <p className="text-sm text-slate-500 mb-1">Manage all agents and administrators across all domains.</p>
                        <p className="text-xs font-semibold text-purple-600">{stats.totalUsers} total users</p>
                    </div>
                    <ArrowRight size={20} className="text-slate-300 group-hover:text-[#8b5cf6] transition-colors shrink-0 ml-4" />
                </Link>

                <Link
                    href="/admin/insurance/analytics"
                    className="card p-6 flex items-center justify-between group hover:shadow-md transition-shadow no-underline"
                    style={{ borderLeft: '4px solid #03a9e7' }}
                >
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <BarChart3 size={20} color="#03a9e7" />
                            <h2 className="text-lg font-bold text-[#052d4a]">Analytics</h2>
                        </div>
                        <p className="text-sm text-slate-500 mb-1">Premium pipeline performance and volume metrics.</p>
                        <p className="text-xs font-semibold text-[#03a9e7]">{stats.totalCases} cases tracked</p>
                    </div>
                    <ArrowRight size={20} className="text-slate-300 group-hover:text-[#03a9e7] transition-colors shrink-0 ml-4" />
                </Link>
            </div>

            {/* Domain Status */}
            <div className="card p-6">
                <h2 className="text-lg font-bold text-[#052d4a] mb-4">Domain Status</h2>
                <div className="space-y-3">
                    <DomainRow label="Premium App" href="/insurance/dashboard" status="Live" statusColor="#10b981" />
                    <DomainRow label="Basic & Starter App" href="/property/dashboard" status="Live" statusColor="#10b981" />
                    <DomainRow label="Admin Panel" href="/admin" status="Live" statusColor="#10b981" />
                </div>
            </div>
        </div>
    )
}

function DomainRow({ label, href, status, statusColor }: { label: string; href: string; status: string; statusColor: string }) {
    return (
        <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
            <span className="font-medium text-slate-700">{label}</span>
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: statusColor }} />
                        <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: statusColor }} />
                    </span>
                    <span className="text-xs font-semibold" style={{ color: statusColor }}>{status}</span>
                </div>
                <a href={href} className="text-xs text-[#03a9e7] hover:underline">Visit →</a>
            </div>
        </div>
    )
}
