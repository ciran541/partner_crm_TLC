'use client'

import { BarChart2, TrendingUp, DollarSign, Clock, Users, AlertCircle, Briefcase } from 'lucide-react'
import StatsCard from '@/components/shared/StatsCard'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { useCaseSummary } from '@/lib/insurance/useCaseSummary'
import type { CaseType, PipelineStage } from '@/lib/types'

const STAGES: PipelineStage[] = ['Touched Base', 'Pending Docs', 'Pending Approval', 'Pending Signature', 'Closed Won', 'Closed Lost']
const STAGE_COLOR: Record<string, string> = {
    'Touched Base': '#03a9e7', 'Pending Docs': '#0369a1', 'Pending Approval': '#d97706',
    'Pending Signature': '#f59e0b', 'Closed Won': '#16a34a', 'Closed Lost': '#dc2626',
}
const TYPES: CaseType[] = ['Purchase', 'Refinancing', 'Decouple', 'Equity Loan']
const TYPE_COLOR: Record<string, string> = { Purchase: '#8b5cf6', Refinancing: '#3b82f6', Decouple: '#f59e0b', 'Equity Loan': '#10b981' }

function formatMonth(yyyymm: string) {
    const [y, m] = yyyymm.split('-')
    return new Date(Number(y), Number(m) - 1).toLocaleString('en-SG', { month: 'short', year: '2-digit' })
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

export default function AdminInsuranceAnalyticsPage() {
    // Every figure below is computed by the database over EVERY case, not by the
    // browser over whatever rows a download happened to include. That is the
    // whole point of the change: these numbers used to be silently understated
    // once the case count passed the row cap.
    const { summary, loading, error } = useCaseSummary()

    // Named to match the shape the markup already used, so the rendering below
    // is untouched and this stays a data-layer change only.
    const d = {
        totalCases: summary.total_cases,
        activeCases: summary.active_cases,
        closedWon: summary.closed_won,
        stageCounts: summary.stage_counts,
        typeCounts: summary.type_counts,
        volume: summary.volume,
        gross: summary.commission.gross,
        agent: summary.commission.agent,
        tlc: summary.commission.tlc,
        totals: {
            open: summary.commission.open,
            closedUnpaid: summary.commission.closed_unpaid,
            closedPaid: summary.commission.closed_paid,
            activeCases: summary.commission.active_cases,
            total: summary.commission.total,
        },
        monthly: summary.monthly,
        followUps: summary.follow_ups,
        topAgents: summary.top_agents,
    }

    const maxMonthly = Math.max(...d.monthly.map(m => m.count), 1)

    if (loading) {
        return <div className="card p-8 flex items-center justify-center gap-3 text-slate-500 text-sm">Loading analytics…</div>
    }
    if (error) {
        return <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm"><AlertCircle size={15} />{error}</div>
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-[#052d4a] flex items-center gap-2"><BarChart2 size={26} color="#8b5cf6" /> Insurance Analytics</h1>
                <p className="text-sm text-slate-500 mt-1">Pipeline, commissions, and agent performance across the insurance book.</p>
            </div>

            {/* Hero stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatsCard title="Total Cases" value={d.totalCases} icon={Briefcase} color="#8b5cf6" subtitle="all time" />
                <StatsCard title="Active Cases" value={d.activeCases} icon={TrendingUp} color="#3b82f6" subtitle="in pipeline" />
                <StatsCard title="Closed Won" value={d.closedWon} icon={DollarSign} color="#16a34a" subtitle="deals closed" />
                <StatsCard title="Loan Volume" value={formatCurrency(d.volume)} icon={BarChart2} color="#0369a1" subtitle="total" variant="money" />
            </div>

            {/* Commission portfolio */}
            <div className="card p-6" style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)' }}>
                <p className="text-xs font-semibold text-purple-300 uppercase tracking-wider mb-4 flex items-center gap-2"><DollarSign size={13} /> Commission Portfolio</p>
                <div className="grid grid-cols-3 gap-6">
                    <div><p className="text-xs text-purple-300">Gross (0.15%)</p><p className="text-2xl font-bold text-white mt-1">{formatCurrency(d.gross)}</p></div>
                    <div><p className="text-xs text-purple-300">Agent Earnings (90%)</p><p className="text-2xl font-bold text-white mt-1">{formatCurrency(d.agent)}</p></div>
                    <div><p className="text-xs text-purple-300">TLC Revenue (10%)</p><p className="text-xl font-bold text-purple-200 mt-1">{formatCurrency(d.tlc)}</p></div>
                </div>
                <div className="mt-5 pt-5 border-t border-white/10 grid grid-cols-3 gap-4">
                    {[
                        { label: 'Open (potential)', value: d.totals.open, color: '#60a5fa' },
                        { label: 'Closed — Unpaid', value: d.totals.closedUnpaid, color: '#fbbf24' },
                        { label: 'Closed — Paid', value: d.totals.closedPaid, color: '#34d399' },
                    ].map(({ label, value, color }) => (
                        <div key={label}>
                            <div className="w-2 h-2 rounded-full inline-block mr-1.5 mb-0.5" style={{ background: color }} />
                            <span className="text-xs text-purple-300">{label}</span>
                            <p className="text-base font-semibold mt-0.5" style={{ color }}>{formatCurrency(value)}</p>
                        </div>
                    ))}
                </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
                <div className="card p-6">
                    <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2"><TrendingUp size={15} color="#8b5cf6" /> Cases by Stage</h3>
                    <div className="space-y-3">
                        {STAGES.map(s => (d.stageCounts[s] ? <BarRow key={s} label={s} count={d.stageCounts[s]} total={d.totalCases} color={STAGE_COLOR[s]} /> : null))}
                        {d.totalCases === 0 && <p className="text-sm text-slate-400">No cases yet.</p>}
                    </div>
                </div>
                <div className="card p-6">
                    <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2"><BarChart2 size={15} color="#8b5cf6" /> Cases by Type</h3>
                    <div className="space-y-3">
                        {TYPES.map(t => (d.typeCounts[t] ? <BarRow key={t} label={t} count={d.typeCounts[t]} total={d.totalCases} color={TYPE_COLOR[t]} /> : null))}
                        {d.totalCases === 0 && <p className="text-sm text-slate-400">No cases yet.</p>}
                    </div>
                </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
                <div className="card p-6">
                    <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2"><Clock size={15} color="#8b5cf6" /> Monthly Volume (last 6 months)</h3>
                    <div className="flex items-end gap-3 h-32">
                        {d.monthly.map(({ month, count }) => (
                            <div key={month} className="flex-1 flex flex-col items-center gap-1.5">
                                <span className="text-xs font-semibold text-slate-600">{count}</span>
                                <div className="w-full rounded-t-md transition-all" style={{ height: `${Math.max(8, Math.round((count / maxMonthly) * 88))}px`, background: '#8b5cf6', opacity: 0.85 }} />
                                <span className="text-[10px] text-slate-400">{formatMonth(month)}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="card p-6">
                    <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2"><Clock size={15} color="#8b5cf6" /> Follow-up Pipeline</h3>
                    <div className="space-y-3">
                        {[
                            { label: 'Total Follow-ups', value: d.followUps.total, color: '#8b5cf6' },
                            { label: 'Upcoming', value: d.followUps.upcoming, color: '#f59e0b' },
                            { label: 'Overdue', value: d.followUps.overdue, color: '#dc2626' },
                        ].map(({ label, value, color }) => (
                            <div key={label} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                                <span className="text-sm text-slate-600">{label}</span>
                                <span className="text-sm font-bold" style={{ color }}>{value}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Top agents */}
            {d.topAgents.length > 0 && (
                <div className="card overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
                        <Users size={15} color="#8b5cf6" /><span className="text-sm font-semibold text-slate-700">Top Agents by Case Count</span>
                    </div>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-100 bg-slate-50">
                                <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Agent</th>
                                <th className="text-right px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Cases</th>
                                <th className="text-right px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Commission (agent)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {d.topAgents.map((a, i) => (
                                <tr key={i} className="hover:bg-purple-50/30 transition-colors">
                                    <td className="px-5 py-3 font-medium text-slate-800">{a.name}</td>
                                    <td className="px-5 py-3 text-right"><span className="text-sm font-bold text-purple-600">{a.count}</span></td>
                                    <td className="px-5 py-3 text-right font-semibold text-slate-700">{a.commission > 0 ? formatCurrency(a.commission) : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
