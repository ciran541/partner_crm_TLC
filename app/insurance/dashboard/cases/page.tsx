'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, Briefcase, ChevronDown, ArrowRight, AlertCircle, TrendingUp } from 'lucide-react'
import FilterPills from '@/components/shared/FilterPills'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { formatDate } from '@/lib/utils/formatDate'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { useCases } from '@/lib/insurance/useCases'
import { isDraftCase } from '@/lib/insurance/caseFilters'
import type { Case, PipelineStage } from '@/lib/types'

const PIPELINE_STAGES: PipelineStage[] = [
    'Touched Base',
    'Pending Docs',
    'Pending Approval',
    'Pending Signature',
    'Closed Won',
    'Closed Lost',
]

// "Active" = everything still in play (not closed). It's the default view.
const STATUS_PILL_OPTIONS = [
    { value: 'active', label: 'Active' },
    ...PIPELINE_STAGES.map(s => ({ value: s, label: s })),
]

// Potential revenue ≈ loan size × 0.15%.
const REVENUE_RATE = 0.0015

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

// Raw loan figure used for the loan column + potential revenue.
function caseLoanValue(c: Case): number {
    const amount = (c.case_type === 'Refinancing' || c.case_type === 'Equity Loan')
        ? c.existing_loan_amount
        : c.loan_size
    return amount ?? 0
}
function caseLoanAmount(c: Case) {
    const v = caseLoanValue(c)
    return v ? formatCurrency(v) : '—'
}

type DateMode = 'all' | 'range' | 'month'

const inputStyle: React.CSSProperties = {
    padding: '8px 12px',
    fontSize: 13,
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    background: 'white',
    color: '#0f172a',
    outline: 'none',
}

