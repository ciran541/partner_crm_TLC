'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
    Bell, Clock, CheckCircle, AlertTriangle,
    AlertCircle, ArrowRight, RefreshCw, User
} from 'lucide-react'
import StatsCard from '@/components/shared/StatsCard'
import { formatDate } from '@/lib/utils/formatDate'

interface FollowUpRow {
    id: string
    client_name: string
    client_mobile: string
    follow_up_date: string
    followup_preference: 'self' | 'tlc' | null
    followup_completed_at: string | null
    agent_id: string
    agent_name: string
    lock_in_period: number | null
    projected_agent_income: number | null
}

function daysUntil(dateStr: string): number {
    const diff = new Date(dateStr).getTime() - new Date().setHours(0, 0, 0, 0)
    return Math.ceil(diff / 86400000)
}

function PreferenceBadge({ pref }: { pref: 'self' | 'tlc' | null }) {
    if (pref === 'self') return (
        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: '#059669', background: '#ecfdf5', border: '1px solid #bbf7d0' }}>Agent</span>
    )
    if (pref === 'tlc') return (
        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: '#0284c7', background: '#e0f2fe', border: '1px solid #bae6fd' }}>TLC</span>
    )
    return <span className="text-slate-300 text-xs">—</span>
}

export default function AdminRemindersPage() {
    const router = useRouter()
    const [rows, setRows] = useState<FollowUpRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    function loadData() {
        setLoading(true)
        setError(null)
        fetch('/api/admin/property/reminders')
            .then(r => r.json())
            .then(json => setRows(json.data ?? []))
            .catch(() => setError('Failed to load follow-ups.'))
            .finally(() => setLoading(false))
    }

    useEffect(() => { loadData() }, [])

    const today = new Date().toISOString().split('T')[0]
    const overdue  = rows.filter(r => !r.followup_completed_at && r.follow_up_date < today)
    const dueToday = rows.filter(r => !r.followup_completed_at && r.follow_up_date === today)
    const upcoming = rows.filter(r => !r.followup_completed_at && r.follow_up_date > today)
    const completed = rows.filter(r => !!r.followup_completed_at)

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-[#052d4a] flex items-center gap-2">
                        <Bell size={26} color="#8b5cf6" />
                        Follow-Up Schedule
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">All agent follow-up dates across every case.</p>
                </div>
                <button
                    onClick={loadData}
                    disabled={loading}
                    className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            </div>

            {!loading && (
                <div className="grid grid-cols-4 gap-4">
                    <StatsCard title="Overdue"    value={overdue.length}   icon={AlertTriangle} color="#dc2626" subtitle="past follow-up date" />
                    <StatsCard title="Due Today"  value={dueToday.length}  icon={Bell}          color="#ea580c" subtitle="follow up today" />
                    <StatsCard title="Upcoming"   value={upcoming.length}  icon={Clock}         color="#8b5cf6" subtitle="scheduled ahead" />
                    <StatsCard title="Completed"  value={completed.length} icon={CheckCircle}   color="#16a34a" subtitle="all time" />
                </div>
            )}

            {loading && (
                <div className="card p-8 flex items-center justify-center gap-3 text-slate-500 text-sm">
                    <div style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid #8b5cf6', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                    Loading follow-ups…
                </div>
            )}

            {error && (
                <div className="card p-6 flex items-center gap-3 text-red-600 text-sm">
                    <AlertCircle size={18} />{error}
                </div>
            )}

            {!loading && !error && (
                <>
                    {/* Overdue */}
                    {overdue.length > 0 && (
                        <Section
                            title="Overdue"
                            headerColor={{ bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' }}
                            icon={<AlertTriangle size={15} color="#dc2626" />}
                            rows={overdue}
                            today={today}
                            router={router}
                        />
                    )}

                    {/* Due Today */}
                    {dueToday.length > 0 && (
                        <Section
                            title="Due Today"
                            headerColor={{ bg: '#fff7ed', border: '#fed7aa', text: '#c2410c' }}
                            icon={<Bell size={15} color="#ea580c" />}
                            rows={dueToday}
                            today={today}
                            router={router}
                        />
                    )}

                    {/* Upcoming */}
                    {upcoming.length > 0 && (
                        <Section
                            title="Upcoming"
                            headerColor={{ bg: '#f5f3ff', border: '#ddd6fe', text: '#6d28d9' }}
                            icon={<Clock size={15} color="#8b5cf6" />}
                            rows={upcoming}
                            today={today}
                            router={router}
                        />
                    )}

                    {/* Completed */}
                    {completed.length > 0 && (
                        <Section
                            title="Completed"
                            headerColor={{ bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d' }}
                            icon={<CheckCircle size={15} color="#16a34a" />}
                            rows={completed}
                            today={today}
                            router={router}
                            showCompletedAt
                        />
                    )}

                    {rows.length === 0 && (
                        <div className="card p-12 text-center">
                            <Bell size={32} className="mx-auto mb-3 text-slate-300" />
                            <p className="text-slate-500 text-sm">No follow-up dates set yet. They are calculated automatically when a case is submitted with a Letter of Offer date and lock-in period.</p>
                        </div>
                    )}
                </>
            )}

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    )
}

function Section({
    title,
    headerColor,
    icon,
    rows,
    today,
    router,
    showCompletedAt = false,
}: {
    title: string
    headerColor: { bg: string; border: string; text: string }
    icon: React.ReactNode
    rows: FollowUpRow[]
    today: string
    router: ReturnType<typeof useRouter>
    showCompletedAt?: boolean
}) {
    return (
        <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center gap-2" style={{ background: headerColor.bg, borderColor: headerColor.border }}>
                {icon}
                <span className="text-sm font-semibold" style={{ color: headerColor.text }}>{title}</span>
                <span className="ml-auto text-xs font-medium" style={{ color: headerColor.text }}>{rows.length}</span>
            </div>
            <div className="table-scroll">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Client</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Agent</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Follow-Up Date</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Owner</th>
                        {showCompletedAt && <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Completed</th>}
                        {!showCompletedAt && <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Days</th>}
                        <th className="px-4 py-2.5" />
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                    {rows.map(r => {
                        const days = daysUntil(r.follow_up_date)
                        return (
                            <tr
                                key={r.id}
                                onClick={() => router.push(`/admin/property/cases/${r.id}`)}
                                className="hover:bg-slate-50 cursor-pointer transition-colors"
                            >
                                <td className="px-4 py-3">
                                    <p className="font-medium text-slate-800">{r.client_name}</p>
                                    <p className="text-xs text-slate-400">{r.client_mobile}</p>
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-1.5 text-slate-600">
                                        <User size={12} className="text-slate-400" />
                                        {r.agent_name}
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-slate-600">{formatDate(r.follow_up_date)}</td>
                                <td className="px-4 py-3"><PreferenceBadge pref={r.followup_preference} /></td>
                                {showCompletedAt && (
                                    <td className="px-4 py-3 text-slate-400 text-xs">
                                        {r.followup_completed_at ? formatDate(r.followup_completed_at) : '—'}
                                    </td>
                                )}
                                {!showCompletedAt && (
                                    <td className="px-4 py-3">
                                        {days === 0 ? (
                                            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-orange-100 text-orange-700">Today</span>
                                        ) : days < 0 ? (
                                            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-red-100 text-red-700">{Math.abs(days)}d overdue</span>
                                        ) : (
                                            <span className="text-xs text-slate-500">in {days}d</span>
                                        )}
                                    </td>
                                )}
                                <td className="px-4 py-3"><ArrowRight size={14} className="text-slate-300" /></td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
            </div>
        </div>
    )
}
