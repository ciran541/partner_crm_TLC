'use client'

import { useEffect, useState } from 'react'
import {
    BarChart2, TrendingUp, DollarSign, AlertTriangle, Clock,
    RefreshCw, Users, CheckCircle, AlertCircle,
} from 'lucide-react'
import StatsCard from '@/components/shared/StatsCard'
import { formatCurrency } from '@/lib/utils/formatCurrency'

const STATUS_LABELS: Record<string, string> = {
    draft: 'Draft', submitted: 'Submitted', under_review: 'Under Review',
    verified: 'Verified', paid: 'Paid', rejected: 'Rejected',
    on_hold: 'On Hold', opportunity_due: 'Opportunity Due',
}
const STATUS_COLORS: Record<string, string> = {
    draft: '#64748b', submitted: '#3b82f6', under_review: '#d97706',
    verified: '#059669', paid: '#16a34a', rejected: '#dc2626',
    on_hold: '#7c3aed', opportunity_due: '#ea580c',
}
const TYPE_LABELS: Record<string, string> = {
    new_purchase: 'New Purchase', refinance: 'Refinance',
    decoupling: 'Decoupling', equity: 'Equity',
}
const TYPE_COLORS: Record<string, string> = {
    new_purchase: '#8b5cf6', refinance: '#3b82f6', decoupling: '#f59e0b', equity: '#10b981',
}

function formatMonth(yyyymm: string) {
    const [y, m] = yyyymm.split('-')
    return new Date(Number(y), Number(m) - 1).toLocaleString('en-SG', { month: 'short', year: '2-digit' })
}

interface AnalyticsData {
    totalCases: number
    activeCases: number
    opportunityDue: number
    totalGross: number
    totalAgentCommission: number
    totalTlcCommission: number
    statusCounts: Record<string, number>
    typeCounts: Record<string, number>
    commissionByPaymentStatus: Record<string, number>
    topAgents: { name: string; count: number; totalAgentCommission: number }[]
    monthlyVolume: { month: string; count: number }[]
    reminders: { total: number; sent: number; pending: number }
}

function BarRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0
    return (
        <div className="flex items-center gap-3">
            <span className="text-xs text-slate-600 w-32 shrink-0 truncate">{label}</span>
            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="text-xs font-semibold text-slate-700 w-6 text-right">{count}</span>
            <span className="text-xs text-slate-400 w-9 text-right">{pct}%</span>
        </div>
    )
}

