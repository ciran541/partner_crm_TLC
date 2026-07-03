'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, AlertTriangle, CalendarDays, TrendingUp, AlertCircle } from 'lucide-react'
import StatsCard from '@/components/shared/StatsCard'
import { formatDate } from '@/lib/utils/formatDate'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { calculateCommission } from '@/lib/property/commission'
import { useCases } from '@/lib/insurance/useCases'
import { isDraftCase } from '@/lib/insurance/caseFilters'
import type { Case } from '@/lib/types'

type CaseRow = Case & { profiles?: { id: string; name: string } | null }

function daysUntil(dateStr: string): number {
    const diff = new Date(dateStr).getTime() - new Date().setHours(0, 0, 0, 0)
    return Math.ceil(diff / 86400000)
}

export default function AdminInsuranceFollowUpsPage() {
    const router = useRouter()
    const { cases, loading, error } = useCases()

    const { overdue, upcoming } = useMemo(() => {
        const today = new Date().toISOString().slice(0, 10)
        const withFu = (cases as CaseRow[]).filter(c => !isDraftCase(c) && c.follow_up_date)
        return {
            overdue: withFu.filter(c => c.follow_up_date! <= today).sort((a, b) => b.follow_up_date!.localeCompare(a.follow_up_date!)),
            upcoming: withFu.filter(c => c.follow_up_date! > today).sort((a, b) => a.follow_up_date!.localeCompare(b.follow_up_date!)),
        }
    }, [cases])

    if (loading) return <div className="card p-8 flex items-center justify-center text-slate-500 text-sm">Loading follow-ups…</div>
    if (error) return <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm"><AlertCircle size={15} />{error}</div>

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-[#052d4a] flex items-center gap-2"><Clock size={26} color="#8b5cf6" /> Insurance Follow-ups</h1>
                <p className="text-sm text-slate-500 mt-1">Every agent&apos;s upcoming and overdue follow-ups in one place.</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <StatsCard title="Total" value={overdue.length + upcoming.length} icon={CalendarDays} color="#8b5cf6" />
                <StatsCard title="Overdue" value={overdue.length} icon={AlertTriangle} color="#dc2626" variant="alert" />
                <StatsCard title="Upcoming" value={upcoming.length} icon={Clock} color="#f59e0b" />
            </div>

            {overdue.length === 0 && upcoming.length === 0 ? (
                <div className="card p-12 text-center">
                    <Clock size={32} className="mx-auto mb-3 text-slate-300" />
                    <p className="text-slate-500 text-sm">No follow-ups scheduled across any agent.</p>
                </div>
            ) : (
                <>
                    {overdue.length > 0 && <FollowUpTable title="Overdue" accent="#dc2626" rows={overdue} onOpen={id => router.push(`/admin/insurance/cases/${id}`)} />}
                    {upcoming.length > 0 && <FollowUpTable title="Upcoming" accent="#0369a1" rows={upcoming} onOpen={id => router.push(`/admin/insurance/cases/${id}`)} />}
                </>
            )}
        </div>
    )
}

function FollowUpTable({ title, accent, rows, onOpen }: { title: string; accent: string; rows: CaseRow[]; onOpen: (id: string) => void }) {
    return (
        <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: accent }} />
                <span className="text-sm font-semibold text-slate-700">{title} ({rows.length})</span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Agent</th>
                            <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Client</th>
                            <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                            <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Stage</th>
                            <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Follow-up</th>
                            <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Next-cycle income</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {rows.map(c => {
                            const dleft = daysUntil(c.follow_up_date!)
                            const proj = c.closed_won_data?.combined_outstanding
                            return (
                                <tr key={c.id} onClick={() => onOpen(c.id)} className="hover:bg-purple-50/30 cursor-pointer transition-colors">
                                    <td className="px-4 py-3 text-slate-600 font-medium">{c.profiles?.name ?? '—'}</td>
                                    <td className="px-4 py-3">
                                        <p className="font-medium text-slate-800">{c.client_name || 'Unnamed'}</p>
                                        {c.client_mobile && <p className="text-xs text-slate-400 mt-0.5">{c.client_mobile}</p>}
                                    </td>
                                    <td className="px-4 py-3 text-slate-600">{c.case_type}</td>
                                    <td className="px-4 py-3 text-slate-600">{c.stage}</td>
                                    <td className="px-4 py-3">
                                        <span className="text-slate-700">{formatDate(c.follow_up_date!)}</span>
                                        <span className="text-xs ml-2" style={{ color: dleft < 0 ? '#dc2626' : '#94a3b8' }}>
                                            {dleft < 0 ? `${Math.abs(dleft)}d overdue` : dleft === 0 ? 'today' : `in ${dleft}d`}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        {proj ? (
                                            <span className="inline-flex items-center gap-1 font-semibold text-[#03a9e7]">
                                                <TrendingUp size={12} /> {formatCurrency(calculateCommission(proj).agent)}
                                            </span>
                                        ) : <span className="text-slate-300">—</span>}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
