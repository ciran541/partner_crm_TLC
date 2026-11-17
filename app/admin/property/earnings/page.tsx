'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowLeft, ArrowRight, DollarSign } from 'lucide-react'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { formatDate } from '@/lib/utils/formatDate'
import type {
    PropertyAgentCommissionRow,
    PropertyCaseType,
    PropertyCommissionStatus,
} from '@/lib/types/property'

/**
 * Admin Property Earnings — the property counterpart of
 * /admin/insurance/earnings. Master table of the agent roster, click through to
 * one agent's cases.
 *
 * Both halves come from /api/admin/property/earnings, which applies one shared
 * definition of "counts towards earnings" (submitted, non-duplicate, has an
 * amount) so a drill-down always re-adds to the total shown in the master row.
 */

const CASE_TYPE_LABELS: Record<PropertyCaseType, string> = {
    new_purchase: 'New Purchase',
    refinance: 'Refinance',
    decoupling: 'Decoupling',
    equity: 'Equity',
}

const STATUS_CONFIG: Record<PropertyCommissionStatus, { label: string; color: string; bg: string }> = {
    pending: { label: 'Pending', color: '#d97706', bg: '#fffbeb' },
    confirmed: { label: 'Confirmed', color: '#2563eb', bg: '#eff6ff' },
    paid: { label: 'Paid', color: '#16a34a', bg: '#f0fdf4' },
}

interface AgentCaseRow {
    id: string
    client_name: string
    case_type: PropertyCaseType
    status: string
    commission_status: PropertyCommissionStatus
    agent_commission_amount: number | null
    gross_commission_amount: number | null
    outstanding_loan_amount: number | null
    lockin_confirmed_date: string | null
    created_at: string
}

const money = (n: number) => formatCurrency(n)

export default function AdminPropertyEarningsPage() {
    return (
        <Suspense fallback={<Skeleton height={320} radius={14} />}>
            <Content />
        </Suspense>
    )
}

function Content() {
    const router = useRouter()
    const agentParam = useSearchParams().get('agent')

    const [rows, setRows] = useState<PropertyAgentCommissionRow[] | null>(null)
    const [error, setError] = useState<string | null>(null)

    // The master rows are fetched even for the drill-down: they carry the agent's
    // display name, so without them the drill-down header reads "Agent".
    useEffect(() => {
        let active = true
        fetch('/api/admin/property/earnings')
            .then(r => (r.ok ? r.json() : Promise.reject(new Error(`Request failed (${r.status})`))))
            .then(body => { if (active) { setRows((body.rows ?? []) as PropertyAgentCommissionRow[]); setError(null) } })
            .catch(() => { if (active) setError('Could not load earnings. Please try again.') })
        return () => { active = false }
    }, [])

    if (error) {
        return <div className="card p-4 flex items-center gap-2 text-red-600 text-sm"><AlertCircle size={16} />{error}</div>
    }

    if (agentParam) {
        return (
            <AgentDetail
                agentId={agentParam}
                agentName={rows?.find(r => r.agentId === agentParam)?.agentName ?? 'Agent'}
                onBack={() => router.push('/admin/property/earnings')}
            />
        )
    }

    if (!rows) {
        return (
            <div className="flex flex-col gap-5">
                <Skeleton height={36} width={220} radius={8} />
                <Skeleton height={320} radius={14} />
            </div>
        )
    }

    return (
        <div className="space-y-5">
            <div>
                <h1 className="text-2xl font-bold text-[#052d4a]">Property Earnings</h1>
                <p className="text-sm text-slate-500 mt-1">Commission across all Basic and Starter agents. Click an agent to see their cases.</p>
            </div>
            <MasterTable rows={rows} onOpen={id => router.push(`/admin/property/earnings?agent=${id}`)} />
        </div>
    )
}

