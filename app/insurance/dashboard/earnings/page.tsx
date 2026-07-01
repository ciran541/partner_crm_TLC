'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { DollarSign, AlertCircle, ArrowRight, ArrowLeft, Users, Check, Clock } from 'lucide-react'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import { formatDate } from '@/lib/utils/formatDate'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { useCases, refreshCases } from '@/lib/insurance/useCases'
import {
    commissionBucket, caseCommission, caseLoanBase, commissionTotals, commissionByAgent,
    type CommissionBucket, type AgentCommissionRow,
} from '@/lib/insurance/commission'
import type { Case } from '@/lib/types'

const money = (n: number) => formatCurrency(n)

export default function InsuranceEarningsPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const agentParam = searchParams.get('agent')
    const { cases, isAdmin, loading, error } = useCases()

    const [roster, setRoster] = useState<{ id: string; name: string }[]>([])
    const [savingId, setSavingId] = useState<string | null>(null)

    // Admin: load the insurance agent roster for the master view + drill-down names.
    useEffect(() => {
        if (!isAdmin) return
        fetch('/api/admin/get-profiles')
            .then(r => (r.ok ? r.json() : []))
            .then((profiles) => {
                if (Array.isArray(profiles)) {
                    setRoster(
                        profiles
                            .filter((p: { role: string; app_type: string; status: string }) =>
                                p.role === 'agent' && p.app_type === 'insurance' && p.status !== 'disabled')
                            .map((p: { id: string; name: string }) => ({ id: p.id, name: p.name || 'Unnamed agent' })),
                    )
                }
            })
            .catch(() => {})
    }, [isAdmin])

    const togglePaid = async (c: Case) => {
        const next = c.commission_status === 'paid' ? 'unpaid' : 'paid'
        setSavingId(c.id)
        try {
            const res = await fetch('/api/admin/update-case', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: c.id, updates: { commission_status: next } }),
            })
            if (!res.ok) throw new Error('Failed')
            await refreshCases()
        } catch {
            /* non-fatal */
        } finally {
            setSavingId(null)
        }
    }

    if (loading) {
        return (
            <div className="max-w-[1200px] mx-auto flex flex-col gap-5">
                <Skeleton height={36} width={200} radius={8} />
                <Skeleton height={140} radius={14} />
                <Skeleton height={320} radius={14} />
            </div>
        )
    }
    if (error) {
        return (
            <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, color: '#dc2626', fontSize: 14 }}>
                <AlertCircle size={16} />{error}
            </div>
        )
    }

    // ── Admin master view ──
    if (isAdmin && !agentParam) {
        return <MasterView rows={commissionByAgent(cases, roster)} onOpen={id => router.push(`/insurance/dashboard/earnings?agent=${id}`)} />
    }

    // ── Agent self-view, or admin drill-down into one agent ──
    const scoped = agentParam ? cases.filter(c => c.created_by === agentParam) : cases
    const agentName = agentParam ? (roster.find(a => a.id === agentParam)?.name ?? 'Agent') : undefined

    return (
        <AgentEarnings
            cases={scoped}
            title={agentName ?? 'Earnings'}
            subtitle={agentName ? `${agentName}'s commission breakdown` : 'Your commission breakdown across all cases.'}
            isAdmin={isAdmin}
            savingId={savingId}
            onTogglePaid={togglePaid}
            onRowOpen={id => router.push(`/insurance/dashboard/cases/${id}`)}
            onBack={agentParam ? () => router.push('/insurance/dashboard/earnings') : undefined}
        />
    )
}

