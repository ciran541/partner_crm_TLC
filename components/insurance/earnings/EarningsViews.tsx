'use client'

import { Fragment, useMemo, useState } from 'react'
import { DollarSign, ArrowRight, ArrowLeft, Check, Clock } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { commissionWithFee } from '@/lib/insurance/commission'
import { useKeptList } from '@/lib/insurance/useOwnCases'
import { earningsKey, type EarningsMeta, type EarningsTab as Tab } from '@/lib/insurance/ownCases'
import LoadMore from '@/components/shared/LoadMore'
import LoadFailed from '@/components/shared/LoadFailed'
import type { CaseListRow } from '@/lib/insurance/caseQuery'
import type { CommissionBucket, AgentCommissionRow } from '@/lib/insurance/commission'
import EarningsOverview from '@/components/insurance/earnings/EarningsOverview'
import MonthPicker, { compact } from '@/components/insurance/shared/MonthPicker'
import StatementButton from '@/components/insurance/earnings/StatementButton'
import { todaySgt } from '@/lib/insurance/promotions'
import { loUploadedAt } from '@/lib/insurance/closedWon'

/** $1,620 or $1,147.50 — never "$1,147.5". */
const money = (n: number) => {
    if (!n) return formatCurrency(n)
    const whole = Math.abs(n - Math.round(n)) < 0.005
    return new Intl.NumberFormat('en-SG', {
        style: 'currency', currency: 'SGD',
        minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
    }).format(n)
}

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
        return <EmptyState icon={DollarSign} iconColor="#03a9e7" title="No agents yet" description="Premium agents will appear here once added." />
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
// Earnings = commission actually earned: Closed Won cases only, awaiting payout
// or paid. Active ("open") cases are pipeline, not earnings — they live in
// Cases (Potential Revenue). So a revisited case only shows here once it is
// itself Closed Won again, regardless of whether the earlier case was paid.

/**
 * Owns its own data: ONE request per period + tab (own_earnings()) brings every
 * total, count and month subtotal plus the first cases; more cases on scroll.
 * All figures cover every matching case, however many rows are loaded.
 *
 * `agentId` scopes it: omitted for an agent looking at their own earnings (the
 * server scopes by session), set for the admin drill-down.
 */
