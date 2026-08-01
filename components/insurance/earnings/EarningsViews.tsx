'use client'

import { useState } from 'react'
import { DollarSign, ArrowRight, ArrowLeft, Check, Clock } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { formatDate } from '@/lib/utils/formatDate'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { calculateCommission } from '@/lib/property/commission'
import { useCaseSummary } from '@/lib/insurance/useCaseSummary'
import { usePagedCases, type CaseListRow } from '@/lib/insurance/usePagedCases'
import type { CommissionBucket, AgentCommissionRow } from '@/lib/insurance/commission'

const money = (n: number) => formatCurrency(n)

// ─── Admin master "excel" table ───────────────────────────────────────────────
export function MasterEarningsTable({ rows, onOpen }: { rows: AgentCommissionRow[]; onOpen: (id: string) => void }) {
    const totals = rows.reduce((acc, r) => ({
        activeCases: acc.activeCases + r.activeCases,
        open: acc.open + r.open,
        closedUnpaid: acc.closedUnpaid + r.closedUnpaid,
        closedPaid: acc.closedPaid + r.closedPaid,
        total: acc.total + r.total,
    }), { activeCases: 0, open: 0, closedUnpaid: 0, closedPaid: 0, total: 0 })

    if (rows.length === 0) {
        return <EmptyState icon={DollarSign} iconColor="#03a9e7" title="No agents yet" description="Insurance agents will appear here once added." />
    }

    return (
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
    )
}

// ─── Agent earnings view (self, or admin drill-down) ──────────────────────────
type Tab = 'all' | CommissionBucket

/**
 * Owns its own data rather than receiving a case array.
 *
 * The tabs are a server-side filter now, so the component that knows which tab
 * is selected has to be the one issuing the query — passing rows in from the
 * parent would mean every parent re-implementing the tab-to-query mapping.
 *
 * `agentId` scopes it: omitted for an agent looking at their own earnings (the
 * server scopes by session), set for the admin drill-down.
 */
