'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
    Bell, Clock, Activity, DollarSign, BadgeCheck,
    Info, AlertCircle, ArrowRight, RefreshCw,
} from 'lucide-react'
import { formatDate } from '@/lib/utils/formatDate'
import type { NotificationItem, NotificationType } from '@/app/api/property/notifications/route'

const TYPE_CONFIG: Record<NotificationType, {
    icon: React.ElementType
    color: string
    bg: string
    label: string
}> = {
    reminder: { icon: Clock, color: '#ea580c', bg: '#fff7ed', label: 'Reminder' },
    status_changed: { icon: Activity, color: '#3b82f6', bg: '#eff6ff', label: 'Status Update' },
    commission_updated: { icon: DollarSign, color: '#059669', bg: '#ecfdf5', label: 'Commission' },
    lockin_confirmed: { icon: BadgeCheck, color: '#059669', bg: '#ecfdf5', label: 'Lock-in' },
    admin_update: { icon: Info, color: '#64748b', bg: '#f8fafc', label: 'Update' },
}

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (days > 30) return formatDate(dateStr)
    if (days >= 1) return `${days}d ago`
    if (hours >= 1) return `${hours}h ago`
    if (mins >= 1) return `${mins}m ago`
    return 'Just now'
}

export default function PropertyNotificationsPage() {
    const router = useRouter()
    const [notifications, setNotifications] = useState<NotificationItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    function load() {
        setLoading(true)
        setError(null)
        fetch('/api/property/notifications')
            .then(r => r.json())
            .then(json => setNotifications(json.notifications ?? []))
            .catch(() => setError('Failed to load notifications. Please refresh.'))
            .finally(() => setLoading(false))
    }

    useEffect(() => { load() }, [])

    const unreadCount = notifications.length

    return (
        <div className="space-y-6 max-w-2xl">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-[#052d4a] flex items-center gap-2">
                        <Bell size={26} color="#059669" />
                        Notifications
                        {!loading && unreadCount > 0 && (
                            <span className="ml-1 text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500 text-white">
                                {unreadCount}
                            </span>
                        )}
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">Lock-in reminders, commission updates, and case alerts.</p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            </div>

            {loading && (
                <div className="card p-8 flex items-center justify-center gap-3 text-slate-500 text-sm">
                    <div style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid #059669', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                    Loading notifications…
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
            )}

            {error && (
                <div className="card p-6 flex items-center gap-3 text-red-600 text-sm">
                    <AlertCircle size={18} />{error}
                </div>
            )}

            {!loading && !error && notifications.length === 0 && (
                <div className="card p-12 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                        <Bell size={32} color="#059669" />
                    </div>
                    <p className="text-slate-700 font-semibold mb-1">All caught up</p>
                    <p className="text-sm text-slate-400 max-w-xs mx-auto">
                        Notifications from TLC — commission updates, status changes, and lock-in reminders — will appear here.
                    </p>
                </div>
            )}

            {!loading && !error && notifications.length > 0 && (
                <div className="card divide-y divide-slate-100 overflow-hidden">
                    {notifications.map((n, i) => {
                        const cfg = TYPE_CONFIG[n.type]
                        const Icon = cfg.icon
                        return (
                            <button
                                key={`${n.id}-${i}`}
                                onClick={() => router.push(`/property/cases/${n.case_id}`)}
                                className="w-full flex items-start gap-4 px-4 py-4 hover:bg-slate-50 transition-colors text-left"
                            >
                                {/* Icon */}
                                <div
                                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                                    style={{ background: cfg.bg }}
                                >
                                    <Icon size={16} color={cfg.color} />
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <span
                                            className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                            style={{ color: cfg.color, background: cfg.bg }}
                                        >
                                            {cfg.label}
                                        </span>
                                    </div>
                                    <p className="text-sm font-semibold text-slate-800">{n.title}</p>
                                    <p className="text-xs text-slate-500 mt-0.5">{n.body}</p>
                                </div>

                                {/* Date + arrow */}
                                <div className="flex flex-col items-end gap-1 shrink-0">
                                    <p className="text-xs text-slate-400 whitespace-nowrap">{timeAgo(n.date)}</p>
                                    <ArrowRight size={13} className="text-slate-300" />
                                </div>
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