// ─── Admin master "excel" table ───────────────────────────────────────────────
function MasterView({ rows, onOpen }: { rows: AgentCommissionRow[]; onOpen: (id: string) => void }) {
    const totals = rows.reduce((acc, r) => ({
        activeCases: acc.activeCases + r.activeCases,
        open: acc.open + r.open,
        closedUnpaid: acc.closedUnpaid + r.closedUnpaid,
        closedPaid: acc.closedPaid + r.closedPaid,
        total: acc.total + r.total,
    }), { activeCases: 0, open: 0, closedUnpaid: 0, closedPaid: 0, total: 0 })

    return (
        <div className="max-w-[1200px] mx-auto flex flex-col gap-5">
            <div>
                <h1 className="ios-page-title flex items-center gap-2"><Users size={24} className="text-[#03a9e7]" /> Team Earnings</h1>
                <p className="page-subtitle">Commission across all agents. Click an agent to drill in.</p>
            </div>

            {rows.length === 0 ? (
                <EmptyState icon={DollarSign} iconColor="#03a9e7" title="No agents yet" description="Insurance agents will appear here once added." />
            ) : (
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                                    <th className="table-th">Agent</th>
                                    <th className="table-th" style={{ textAlign: 'right' }}>Active Cases</th>
                                    <th className="table-th" style={{ textAlign: 'right' }}>Open Commission</th>
                                    <th className="table-th" style={{ textAlign: 'right' }}>Closed (Unpaid)</th>
                                    <th className="table-th" style={{ textAlign: 'right' }}>Closed (Paid)</th>
                                    <th className="table-th" style={{ textAlign: 'right' }}>Total</th>
                                    <th className="table-th" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(r => (
                                    <tr key={r.agentId}
                                        onClick={() => onOpen(r.agentId)}
                                        style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                        onMouseLeave={e => (e.currentTarget.style.background = '')}>
                                        <td className="table-td" style={{ fontWeight: 600, color: '#0f172a' }}>{r.agentName}</td>
                                        <td className="table-td" style={{ textAlign: 'right', color: '#475569' }}>{r.activeCases}</td>
                                        <td className="table-td" style={{ textAlign: 'right', color: '#0369a1', fontWeight: 600 }}>{money(r.open)}</td>
                                        <td className="table-td" style={{ textAlign: 'right', color: '#d97706', fontWeight: 600 }}>{money(r.closedUnpaid)}</td>
                                        <td className="table-td" style={{ textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>{money(r.closedPaid)}</td>
                                        <td className="table-td" style={{ textAlign: 'right', color: '#0f172a', fontWeight: 800 }}>{money(r.total)}</td>
                                        <td className="table-td"><ArrowRight size={14} color="#cbd5e1" /></td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ borderTop: '2px solid #e2e8f0', background: '#f8fafc' }}>
                                    <td className="table-td" style={{ fontWeight: 800, color: '#0f172a' }}>All agents</td>
                                    <td className="table-td" style={{ textAlign: 'right', fontWeight: 700 }}>{totals.activeCases}</td>
                                    <td className="table-td" style={{ textAlign: 'right', fontWeight: 700, color: '#0369a1' }}>{money(totals.open)}</td>
                                    <td className="table-td" style={{ textAlign: 'right', fontWeight: 700, color: '#d97706' }}>{money(totals.closedUnpaid)}</td>
                                    <td className="table-td" style={{ textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{money(totals.closedPaid)}</td>
                                    <td className="table-td" style={{ textAlign: 'right', fontWeight: 800, color: '#0f172a' }}>{money(totals.total)}</td>
                                    <td className="table-td" />
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── Agent earnings view (self, or admin drill-down) ──────────────────────────
type Tab = 'all' | CommissionBucket

function AgentEarnings({ cases, title, subtitle, isAdmin, savingId, onTogglePaid, onRowOpen, onBack }: {
    cases: Case[]
    title: string
    subtitle: string
    isAdmin: boolean
    savingId: string | null
    onTogglePaid: (c: Case) => void
    onRowOpen: (id: string) => void
    onBack?: () => void
}) {
    const [tab, setTab] = useState<Tab>('all')
    const totals = useMemo(() => commissionTotals(cases), [cases])

    // Cases that carry a commission bucket (drafts / closed-lost excluded).
    const bucketed = useMemo(() =>
        cases.map(c => ({ c, bucket: commissionBucket(c) })).filter((x): x is { c: Case; bucket: CommissionBucket } => x.bucket !== null),
        [cases])

    const filtered = tab === 'all' ? bucketed : bucketed.filter(x => x.bucket === tab)

    const tabs: { key: Tab; label: string; count: number }[] = [
        { key: 'all', label: 'All', count: bucketed.length },
        { key: 'open', label: 'Open', count: bucketed.filter(x => x.bucket === 'open').length },
        { key: 'closed_unpaid', label: 'Unpaid', count: bucketed.filter(x => x.bucket === 'closed_unpaid').length },
        { key: 'closed_paid', label: 'Paid', count: bucketed.filter(x => x.bucket === 'closed_paid').length },
    ]

    const bucketBadge = (b: CommissionBucket) =>
        b === 'open' ? { label: 'Open', color: '#0369a1', bg: '#e0f2fe' }
        : b === 'closed_unpaid' ? { label: 'Unpaid', color: '#d97706', bg: '#fffbeb' }
        : { label: 'Paid', color: '#16a34a', bg: '#f0fdf4' }

    return (
        <div className="max-w-[1200px] mx-auto flex flex-col gap-5">
            <div>
                {onBack && (
                    <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-2">
                        <ArrowLeft size={15} /> All agents
                    </button>
                )}
                <h1 className="ios-page-title">{title}</h1>
                <p className="page-subtitle">{subtitle}</p>
            </div>

            {/* Hero cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <HeroCard label="Open (potential)" value={money(totals.open)} sub={`${totals.activeCases} active case${totals.activeCases !== 1 ? 's' : ''}`} accent="#0369a1" bg="#e0f2fe" />
                <HeroCard label="Closed — Unpaid" value={money(totals.closedUnpaid)} sub="Awaiting payout" accent="#d97706" bg="#fffbeb" />
                <HeroCard label="Closed — Paid" value={money(totals.closedPaid)} sub="Paid out" accent="#16a34a" bg="#f0fdf4" />
            </div>

            {bucketed.length === 0 ? (
                <EmptyState icon={DollarSign} iconColor="#03a9e7" title="No commission yet"
                    description="Cases with a loan amount will show potential commission here; closed-won cases show earned commission." />
            ) : (
                <div className="card" style={{ overflow: 'hidden' }}>
                    {/* Tabs */}
                    <div className="scroll-x" style={{ display: 'flex', borderBottom: '1px solid #f1f5f9', padding: '0 16px', gap: 4 }}>
                        {tabs.map(t => {
                            const active = tab === t.key
                            return (
                                <button key={t.key} onClick={() => setTab(t.key)}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '13px 16px', fontSize: 14,
                                        fontWeight: active ? 700 : 500, color: active ? '#03a9e7' : '#64748b',
                                        borderBottom: active ? '2px solid #03a9e7' : '2px solid transparent',
                                        marginBottom: -1, background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                                    }}>
                                    {t.label}
                                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 9999, background: active ? '#e0f2fe' : '#f1f5f9', color: active ? '#0369a1' : '#64748b' }}>{t.count}</span>
                                </button>
                            )
                        })}
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                                    <th className="table-th">Client</th>
                                    <th className="table-th">Type</th>
                                    <th className="table-th" style={{ textAlign: 'right' }}>Loan</th>
                                    <th className="table-th" style={{ textAlign: 'right' }}>Gross</th>
                                    <th className="table-th" style={{ textAlign: 'right' }}>Your Share</th>
                                    <th className="table-th">Bucket</th>
                                    <th className="table-th">Updated</th>
                                    {isAdmin && <th className="table-th" />}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(({ c, bucket }) => {
                                    const comm = caseCommission(c)
                                    const badge = bucketBadge(bucket)
                                    return (
                                        <tr key={c.id}
                                            onClick={() => onRowOpen(c.id)}
                                            style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                                            onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                            onMouseLeave={e => (e.currentTarget.style.background = '')}>
                                            <td className="table-td" style={{ fontWeight: 600, color: '#0f172a' }}>{c.client_name || 'Unnamed'}</td>
                                            <td className="table-td" style={{ color: '#475569' }}>{c.case_type}</td>
                                            <td className="table-td" style={{ textAlign: 'right', color: '#475569' }}>{caseLoanBase(c) ? money(caseLoanBase(c)) : '—'}</td>
                                            <td className="table-td" style={{ textAlign: 'right', color: '#475569' }}>{money(comm.gross)}</td>
                                            <td className="table-td" style={{ textAlign: 'right', fontWeight: 800, color: '#059669', fontSize: 15 }}>{money(comm.agent)}</td>
                                            <td className="table-td"><span className="status-badge" style={{ color: badge.color, background: badge.bg }}>{badge.label}</span></td>
                                            <td className="table-td" style={{ fontSize: 12, color: '#94a3b8' }}>{formatDate(c.updated_at)}</td>
                                            {isAdmin && (
                                                <td className="table-td" onClick={e => e.stopPropagation()}>
                                                    {bucket !== 'open' && (
                                                        <button
                                                            onClick={() => onTogglePaid(c)}
                                                            disabled={savingId === c.id}
                                                            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
                                                            style={bucket === 'closed_paid'
                                                                ? { color: '#64748b', borderColor: '#e2e8f0' }
                                                                : { color: '#16a34a', borderColor: '#bbf7d0', background: '#f0fdf4' }}
                                                        >
                                                            {bucket === 'closed_paid'
                                                                ? <span className="inline-flex items-center gap-1"><Clock size={12} /> Mark unpaid</span>
                                                                : <span className="inline-flex items-center gap-1"><Check size={12} /> Mark paid</span>}
                                                        </button>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid #f1f5f9', background: '#f8fafc' }}>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>{filtered.length} case{filtered.length !== 1 ? 's' : ''}</span>
                        <span style={{ fontSize: 15, fontWeight: 800, color: '#059669' }}>
                            {money(filtered.reduce((s, x) => s + caseCommission(x.c).agent, 0))} total
                        </span>
                    </div>
                </div>
            )}
        </div>
    )
}

function HeroCard({ label, value, sub, accent, bg }: { label: string; value: string; sub: string; accent: string; bg: string }) {
    return (
        <div className="card" style={{ padding: '20px 22px' }}>
            <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: accent, background: bg, padding: '3px 8px', borderRadius: 6 }}>{label}</span>
            <p style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.03em', marginTop: 12, lineHeight: 1 }}>{value}</p>
            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>{sub}</p>
        </div>
    )
}
