'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, Briefcase, ChevronDown, ArrowRight, AlertCircle } from 'lucide-react'
import FilterPills from '@/components/shared/FilterPills'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { formatDate } from '@/lib/utils/formatDate'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { useCases } from '@/lib/insurance/useCases'
import type { Case, PipelineStage } from '@/lib/types'

const PIPELINE_STAGES: PipelineStage[] = [
    'Touched Base',
    'Proposal Given',
    'Referred to Bank',
    'Pending Approval',
    'Pending Signature',
    'Closed Won',
    'Closed Lost',
]

const STATUS_PILL_OPTIONS = [
    { value: '', label: 'All' },
    ...PIPELINE_STAGES.map(s => ({ value: s, label: s })),
]

const STAGE_BADGE: Record<string, { bg: string; text: string }> = {
    'Closed Won': { bg: '#d1fae5', text: '#065f46' },
    'Closed Lost': { bg: '#fee2e2', text: '#991b1b' },
    'Pending Approval': { bg: '#fff7ed', text: '#9a3412' },
    'Pending Signature': { bg: '#fef3c7', text: '#92400e' },
}
const DEFAULT_STAGE_BADGE = { bg: '#e0f2fe', text: '#0369a1' }

function StageBadge({ stage }: { stage: string }) {
    const cfg = STAGE_BADGE[stage] ?? DEFAULT_STAGE_BADGE
    return <span className="status-badge" style={{ color: cfg.text, background: cfg.bg }}>{stage}</span>
}

function caseLoanAmount(c: Case) {
    const amount = (c.case_type === 'Refinancing' || c.case_type === 'Equity Loan')
        ? c.existing_loan_amount
        : c.loan_size
    return amount ? formatCurrency(amount) : '—'
}