function MasterTable({ rows, onOpen }: { rows: PropertyAgentCommissionRow[]; onOpen: (id: string) => void }) {
    const totals = rows.reduce((acc, r) => ({
        caseCount: acc.caseCount + Number(r.caseCount),
        pending: acc.pending + Number(r.pending),
        confirmed: acc.confirmed + Number(r.confirmed),
        paid: acc.paid + Number(r.paid),
        total: acc.total + Number(r.total),
    }), { caseCount: 0, pending: 0, confirmed: 0, paid: 0, total: 0 })

    if (rows.length === 0) {
        return <EmptyState icon={DollarSign} iconColor="#8b5cf6" title="No agents yet" description="Basic and Starter agents will appear here once added." />
    }

    return (
        <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                            <th className="table-th">Agent</th>
                            <th className="table-th" style={{ textAlign: 'right' }}>Cases</th>
                            <th className="table-th" style={{ textAlign: 'right' }}>Pending</th>
                            <th className="table-th" style={{ textAlign: 'right' }}>Confirmed</th>
                            <th className="table-th" style={{ textAlign: 'right' }}>Paid</th>
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
                                <td className="table-td" style={{ textAlign: 'right', color: '#475569' }}>{r.caseCount}</td>
                                <td className="table-td" style={{ textAlign: 'right', color: '#d97706', fontWeight: 600 }}>{money(Number(r.pending))}</td>
                                <td className="table-td" style={{ textAlign: 'right', color: '#2563eb', fontWeight: 600 }}>{money(Number(r.confirmed))}</td>
                                <td className="table-td" style={{ textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>{money(Number(r.paid))}</td>
                                <td className="table-td" style={{ textAlign: 'right', color: '#0f172a', fontWeight: 800 }}>{money(Number(r.total))}</td>
                                <td className="table-td"><ArrowRight size={14} color="#cbd5e1" /></td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                            <td className="table-td" style={{ fontWeight: 700, color: '#0f172a' }}>All agents</td>
                            <td className="table-td" style={{ textAlign: 'right', fontWeight: 700, color: '#475569' }}>{totals.caseCount}</td>
                            <td className="table-td" style={{ textAlign: 'right', fontWeight: 700, color: '#d97706' }}>{money(totals.pending)}</td>
                            <td className="table-td" style={{ textAlign: 'right', fontWeight: 700, color: '#2563eb' }}>{money(totals.confirmed)}</td>
                            <td className="table-td" style={{ textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{money(totals.paid)}</td>
                            <td className="table-td" style={{ textAlign: 'right', fontWeight: 800, color: '#0f172a' }}>{money(totals.total)}</td>
                            <td className="table-td" />
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    )
}

function AgentDetail({ agentId, agentName, onBack }: { agentId: string; agentName: string; onBack: () => void }) {
    const [cases, setCases] = useState<AgentCaseRow[] | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let active = true
        fetch(`/api/admin/property/earnings?agent=${agentId}`)
            .then(r => (r.ok ? r.json() : Promise.reject(new Error(`Request failed (${r.status})`))))
            .then(body => { if (active) { setCases((body.cases ?? []) as AgentCaseRow[]); setError(null) } })
            .catch(() => { if (active) setError('Could not load this agent’s cases. Please try again.') })
        return () => { active = false }
    }, [agentId])

    const total = (cases ?? []).reduce((acc, c) => acc + Number(c.agent_commission_amount ?? 0), 0)

    return (
        <div className="space-y-5">
            <div>
                <button onClick={onBack} className="text-xs font-semibold text-slate-500 hover:text-[#8b5cf6] flex items-center gap-1.5 mb-2">
                    <ArrowLeft size={13} /> All agents
                </button>
                <h1 className="text-2xl font-bold text-[#052d4a]">{agentName}</h1>
                <p className="text-sm text-slate-500 mt-1">
                    {cases ? `${cases.length} case${cases.length !== 1 ? 's' : ''} · ${money(total)} total commission` : 'Loading commission breakdown…'}
                </p>
            </div>

            {error && <div className="card p-4 flex items-center gap-2 text-red-600 text-sm"><AlertCircle size={16} />{error}</div>}

            {!cases && !error && <Skeleton height={320} radius={14} />}

            {cases && cases.length === 0 && (
                <EmptyState icon={DollarSign} iconColor="#8b5cf6" title="No commission yet"
                    description="This agent has no submitted cases carrying a commission amount." />
            )}

            {cases && cases.length > 0 && (
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                                    <th className="table-th">Client</th>
                                    <th className="table-th">Type</th>
                                    <th className="table-th">Status</th>
                                    <th className="table-th" style={{ textAlign: 'right' }}>Outstanding</th>
                                    <th className="table-th" style={{ textAlign: 'right' }}>Gross</th>
                                    <th className="table-th" style={{ textAlign: 'right' }}>Agent Share</th>
                                    <th className="table-th">Lock-in</th>
                                </tr>
                            </thead>
                            <tbody>
                                {cases.map(c => {
                                    const cfg = STATUS_CONFIG[c.commission_status]
                                    return (
                                        <tr key={c.id}>
                                            <td className="table-td" style={{ fontWeight: 600, color: '#0f172a' }}>{c.client_name}</td>
                                            <td className="table-td" style={{ color: '#475569' }}>{CASE_TYPE_LABELS[c.case_type] ?? c.case_type}</td>
                                            <td className="table-td">
                                                <span style={{
                                                    fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                                                    color: cfg?.color, background: cfg?.bg,
                                                }}>
                                                    {cfg?.label ?? c.commission_status}
                                                </span>
                                            </td>
                                            <td className="table-td" style={{ textAlign: 'right', color: '#475569' }}>
                                                {c.outstanding_loan_amount != null ? money(Number(c.outstanding_loan_amount)) : '—'}
                                            </td>
                                            <td className="table-td" style={{ textAlign: 'right', color: '#475569' }}>
                                                {c.gross_commission_amount != null ? money(Number(c.gross_commission_amount)) : '—'}
                                            </td>
                                            <td className="table-td" style={{ textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                                                {money(Number(c.agent_commission_amount ?? 0))}
                                            </td>
                                            <td className="table-td" style={{ color: '#64748b' }}>
                                                {c.lockin_confirmed_date ? formatDate(c.lockin_confirmed_date) : '—'}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}
