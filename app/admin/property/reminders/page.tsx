'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
    Bell, Clock, CheckCircle, AlertTriangle,
    Play, AlertCircle, ArrowRight, RefreshCw,
} from 'lucide-react'
import StatsCard from '@/components/shared/StatsCard'
import { formatDate } from '@/lib/utils/formatDate'

interface ReminderRow {
    id: string
    case_id: string
    reminder_type: string
    trigger_date: string
    is_sent: boolean
    sent_at: string | null
    created_at: string
    client_name: string
}

interface RunResult {
    ok: boolean
    processed: number
    caseStatusUpdated: number
    errors: string[]
    ranAt: string
}

function daysUntil(dateStr: string): number {
    const diff = new Date(dateStr).getTime() - Date.now()
    return Math.ceil(diff / 86400000)
}

export default function AdminRemindersPage() {
    const router = useRouter()
    const [reminders, setReminders] = useState<ReminderRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [running, setRunning] = useState(false)
    const [runResult, setRunResult] = useState<RunResult | null>(null)
    const [runError, setRunError] = useState<string | null>(null)

    function loadReminders() {
        setLoading(true)
        setError(null)
        fetch('/api/admin/property/reminders')
            .then(r => r.json())
            .then(json => setReminders(json.data ?? []))
            .catch(() => setError('Failed to load reminders.'))
            .finally(() => setLoading(false))
    }

    useEffect(() => { loadReminders() }, [])

    async function handleRunNow() {
        setRunning(true)
        setRunResult(null)
        setRunError(null)
        try {
            const res = await fetch('/api/admin/property/reminders/run', { method: 'POST' })
            const json = await res.json()
            if (!res.ok) { setRunError(json.error ?? 'Failed to run.'); return }
            setRunResult(json)
            loadReminders()
        } catch {
            setRunError('Unexpected error. Please try again.')
        } finally {
            setRunning(false)
        }
    }

    const today = new Date().toISOString().split('T')[0]
    const overdue = reminders.filter(r => !r.is_sent && r.trigger_date <= today)
    const upcoming = reminders.filter(r => !r.is_sent && r.trigger_date > today)
    const sent = reminders.filter(r => r.is_sent)

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-[#052d4a] flex items-center gap-2">
                        <Bell size={26} color="#8b5cf6" />
                        Property Reminders
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">90-day lock-in reminders. Due reminders flip the case status to Opportunity Due.</p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={loadReminders}
                        disabled={loading}
                        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                    <button
                        onClick={handleRunNow}
                        disabled={running}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
                        style={{ background: '#8b5cf6', color: 'white' }}
                    >
                        {running ? (
                            <>
                                <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white', animation: 'spin 0.8s linear infinite' }} />
                                Processing…
                            </>
                        ) : (
                            <>
                                <Play size={14} />
                                Process Now
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Run result banner */}
            {runResult && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm">
                    <CheckCircle size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-semibold text-emerald-800">
                            Processed {runResult.processed} reminder{runResult.processed !== 1 ? 's' : ''} —
                            {' '}{runResult.caseStatusUpdated} case{runResult.caseStatusUpdated !== 1 ? 's' : ''} set to Opportunity Due
                        </p>
                        {runResult.errors.length > 0 && (
                            <p className="text-xs text-amber-700 mt-1">{runResult.errors.length} error{runResult.errors.length !== 1 ? 's' : ''}: {runResult.errors[0]}</p>
                        )}
                        <p className="text-xs text-emerald-600 mt-0.5">Ran at {formatDate(runResult.ranAt)}</p>
                    </div>
                </div>
            )}

            {runError && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                    <AlertCircle size={15} />{runError}
                </div>
            )}

            {/* Stats */}
            {!loading && (
                <div className="grid grid-cols-3 gap-4">
                    <StatsCard
                        title="Ready to Process"
                        value={overdue.length}
                        icon={AlertTriangle}
                        color="#ea580c"
                        subtitle="trigger date reached"
                    />
                    <StatsCard
                        title="Upcoming"
                        value={upcoming.length}
                        icon={Clock}
                        color="#8b5cf6"
                        subtitle="scheduled"
                    />
                    <StatsCard
                        title="Processed"
                        value={sent.length}
                        icon={CheckCircle}
                        color="#16a34a"
                        subtitle="all time"
                    />
                </div>
            )}

            {loading && (
                <div className="card p-8 flex items-center justify-center gap-3 text-slate-500 text-sm">
                    <div style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid #8b5cf6', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                    Loading reminders…
                </div>
            )}

            {error && (
                <div className="card p-6 flex items-center gap-3 text-red-600 text-sm">
                    <AlertCircle size={18} />{error}
                </div>
            )}

            {!loading && !error && (
                <>
                    {/* Due / Overdue */}
                    {overdue.length > 0 && (
                        <div className="card overflow-hidden">
                            <div className="px-4 py-3 bg-orange-50 border-b border-orange-100 flex items-center gap-2">
                                <AlertTriangle size={15} color="#ea580c" />
                                <span className="text-sm font-semibold text-orange-700">Ready to Process</span>
                            </div>
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-100 bg-slate-50">
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Client</th>
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Trigger Date</th>
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Overdue By</th>
                                        <th className="px-4 py-2.5" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {overdue.map(r => {
                                        const days = daysUntil(r.trigger_date)
                                        return (
                                            <tr
                                                key={r.id}
                                                onClick={() => router.push(`/admin/property/cases/${r.case_id}`)}
                                                className="hover:bg-orange-50/40 cursor-pointer transition-colors"
                                            >
                                                <td className="px-4 py-3 font-medium text-slate-800">{r.client_name}</td>
                                                <td className="px-4 py-3 text-slate-600">{formatDate(r.trigger_date)}</td>
                                                <td className="px-4 py-3">
                                                    <span className="text-xs font-semibold px-2 py-1 rounded-full bg-orange-100 text-orange-700">
                                                        {days === 0 ? 'Today' : `${Math.abs(days)}d overdue`}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3"><ArrowRight size={14} className="text-slate-300" /></td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Upcoming */}
                    {upcoming.length > 0 && (
                        <div className="card overflow-hidden">
                            <div className="px-4 py-3 bg-purple-50 border-b border-purple-100 flex items-center gap-2">
                                <Clock size={15} color="#8b5cf6" />
                                <span className="text-sm font-semibold text-purple-700">Upcoming</span>
                            </div>
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-100 bg-slate-50">
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Client</th>
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Trigger Date</th>
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">In</th>
                                        <th className="px-4 py-2.5" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {upcoming.map(r => {
                                        const days = daysUntil(r.trigger_date)
                                        return (
                                            <tr
                                                key={r.id}
                                                onClick={() => router.push(`/admin/property/cases/${r.case_id}`)}
                                                className="hover:bg-purple-50/40 cursor-pointer transition-colors"
                                            >
                                                <td className="px-4 py-3 font-medium text-slate-800">{r.client_name}</td>
                                                <td className="px-4 py-3 text-slate-600">{formatDate(r.trigger_date)}</td>
                                                <td className="px-4 py-3 text-slate-500 text-xs">{days}d</td>
                                                <td className="px-4 py-3"><ArrowRight size={14} className="text-slate-300" /></td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Processed */}
                    {sent.length > 0 && (
                        <div className="card overflow-hidden">
                            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                                <CheckCircle size={15} color="#16a34a" />
                                <span className="text-sm font-semibold text-slate-600">Processed</span>
                            </div>
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-100 bg-slate-50">
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Client</th>
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Trigger Date</th>
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Sent At</th>
                                        <th className="px-4 py-2.5" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {sent.map(r => (
                                        <tr
                                            key={r.id}
                                            onClick={() => router.push(`/admin/property/cases/${r.case_id}`)}
                                            className="hover:bg-slate-50 cursor-pointer transition-colors"
                                        >
                                            <td className="px-4 py-3 font-medium text-slate-700">{r.client_name}</td>
                                            <td className="px-4 py-3 text-slate-500">{formatDate(r.trigger_date)}</td>
                                            <td className="px-4 py-3 text-slate-400 text-xs">{r.sent_at ? formatDate(r.sent_at) : '—'}</td>
                                            <td className="px-4 py-3"><ArrowRight size={14} className="text-slate-300" /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {overdue.length === 0 && upcoming.length === 0 && sent.length === 0 && (
                        <div className="card p-12 text-center">
                            <Bell size={32} className="mx-auto mb-3 text-slate-300" />
                            <p className="text-slate-500 text-sm">No reminders yet. They are created automatically when a case has a lock-in date.</p>
                        </div>
                    )}
                </>
            )}

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    )
}