export default function PropertyAnalyticsPage() {
    const [data, setData] = useState<AnalyticsData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    function load() {
        setLoading(true)
        setError(null)
        fetch('/api/admin/property/analytics')
            .then(r => r.json())
            .then(json => setData(json.data))
            .catch(() => setError('Failed to load analytics.'))
            .finally(() => setLoading(false))
    }

    useEffect(() => { load() }, [])

    const maxMonthly = data ? Math.max(...data.monthlyVolume.map(m => m.count), 1) : 1

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-[#052d4a] flex items-center gap-2">
                        <BarChart2 size={26} color="#8b5cf6" />
                        Property Analytics
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">Portfolio overview — commissions, case volumes, and agent performance.</p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            </div>

            {error && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                    <AlertCircle size={15} />{error}
                </div>
            )}

            {loading && (
                <div className="card p-8 flex items-center justify-center gap-3 text-slate-500 text-sm">
                    <div style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid #8b5cf6', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                    Loading analytics…
                </div>
            )}

            {!loading && data && (
                <>
                    {/* Hero Stats */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatsCard title="Total Cases" value={data.totalCases} icon={BarChart2} color="#8b5cf6" subtitle="all time" />
                        <StatsCard title="Active Cases" value={data.activeCases} icon={TrendingUp} color="#3b82f6" subtitle="in pipeline" />
                        <StatsCard title="Opportunity Due" value={data.opportunityDue} icon={AlertTriangle} color="#ea580c" subtitle="need action" />
                        <StatsCard title="Agent Commissions" value={`S$${Math.round(data.totalAgentCommission).toLocaleString('en-SG')}`} icon={DollarSign} color="#16a34a" subtitle="total portfolio" />
                    </div>

                    {/* Commission Summary */}
                    <div
                        className="card p-6"
                        style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)' }}
                    >
                        <p className="text-xs font-semibold text-purple-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <DollarSign size={13} />
                            Commission Portfolio
                        </p>
                        <div className="grid grid-cols-3 gap-6">
                            <div>
                                <p className="text-xs text-purple-300">Gross (Total)</p>
                                <p className="text-2xl font-bold text-white mt-1">{formatCurrency(data.totalGross)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-purple-300">Agent Earnings (90%)</p>
                                <p className="text-2xl font-bold text-white mt-1">{formatCurrency(data.totalAgentCommission)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-purple-300">TLC Revenue (10%)</p>
                                <p className="text-xl font-bold text-purple-200 mt-1">{formatCurrency(data.totalTlcCommission)}</p>
                            </div>
                        </div>
                        {/* Payment pipeline */}
                        <div className="mt-5 pt-5 border-t border-white/10 grid grid-cols-3 gap-4">
                            {[
                                { label: 'Pending Payout', key: 'pending', color: '#fbbf24' },
                                { label: 'Confirmed', key: 'confirmed', color: '#60a5fa' },
                                { label: 'Paid Out', key: 'paid', color: '#34d399' },
                            ].map(({ label, key, color }) => (
                                <div key={key}>
                                    <div className="w-2 h-2 rounded-full inline-block mr-1.5 mb-0.5" style={{ background: color }} />
                                    <span className="text-xs text-purple-300">{label}</span>
                                    <p className="text-base font-semibold mt-0.5" style={{ color }}>
                                        {formatCurrency(data.commissionByPaymentStatus[key] ?? 0)}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid lg:grid-cols-2 gap-6">
                        {/* Cases by Status */}
                        <div className="card p-6">
                            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                                <TrendingUp size={15} color="#8b5cf6" />
                                Cases by Status
                            </h3>
                            <div className="space-y-3">
                                {Object.entries(STATUS_LABELS).map(([status, label]) => {
                                    const count = data.statusCounts[status] ?? 0
                                    if (count === 0) return null
                                    return (
                                        <BarRow
                                            key={status}
                                            label={label}
                                            count={count}
                                            total={data.totalCases}
                                            color={STATUS_COLORS[status] ?? '#8b5cf6'}
                                        />
                                    )
                                })}
                                {data.totalCases === 0 && (
                                    <p className="text-sm text-slate-400">No cases yet.</p>
                                )}
                            </div>
                        </div>

                        {/* Cases by Type */}
                        <div className="card p-6">
                            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                                <BarChart2 size={15} color="#8b5cf6" />
                                Cases by Type
                            </h3>
                            <div className="space-y-3">
                                {Object.entries(TYPE_LABELS).map(([type, label]) => {
                                    const count = data.typeCounts[type] ?? 0
                                    if (count === 0) return null
                                    return (
                                        <BarRow
                                            key={type}
                                            label={label}
                                            count={count}
                                            total={data.totalCases}
                                            color={TYPE_COLORS[type] ?? '#8b5cf6'}
                                        />
                                    )
                                })}
                                {data.totalCases === 0 && (
                                    <p className="text-sm text-slate-400">No cases yet.</p>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="grid lg:grid-cols-2 gap-6">
                        {/* Monthly Volume */}
                        <div className="card p-6">
                            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                                <Clock size={15} color="#8b5cf6" />
                                Monthly Volume (last 6 months)
                            </h3>
                            {data.monthlyVolume.length === 0 ? (
                                <p className="text-sm text-slate-400">No data yet.</p>
                            ) : (
                                <div className="flex items-end gap-3 h-32">
                                    {data.monthlyVolume.map(({ month, count }) => (
                                        <div key={month} className="flex-1 flex flex-col items-center gap-1.5">
                                            <span className="text-xs font-semibold text-slate-600">{count}</span>
                                            <div
                                                className="w-full rounded-t-md transition-all"
                                                style={{
                                                    height: `${Math.max(8, Math.round((count / maxMonthly) * 88))}px`,
                                                    background: '#8b5cf6',
                                                    opacity: 0.85,
                                                }}
                                            />
                                            <span className="text-[10px] text-slate-400">{formatMonth(month)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Reminder Pipeline */}
                        <div className="card p-6">
                            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                                <AlertTriangle size={15} color="#8b5cf6" />
                                Reminder Pipeline
                            </h3>
                            <div className="space-y-3">
                                {[
                                    { label: 'Total Reminders', value: data.reminders.total, color: '#8b5cf6' },
                                    { label: 'Processed', value: data.reminders.sent, color: '#16a34a' },
                                    { label: 'Pending / Upcoming', value: data.reminders.pending, color: '#f59e0b' },
                                ].map(({ label, value, color }) => (
                                    <div key={label} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                                        <span className="text-sm text-slate-600">{label}</span>
                                        <span className="text-sm font-bold" style={{ color }}>{value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Top Agents */}
                    {data.topAgents.length > 0 && (
                        <div className="card overflow-hidden">
                            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
                                <Users size={15} color="#8b5cf6" />
                                <span className="text-sm font-semibold text-slate-700">Top Agents by Case Count</span>
                            </div>
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-100 bg-slate-50">
                                        <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Agent</th>
                                        <th className="text-right px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Cases</th>
                                        <th className="text-right px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Commission</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {data.topAgents.map((agent, i) => (
                                        <tr key={i} className="hover:bg-purple-50/30 transition-colors">
                                            <td className="px-5 py-3 font-medium text-slate-800">{agent.name}</td>
                                            <td className="px-5 py-3 text-right">
                                                <span className="text-sm font-bold text-purple-600">{agent.count}</span>
                                            </td>
                                            <td className="px-5 py-3 text-right font-semibold text-slate-700">
                                                {agent.totalAgentCommission > 0 ? formatCurrency(agent.totalAgentCommission) : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    )
}