export default function CasesPage() {
    const router = useRouter()
    const { cases: allCases, isAdmin, loading, error } = useCases()

    const [stageFilter, setStageFilter] = useState('active')
    const [agentFilter, setAgentFilter] = useState('all')
    const [search, setSearch] = useState('')
    const [agentList, setAgentList] = useState<{ id: string; name: string }[]>([])

    // Date filter — by range or by month, both off "account / case creation date".
    const [dateMode, setDateMode] = useState<DateMode>('all')
    const [fromDate, setFromDate] = useState('')
    const [toDate, setToDate] = useState('')
    const [month, setMonth] = useState('')

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

    const pipelineCases = useMemo(() => allCases.filter(c => !isDraftCase(c)), [allCases])

    // Earliest creation date — drives the floor of the date pickers.
    const { earliestDay, earliestMonth, today, thisMonth } = useMemo(() => {
        const now = new Date()
        const todayStr = now.toISOString().slice(0, 10)
        let min = todayStr
        for (const c of pipelineCases) {
            const d = c.created_at.slice(0, 10)
            if (d < min) min = d
        }
        return { earliestDay: min, earliestMonth: min.slice(0, 7), today: todayStr, thisMonth: todayStr.slice(0, 7) }
    }, [pipelineCases])

    // Filter in memory — the full list is already cached, so changing any filter
    // is instant and never triggers a network request.
    const cases = useMemo(() => {
        const q = search.trim().toLowerCase()
        return pipelineCases.filter(c => {
            // Stage / Active
            if (stageFilter === 'active') {
                if (c.stage === 'Closed Won' || c.stage === 'Closed Lost') return false
            } else if (c.stage !== stageFilter) {
                return false
            }
            // Agent (admin only)
            if (agentFilter !== 'all' && c.created_by !== agentFilter) return false
            // Search — client name / mobile / email
            if (q) {
                const hay = `${c.client_name ?? ''} ${c.client_mobile ?? ''} ${c.client_email ?? ''}`.toLowerCase()
                if (!hay.includes(q)) return false
            }
            // Creation-date filter
            if (dateMode === 'range') {
                const created = c.created_at.slice(0, 10)
                if (fromDate && created < fromDate) return false
                if (toDate && created > toDate) return false
            } else if (dateMode === 'month') {
                if (month && c.created_at.slice(0, 7) !== month) return false
            }
            return true
        })
    }, [pipelineCases, stageFilter, agentFilter, search, dateMode, fromDate, toDate, month])

    const potentialRevenue = useMemo(
        () => cases.reduce((s, c) => s + caseLoanValue(c) * REVENUE_RATE, 0),
        [cases],
    )
    const loanVolume = useMemo(() => cases.reduce((s, c) => s + caseLoanValue(c), 0), [cases])

    const filterLabel = stageFilter === 'active' ? 'Active' : stageFilter
    const dateActive = dateMode !== 'all' && (dateMode === 'range' ? !!(fromDate || toDate) : !!month)
    const hasFilters = stageFilter !== 'active' || agentFilter !== 'all' || !!search || dateActive

    const resetFilters = () => {
        setStageFilter('active'); setAgentFilter('all'); setSearch('')
        setDateMode('all'); setFromDate(''); setToDate(''); setMonth('')
    }

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
                    onClick={() => router.push('/insurance/dashboard')}
                    className="btn-primary btn-lg"
                    style={{ flexShrink: 0 }}
                >
                    <Plus size={16} />
                    New Plan
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
                    <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
                        <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Client Name / Mobile / Email"
                            style={{ ...inputStyle, width: '100%', padding: '8px 12px 8px 34px' }}
                        />
                    </div>

                    {/* Date filter mode */}
                    <div style={{ position: 'relative' }}>
                        <select
                            value={dateMode}
                            onChange={e => { setDateMode(e.target.value as DateMode); setFromDate(''); setToDate(''); setMonth('') }}
                            style={{ ...inputStyle, appearance: 'none', padding: '8px 32px 8px 12px', color: '#475569', cursor: 'pointer' }}
                        >
                            <option value="all">All time</option>
                            <option value="range">Date range</option>
                            <option value="month">By month</option>
                        </select>
                        <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
                    </div>

                    {dateMode === 'range' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input type="date" value={fromDate} min={earliestDay} max={toDate || today}
                                onChange={e => setFromDate(e.target.value)} style={inputStyle} aria-label="From date" />
                            <span style={{ color: '#94a3b8', fontSize: 13 }}>to</span>
                            <input type="date" value={toDate} min={fromDate || earliestDay} max={today}
                                onChange={e => setToDate(e.target.value)} style={inputStyle} aria-label="To date" />
                        </div>
                    )}
                    {dateMode === 'month' && (
                        <input type="month" value={month} min={earliestMonth} max={thisMonth}
                            onChange={e => setMonth(e.target.value)} style={inputStyle} aria-label="Month" />
                    )}

                    {/* Admin agent filter */}
                    {isAdmin && (
                        <div style={{ position: 'relative' }}>
                            <select
                                value={agentFilter}
                                onChange={e => setAgentFilter(e.target.value)}
                                style={{ ...inputStyle, appearance: 'none', padding: '8px 32px 8px 12px', color: '#475569', cursor: 'pointer' }}
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
                            onClick={resetFilters}
                            style={{ fontSize: 12, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
                        >
                            Clear filters
                        </button>
                    )}
                </div>
            </div>

            {/* Potential revenue — reflects the current filter */}
            {!loading && !error && (
                <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14, background: 'linear-gradient(to right, #ecfeff, #f0f9ff)' }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: '#03a9e7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <TrendingUp size={20} color="white" />
                    </div>
                    <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Potential Revenue · {filterLabel}
                        </p>
                        <p style={{ fontSize: 24, fontWeight: 800, color: '#052d4a', lineHeight: 1.15 }}>
                            {formatCurrency(potentialRevenue)}
                        </p>
                        <p style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                            0.15% of {formatCurrency(loanVolume)} loan volume · {cases.length} case{cases.length !== 1 ? 's' : ''}
                        </p>
                    </div>
                </div>
            )}

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
                    action={hasFilters ? undefined : { label: 'Open Planner', onClick: () => router.push('/insurance/dashboard') }}
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
                                        <th className="table-th">Banker</th>
                                        <th className="table-th">Input / Follow-Up</th>
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
                                            <td className="table-td">
                                                {c.referred_bankers && c.referred_bankers.length > 0 ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                        {c.referred_bankers.map((b, i) => (
                                                            <span key={i} style={{ fontSize: 12, color: '#0f172a' }}>
                                                                {b.name} <span style={{ color: '#94a3b8' }}>· {b.bank}</span>
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                                            </td>
                                            <td className="table-td" style={{ fontSize: 12 }}>
                                                <div style={{ color: '#475569' }}>In: {formatDate(c.created_at)}</div>
                                                <div style={{ color: c.follow_up_date ? '#0369a1' : '#cbd5e1', marginTop: 2 }}>
                                                    FU: {c.follow_up_date ? formatDate(c.follow_up_date) : '—'}
                                                </div>
                                            </td>
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
                                    {c.client_mobile && <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{c.client_mobile}</p>}
                                    {isAdmin && c.profiles?.name && (
                                        <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Agent: {c.profiles.name}</p>
                                    )}
                                    {c.referred_bankers && c.referred_bankers.length > 0 && (
                                        <p style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>
                                            Banker: {c.referred_bankers.map(b => `${b.name} (${b.bank})`).join(', ')}
                                        </p>
                                    )}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: 12, color: '#94a3b8' }}>
                                            In: {formatDate(c.created_at)}{c.follow_up_date ? ` · FU: ${formatDate(c.follow_up_date)}` : ''}
                                        </span>
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