export default function CasesPage() {
    const router = useRouter()
    const { cases: allCases, isAdmin, loading, error } = useCases()

    const [stageFilter, setStageFilter] = useState('')
    const [agentFilter, setAgentFilter] = useState('all')
    const [search, setSearch] = useState('')
    const [agentList, setAgentList] = useState<{ id: string; name: string }[]>([])

    // Admin-only: load the full agent roster for the agent filter. Gated on
    // isAdmin so the agent path never makes this call.
    useEffect(() => {
        if (!isAdmin) return
        let active = true
        fetch('/api/admin/get-profiles')
            .then(res => (res.ok ? res.json() : []))
            .then(profiles => {
                if (active && Array.isArray(profiles)) {
                    setAgentList(profiles.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
                }
            })
            .catch(() => { /* non-fatal: filter just won't populate */ })
        return () => { active = false }
    }, [isAdmin])

    // Filter in memory — the full list is already cached, so changing any filter
    // is instant and never triggers a network request.
    const cases = useMemo(() => {
        const q = search.trim().toLowerCase()
        return allCases.filter(c =>
            (!stageFilter || c.stage === stageFilter) &&
            (agentFilter === 'all' || c.created_by === agentFilter) &&
            (!q || (c.client_name ?? '').toLowerCase().includes(q) || (c.client_mobile ?? '').toLowerCase().includes(q))
        )
    }, [allCases, stageFilter, agentFilter, search])

    const hasFilters = !!stageFilter || agentFilter !== 'all' || !!search

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <h1 className="ios-page-title">Cases</h1>
                        {!loading && (
                            <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: '#f1f5f9', color: '#64748b' }}>
                                {cases.length}
                            </span>
                        )}
                    </div>
                    <p className="page-subtitle">Track your cases through the pipeline.</p>
                </div>
                <button
                    onClick={() => router.push('/insurance/dashboard/cases/new')}
                    className="btn-primary btn-lg"
                    style={{ flexShrink: 0 }}
                >
                    <Plus size={16} />
                    Create Case
                </button>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <FilterPills
                    options={STATUS_PILL_OPTIONS}
                    value={stageFilter}
                    onChange={setStageFilter}
                    accentColor="#03a9e7"
                    scrollable
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {/* Search */}
                    <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
                        <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search by client name…"
                            style={{
                                width: '100%',
                                padding: '8px 12px 8px 34px',
                                fontSize: 13,
                                borderRadius: 8,
                                border: '1px solid #e2e8f0',
                                background: 'white',
                                color: '#0f172a',
                                outline: 'none',
                            }}
                        />
                    </div>

                    {/* Admin agent filter */}
                    {isAdmin && (
                        <div style={{ position: 'relative' }}>
                            <select
                                value={agentFilter}
                                onChange={e => setAgentFilter(e.target.value)}
                                style={{
                                    appearance: 'none',
                                    padding: '8px 32px 8px 12px',
                                    fontSize: 13,
                                    borderRadius: 8,
                                    border: '1px solid #e2e8f0',
                                    background: 'white',
                                    color: '#475569',
                                    outline: 'none',
                                    cursor: 'pointer',
                                }}
                            >
                                <option value="all">All Agents</option>
                                {agentList.map(a => (
                                    <option key={a.id} value={a.id}>{a.name}</option>
                                ))}
                            </select>
                            <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
                        </div>
                    )}

                    {hasFilters && (
                        <button
                            onClick={() => { setStageFilter(''); setAgentFilter('all'); setSearch('') }}
                            style={{ fontSize: 12, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
                        >
                            Clear filters
                        </button>
                    )}
                </div>
            </div>

            {loading && (
                <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} height={48} radius={10} />)}
                </div>
            )}

            {error && !loading && (
                <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, color: '#dc2626', fontSize: 14 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    {error}
                </div>
            )}

            {!loading && !error && cases.length === 0 && (
                <EmptyState
                    icon={Briefcase}
                    iconColor="#03a9e7"
                    title={hasFilters ? 'No cases match filters' : 'No cases yet'}
                    description={hasFilters
                        ? 'Try adjusting your filters to see more results.'
                        : 'Create your first case to start tracking your pipeline.'}
                    action={hasFilters ? undefined : { label: '+ Create a Case', onClick: () => router.push('/insurance/dashboard/cases/new') }}
                />
            )}

            {!loading && !error && cases.length > 0 && (
                <>
                    {/* Desktop table */}
                    <div className="hidden md:block card" style={{ overflow: 'hidden' }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                                        <th className="table-th">Client</th>
                                        {isAdmin && <th className="table-th">Agent</th>}
                                        <th className="table-th">Type</th>
                                        <th className="table-th" style={{ textAlign: 'right' }}>Loan Amount</th>
                                        <th className="table-th">Stage</th>
                                        <th className="table-th">Last Updated</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cases.map(c => (
                                        <tr
                                            key={c.id}
                                            onClick={() => router.push(`/insurance/dashboard/cases/${c.id}`)}
                                            style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                                            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#f8fafc')}
                                            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = '')}
                                        >
                                            <td className="table-td">
                                                <p style={{ fontWeight: 600, color: '#0f172a' }}>
                                                    {c.client_name || <span style={{ color: '#94a3b8', fontStyle: 'italic', fontWeight: 400 }}>Unnamed</span>}
                                                </p>
                                                {c.client_mobile && <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{c.client_mobile}</p>}
                                            </td>
                                            {isAdmin && (
                                                <td className="table-td" style={{ color: '#475569' }}>{c.profiles?.name || 'Unknown Agent'}</td>
                                            )}
                                            <td className="table-td" style={{ color: '#475569' }}>{c.case_type}</td>
                                            <td className="table-td" style={{ textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>{caseLoanAmount(c)}</td>
                                            <td className="table-td"><StageBadge stage={c.stage} /></td>
                                            <td className="table-td" style={{ fontSize: 12, color: '#94a3b8' }}>{formatDate(c.updated_at)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ padding: '10px 16px', borderTop: '1px solid #f1f5f9', fontSize: 12, color: '#94a3b8' }}>
                            {cases.length} case{cases.length !== 1 ? 's' : ''}
                        </div>
                    </div>

                    {/* Mobile card list */}
                    <div className="md:hidden flex flex-col gap-2.5">
                        {cases.map(c => (
                            <button
                                key={c.id}
                                onClick={() => router.push(`/insurance/dashboard/cases/${c.id}`)}
                                className="card"
                                style={{
                                    padding: '18px 20px', textAlign: 'left',
                                    display: 'flex', alignItems: 'flex-start', gap: 14,
                                    width: '100%', background: 'none', cursor: 'pointer',
                                }}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 5 }}>
                                        <p style={{ fontWeight: 700, color: '#0f172a', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {c.client_name || 'Unnamed'}
                                        </p>
                                        <StageBadge stage={c.stage} />
                                    </div>
                                    <p style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>{c.case_type}</p>
                                    {isAdmin && c.profiles?.name && (
                                        <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Agent: {c.profiles.name}</p>
                                    )}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: 12, color: '#94a3b8' }}>{formatDate(c.updated_at)}</span>
                                        <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{caseLoanAmount(c)}</span>
                                    </div>
                                </div>
                                <ArrowRight size={16} color="#cbd5e1" style={{ flexShrink: 0, marginTop: 4 }} />
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}