export function AgentEarningsView({ agentId, title, subtitle, isAdmin, onRecordPayout, onRowOpen, onBack }: {
    agentId?: string
    title: string
    subtitle: string
    isAdmin?: boolean
    /** Admin only: open the payout ledger for a case (record / reverse payouts). */
    onRecordPayout?: (c: CaseListRow) => void
    onRowOpen: (id: string) => void
    onBack?: () => void
}) {
    const [tab, setTab] = useState<Tab>('all')
    // When the case CLOSED (SGT), picked with the shared MonthPicker (same as
    // Cases → Closed Won): 'YYYY-MM' | 'YYYY' | 'all'. Opens on this year; the
    // overview above still shows every unpaid case, so nothing is hidden.
    const currentMonth = todaySgt().slice(0, 7)
    const [scope, setScope] = useState(currentMonth.slice(0, 4))
    const q = useKeptList<EarningsMeta>(earningsKey(scope, tab, agentId))
    const { rows: filtered, total: filteredTotal, meta } = q
    const earnedByMonth = useMemo(() => new Map((meta?.months ?? []).map(m => [m.month, m])), [meta])
    const years = useMemo(() => {
        const thisYear = Number(currentMonth.slice(0, 4))
        const ys = new Set<number>([thisYear, ...[...earnedByMonth.keys()].map(m => Number(m.slice(0, 4)))])
        return [...ys].sort((a, b) => b - a)
    }, [earnedByMonth, currentMonth])
    // From the server: complete even when the month's rows aren't all loaded.
    const group = (month: string) => meta?.groups.find(g => (g.month ?? '') === month) ?? { cases: 0, agent_share: 0 }
    // Counts belong to the period on screen; a dash while another one loads.
    const count = (t: Tab) => (meta && q.ready ? meta.counts[t] : '–')

    // Rows grouped by the month they closed (newest first), each with its own
    // total — the agent reads it like a statement.
    const monthGroups = (() => {
        const map = new Map<string, CaseListRow[]>()
        for (const r of filtered) {
            const key = (r.closed_on ?? r.updated_at ?? '').slice(0, 7)
            map.set(key, [...(map.get(key) ?? []), r])
        }
        return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
    })()

    const tabs: { key: Tab; label: string; count: number | string }[] = [
        { key: 'all', label: 'All', count: count('all') },
        { key: 'closed_unpaid', label: 'Awaiting payout', count: count('closed_unpaid') },
        { key: 'closed_paid', label: 'Paid', count: count('closed_paid') },
    ]

    const bucketBadge = (b: CommissionBucket) =>
        b === 'open' ? { label: 'Open', color: '#0369a1', bg: '#e0f2fe' }
        : b === 'closed_unpaid' ? { label: 'Awaiting payout', color: '#d97706', bg: '#fffbeb' }
        : { label: 'Paid', color: '#16a34a', bg: '#f0fdf4' }

    return (
        <div className="max-w-[1200px] mx-auto flex flex-col gap-5">
            <div>
                {onBack && (
                    <button onClick={onBack} className="flex items-center gap-1.5 text-sm on-navy-muted hover:text-white mb-2">
                        <ArrowLeft size={15} /> All agents
                    </button>
                )}
                <h1 className="ios-page-title">{title}</h1>
                <p className="page-subtitle">{subtitle}</p>
            </div>

            <EarningsOverview
                awaiting={meta ? Number(meta.awaiting) : null}
                awaitingCases={meta?.awaiting_cases ?? 0}
                earned={meta?.months ?? null}
                currentMonth={currentMonth}
                agentId={agentId}
            />

            {q.refreshError && <LoadFailed message="Couldn’t refresh. Showing what was loaded earlier." onRetry={q.refresh} />}
            {!meta ? (q.error
                ? <LoadFailed message="Couldn’t load earnings." onRetry={q.refresh} />
                : <Skeleton height={320} radius={14} />
            ) : meta.closed_cases === 0 ? (
                <EmptyState icon={DollarSign} iconColor="#03a9e7" title="No commission yet"
                    description="When you mark a case Closed Won, its commission shows here until it's paid out." />
            ) : (
                /* Dim while a tab switch loads over the existing rows — no spinner
                   flash, no layout jump. */
                <div className="card" style={{ overflow: 'hidden' }}>
                    {/* Which period — the same picker as Cases → Closed Won. Each
                        tile shows the commission earned that month. */}
                    <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #f1f5f9' }}>
                        <MonthPicker
                            scope={scope}
                            currentMonth={currentMonth}
                            years={years}
                            onScope={setScope}
                            tile={m => {
                                const t = earnedByMonth.get(m)
                                const earned = Number(t?.agent_share ?? 0)
                                return { weight: earned, main: compact(earned), sub: t ? `${t.cases} case${t.cases === 1 ? '' : 's'}` : '' }
                            }}
                        />
                        {scope !== 'all' && <StatementButton key={scope} period={scope} agentId={agentId} />}
                    </div>
                    <div className="scroll-x transition-opacity duration-150" style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #f1f5f9', padding: '0 16px', gap: 4, opacity: q.refreshing ? 0.55 : 1 }}>
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

                    {q.error ? (
                        <div className="p-4"><LoadFailed message="Couldn’t load these cases." onRetry={q.refresh} /></div>
                    ) : q.loading ? (
                        <div className="p-4"><Skeleton height={220} radius={10} /></div>
                    ) : <>
                    <div style={{ overflowX: 'auto', opacity: q.refreshing ? 0.55 : 1 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                                    <th className="table-th">Client</th>
                                    <th className="table-th">Type</th>
                                    <th className="table-th" style={{ textAlign: 'right' }}>Loan</th>
                                    <th className="table-th" style={{ textAlign: 'right' }}>Gross</th>
                                    <th className="table-th" style={{ textAlign: 'right' }}>{isAdmin ? 'Agent Share' : 'Your Share'}</th>
                                    <th className="table-th">Status</th>
                                    <th className="table-th">Log</th>
                                    {isAdmin && <th className="table-th" />}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0 && (
                                    <tr><td colSpan={isAdmin ? 8 : 7} className="table-td" style={{ textAlign: 'center', color: '#94a3b8', padding: '28px 16px' }}>
                                        No {tab === 'closed_paid' ? 'paid ' : tab === 'closed_unpaid' ? 'unpaid ' : ''}cases closed in {scope === 'all' ? 'any year' : monthLabel(scope)}.
                                    </td></tr>
                                )}
                                {monthGroups.map(([monthKey, rows]) => (
                                <Fragment key={monthKey}>
                                    {/* Month header with that month's earnings */}
                                    <tr style={{ background: '#f0f9ff', borderTop: '1px solid #e0f2fe' }}>
                                        <td colSpan={4} className="table-td" style={{ fontWeight: 800, color: '#052d4a', fontSize: 14 }}>
                                            {monthLabel(monthKey)}
                                            <span style={{ fontWeight: 500, color: '#64748b', fontSize: 12, marginLeft: 8 }}>
                                                {group(monthKey).cases} case{group(monthKey).cases === 1 ? '' : 's'}
                                            </span>
                                        </td>
                                        <td className="table-td" style={{ textAlign: 'right', fontWeight: 800, color: '#052d4a', fontSize: 15 }}>
                                            {money(Number(group(monthKey).agent_share))}
                                        </td>
                                        <td colSpan={isAdmin ? 3 : 2} className="table-td" style={{ fontSize: 11, color: '#64748b' }}>earned this month</td>
                                    </tr>
                                {rows.map(c => {
                                    // loan_value and bucket are computed by SQL, so
                                    // the row and the totals above it can never be
                                    // derived from two different rules.
                                    const loan = c.loan_value ?? 0
                                    const comm = commissionWithFee(loan, c.correction_fee)
                                    const bucket = (c.bucket ?? 'open') as CommissionBucket
                                    const paidSoFar = Number(c.commission_paid_total ?? 0)
                                    const partial = bucket === 'closed_unpaid' && paidSoFar > 0
                                    const badge = partial
                                        ? { label: `Partially paid · ${money(paidSoFar)} of ${money(comm.agent)}`, color: '#0369a1', bg: '#e0f2fe' }
                                        : bucketBadge(bucket)
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
                                            <td className="table-td" style={{ textAlign: 'right', fontWeight: 800, color: '#059669', fontSize: 15 }}>{money(comm.agent)}{comm.correctionFee > 0 && <div className="text-xs font-normal text-red-600">−{money(comm.correctionFee)} correction fee</div>}</td>
                                            <td className="table-td"><span className="status-badge" style={{ color: badge.color, background: badge.bg }}>{badge.label}</span></td>
                                            <td className="table-td" style={{ fontSize: 12, whiteSpace: 'nowrap', lineHeight: 1.6 }}>
                                                <EarningsLog c={c} />
                                            </td>
                                            {isAdmin && (
                                                <td className="table-td" onClick={e => e.stopPropagation()}>
                                                    {bucket !== 'open' && onRecordPayout && (
                                                        <button
                                                            onClick={() => onRecordPayout(c)}
                                                            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors whitespace-nowrap"
                                                            style={bucket === 'closed_paid'
                                                                ? { color: '#64748b', borderColor: '#e2e8f0' }
                                                                : { color: '#16a34a', borderColor: '#bbf7d0', background: '#f0fdf4' }}>
                                                            {bucket === 'closed_paid'
                                                                ? <span className="inline-flex items-center gap-1"><Clock size={12} /> Payouts</span>
                                                                : <span className="inline-flex items-center gap-1"><Check size={12} /> Record payout</span>}
                                                        </button>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    )
                                })}
                                </Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="px-4 pb-2"><LoadMore hasMore={q.hasMore} loading={q.loadingMore} failed={q.moreError} onLoad={q.loadMore} remaining={filteredTotal - filtered.length} /></div>
                    <div style={{ padding: '12px 20px', borderTop: '1px solid #f1f5f9', background: '#f8fafc' }}>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>
                            Showing {filtered.length} of {filteredTotal} case{filteredTotal !== 1 ? 's' : ''}
                        </span>
                    </div>
                    </>}
                </div>
            )}
        </div>
    )
}

/** DD/MM/YYYY in Singapore time. */
function dmy(iso: string): string {
    // Date-only strings are calendar days already; timestamps convert to SGT.
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
    return new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Singapore', day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * The case's payout trail, oldest first:
 *   • LO uploaded to HUB on DD/MM/YYYY   (when TLC could start checking the closure)
 *   • TLC payout on DD/MM/YYYY           (or "Awaiting TLC payout")
 */
function EarningsLog({ c }: { c: CaseListRow }) {
    const lo = loUploadedAt(c.closed_won_data?.lo_documents)
    const payouts = c.payouts ?? []
    const owed = commissionWithFee(c.loan_value ?? 0, c.correction_fee).agent
    const remaining = Math.round((owed - Number(c.commission_paid_total ?? 0)) * 100) / 100
    return (
        <>
            <div style={{ color: lo ? '#475569' : '#d97706' }}>
                {lo ? `LO uploaded to HUB on ${dmy(lo)}` : 'No LO uploaded yet'}
            </div>
            {/* One line per actual payment (ledger), oldest first; reversals in red. */}
            {payouts.map((p, i) => (
                <div key={i} style={{ color: p.amount < 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                    {p.amount < 0
                        ? `Reversed ${money(-p.amount)} on ${dmy(p.paid_on)}`
                        : `TLC payout ${money(p.amount)} on ${dmy(p.paid_on)}`}
                </div>
            ))}
            {remaining > 0.005 && (
                <div style={{ color: '#94a3b8' }}>
                    {payouts.length ? `Awaiting ${money(remaining)}` : 'Awaiting TLC payout'}
                </div>
            )}
        </>
    )
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** 'YYYY-MM' → "July 2025"; 'YYYY' → "2025". */
function monthLabel(key: string): string {
    if (key.length === 4) return key
    const m = Number(key.slice(5))
    return m >= 1 && m <= 12 ? `${MONTH_NAMES[m - 1]} ${key.slice(0, 4)}` : key
}