export function AgentEarningsView({ agentId, title, subtitle, isAdmin, savingId, onTogglePaid, onRowOpen, onBack }: {
    agentId?: string
    title: string
    subtitle: string
    isAdmin?: boolean
    savingId?: string | null
    onTogglePaid?: (c: CaseListRow) => void
    onRowOpen: (id: string) => void
    onBack?: () => void
}) {
    const [tab, setTab] = useState<Tab>('all')

    // Totals and per-tab counts come from the database over EVERY case in scope,
    // so the hero cards and tab badges stay correct however many rows are loaded.
    const { summary, loading: summaryLoading } = useCaseSummary({ agent: agentId })
    const c = summary.commission

    const totals = {
        open: c.open,
        closedUnpaid: c.closed_unpaid,
        closedPaid: c.closed_paid,
        activeCases: c.active_cases,
        total: c.total,
    }

    const {
        rows: filtered,
        total: filteredTotal,
        hasMore,
        loading: rowsLoading,
        refreshing,
        loadingMore,
        loadMore,
    } = usePagedCases({ agent: agentId, stage: 'all', bucket: tab })

    const bucketedCount = c.count_open + c.count_closed_unpaid + c.count_closed_paid
    const loading = summaryLoading || rowsLoading

    const tabs: { key: Tab; label: string; count: number }[] = [
        { key: 'all', label: 'All', count: bucketedCount },
        { key: 'open', label: 'Open', count: c.count_open },
        { key: 'closed_unpaid', label: 'Unpaid', count: c.count_closed_unpaid },
        { key: 'closed_paid', label: 'Paid', count: c.count_closed_paid },
    ]

    // Agent-share total for the tab on screen — again from the server, so the
    // footer figure covers the whole tab rather than the rows loaded so far.
    const tabAgentTotal =
        tab === 'open' ? c.open
        : tab === 'closed_unpaid' ? c.closed_unpaid
        : tab === 'closed_paid' ? c.closed_paid
        : c.total

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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <HeroCard label="Open (potential)" value={money(totals.open)} sub={`${totals.activeCases} active case${totals.activeCases !== 1 ? 's' : ''}`} accent="#0369a1" bg="#e0f2fe" />
                <HeroCard label="Closed — Unpaid" value={money(totals.closedUnpaid)} sub="Awaiting payout" accent="#d97706" bg="#fffbeb" />
                <HeroCard label="Closed — Paid" value={money(totals.closedPaid)} sub="Paid out" accent="#16a34a" bg="#f0fdf4" />
            </div>

            {loading ? (
                <Skeleton height={320} radius={14} />
            ) : bucketedCount === 0 ? (
                <EmptyState icon={DollarSign} iconColor="#03a9e7" title="No commission yet"
                    description="Cases with a loan amount will show potential commission here; closed-won cases show earned commission." />
            ) : (
                /* Dim while a tab switch loads over the existing rows — no spinner
                   flash, no layout jump. */
                <div className="card transition-opacity duration-150" style={{ overflow: 'hidden', opacity: refreshing ? 0.55 : 1 }}>
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
                                    <th className="table-th" style={{ textAlign: 'right' }}>{isAdmin ? 'Agent Share' : 'Your Share'}</th>
                                    <th className="table-th">Bucket</th>
                                    <th className="table-th">Updated</th>
                                    {isAdmin && <th className="table-th" />}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(c => {
                                    // loan_value and bucket are computed by SQL, so
                                    // the row and the totals above it can never be
                                    // derived from two different rules.
                                    const loan = c.loan_value ?? 0
                                    const comm = calculateCommission(loan)
                                    const bucket = (c.bucket ?? 'open') as CommissionBucket
                                    const badge = bucketBadge(bucket)
                                    return (
                                        <tr key={c.id}
                                            onClick={() => onRowOpen(c.id)}
                                            style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                                            onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                            onMouseLeave={e => (e.currentTarget.style.background = '')}>
                                            <td className="table-td" style={{ fontWeight: 600, color: '#0f172a' }}>{c.client_name || 'Unnamed'}</td>
                                            <td className="table-td" style={{ color: '#475569' }}>{c.case_type}</td>
                                            <td className="table-td" style={{ textAlign: 'right', color: '#475569' }}>{loan ? money(loan) : '—'}</td>
                                            <td className="table-td" style={{ textAlign: 'right', color: '#475569' }}>{money(comm.gross)}</td>
                                            <td className="table-td" style={{ textAlign: 'right', fontWeight: 800, color: '#059669', fontSize: 15 }}>{money(comm.agent)}</td>
                                            <td className="table-td"><span className="status-badge" style={{ color: badge.color, background: badge.bg }}>{badge.label}</span></td>
                                            <td className="table-td" style={{ fontSize: 12, color: '#94a3b8' }}>{formatDate(c.updated_at)}</td>
                                            {isAdmin && (
                                                <td className="table-td" onClick={e => e.stopPropagation()}>
                                                    {bucket !== 'open' && onTogglePaid && (
                                                        <button
                                                            onClick={() => onTogglePaid(c)}
                                                            disabled={savingId === c.id}
                                                            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
                                                            style={bucket === 'closed_paid'
                                                                ? { color: '#64748b', borderColor: '#e2e8f0' }
                                                                : { color: '#16a34a', borderColor: '#bbf7d0', background: '#f0fdf4' }}>
                                                            {bucket === 'closed_paid'
                                                                ? <span className="inline-flex items-center gap-1"><Clock size={12} /> Mark unpaid</span>
                                                                : <span className="inline-flex items-center gap-1"><Check size={12} /> Confirm paid</span>}
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
                    {/* Appends the next page, so scroll position is preserved. */}
                    {hasMore && (
                        <button
                            onClick={loadMore}
                            disabled={loadingMore}
                            style={{
                                width: '100%', padding: '11px 20px', borderTop: '1px solid #f1f5f9',
                                background: 'none', border: 'none', cursor: loadingMore ? 'default' : 'pointer',
                                fontSize: 13, fontWeight: 600, color: '#0369a1',
                            }}
                        >
                            {loadingMore ? 'Loading…' : `Load more (${filteredTotal - filtered.length} remaining)`}
                        </button>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid #f1f5f9', background: '#f8fafc' }}>
                        {/* Both figures span the whole tab, not the loaded page. */}
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>
                            Showing {filtered.length} of {filteredTotal} case{filteredTotal !== 1 ? 's' : ''}
                        </span>
                        <span style={{ fontSize: 15, fontWeight: 800, color: '#059669' }}>
                            {money(tabAgentTotal)} total
                        </span>
                    </div>
                </div>
            )}
        </div>
    )
}

export function HeroCard({ label, value, sub, accent, bg }: { label: string; value: string; sub: string; accent: string; bg: string }) {
    return (
        <div className="card" style={{ padding: '20px 22px' }}>
            <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: accent, background: bg, padding: '3px 8px', borderRadius: 6 }}>{label}</span>
            <p style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.03em', marginTop: 12, lineHeight: 1 }}>{value}</p>
            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>{sub}</p>
        </div>
    )
}
