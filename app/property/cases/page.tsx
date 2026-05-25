'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Briefcase, Plus, AlertCircle, ArrowRight, ChevronDown } from 'lucide-react'
import FilterPills from '@/components/shared/FilterPills'
import UrgencyBanner from '@/components/shared/UrgencyBanner'
import EmptyState from '@/components/shared/EmptyState'
import Spinner from '@/components/shared/Spinner'
import { formatDate } from '@/lib/utils/formatDate'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import type { PropertyCase, PropertyCaseStatus, PropertyCaseType } from '@/lib/types/property'

const STATUS_CONFIG: Record<PropertyCaseStatus, { label: string; color: string; bg: string }> = {
    draft: { label: 'Draft', color: '#64748b', bg: '#f1f5f9' },
    submitted: { label: 'Submitted', color: '#3b82f6', bg: '#eff6ff' },
    under_review: { label: 'Under Review', color: '#d97706', bg: '#fffbeb' },
    verified: { label: 'Verified', color: '#059669', bg: '#ecfdf5' },
    paid: { label: 'Paid', color: '#16a34a', bg: '#f0fdf4' },
    rejected: { label: 'Rejected', color: '#dc2626', bg: '#fef2f2' },
    on_hold: { label: 'On Hold', color: '#7c3aed', bg: '#f5f3ff' },
    opportunity_due: { label: 'Opportunity Due', color: '#ea580c', bg: '#fff7ed' },
}

const CASE_TYPE_LABELS: Record<PropertyCaseType, string> = {
    new_purchase: 'New Purchase',
    refinance: 'Refinance',
    decoupling: 'Decoupling',
    equity: 'Equity',
}

const STATUS_PILL_OPTIONS = [
    { value: '', label: 'All' },
    { value: 'draft', label: 'Draft' },
    { value: 'submitted', label: 'Submitted' },
    { value: 'under_review', label: 'Under Review' },
    { value: 'verified', label: 'Verified' },
    { value: 'paid', label: 'Paid' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'on_hold', label: 'On Hold' },
    { value: 'opportunity_due', label: 'Opportunity Due' },
]

interface CaseWithAgent extends Omit<PropertyCase, 'banks'> {
    banks?: { id: string; name: string } | null
    agent_name?: string | null
}

interface ApiResponse {
    data: CaseWithAgent[]
    count: number
    is_admin: boolean
}

function StatusBadge({ status }: { status: PropertyCaseStatus }) {
    const cfg = STATUS_CONFIG[status]
    return (
        <span
            className="status-badge"
            style={{ color: cfg.color, background: cfg.bg }}
        >
            {cfg.label}
        </span>
    )
}

export default function PropertyCasesPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [resp, setResp] = useState<ApiResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '')
    const [typeFilter, setTypeFilter] = useState('')

    useEffect(() => {
        setLoading(true)
        const params = new URLSearchParams({ limit: '200' })
        if (statusFilter) params.set('status', statusFilter)
        if (typeFilter) params.set('case_type', typeFilter)

        fetch(`/api/property/cases?${params}`)
            .then(r => r.json())
            .then(json => setResp(json))
            .catch(() => setError('Failed to load cases. Please refresh.'))
            .finally(() => setLoading(false))
    }, [statusFilter, typeFilter])

    const cases = resp?.data ?? []
    const isAdmin = resp?.is_admin ?? false
    const opportunityDueCount = cases.filter(c => c.status === 'opportunity_due').length

    const showUrgency = statusFilter === '' && opportunityDueCount > 0

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <h1 className="ios-page-title">Cases</h1>
                        {resp && (
                            <span style={{
                                fontSize: 12, fontWeight: 700, padding: '2px 8px',
                                borderRadius: 9999, background: '#f1f5f9', color: '#64748b',
                            }}>
                                {cases.length}
                            </span>
                        )}
                    </div>
                    <p className="page-subtitle">Track mortgage opportunities through to commission.</p>
                </div>
                <button
                    onClick={() => router.push('/property/cases/new')}
                    className="btn-emerald btn-lg"
                    style={{ flexShrink: 0 }}
                >
                    <Plus size={16} />
                    New Case
                </button>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <FilterPills
                    options={STATUS_PILL_OPTIONS}
                    value={statusFilter}
                    onChange={setStatusFilter}
                    accentColor="#059669"
                    scrollable
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ position: 'relative' }}>
                        <select
                            value={typeFilter}
                            onChange={e => setTypeFilter(e.target.value)}
                            style={{
                                appearance: 'none',
                                padding: '7px 32px 7px 12px',
                                fontSize: 13,
                                borderRadius: 8,
                                border: '1px solid #e2e8f0',
                                background: 'white',
                                color: '#475569',
                                outline: 'none',
                                cursor: 'pointer',
                            }}
                        >
                            <option value="">All Types</option>
                            {(Object.entries(CASE_TYPE_LABELS) as [PropertyCaseType, string][]).map(([v, label]) => (
                                <option key={v} value={v}>{label}</option>
                            ))}
                        </select>
                        <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
                    </div>
                    {(statusFilter || typeFilter) && (
                        <button
                            onClick={() => { setStatusFilter(''); setTypeFilter('') }}
                            style={{ fontSize: 12, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
                        >
                            Clear filters
                        </button>
                    )}
                </div>
            </div>

            {/* Urgency banner — only when viewing all */}
            {showUrgency && (
                <UrgencyBanner
                    count={opportunityDueCount}
                    onAction={() => setStatusFilter('opportunity_due')}
                    actionLabel="Filter Now"
                />
            )}

            {loading && (
                <div className="card" style={{ padding: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Spinner size="md" color="#059669" label="Loading cases…" />
                </div>
            )}

            {error && (
                <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, color: '#dc2626', fontSize: 14 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    {error}
                </div>
            )}

            {!loading && !error && cases.length === 0 && (
                <EmptyState
                    icon={Briefcase}
                    iconColor="#059669"
                    title={statusFilter || typeFilter ? 'No cases match filters' : 'No cases yet'}
                    description={
                        statusFilter || typeFilter
                            ? 'Try adjusting your filters to see more results.'
                            : 'Submit your first mortgage opportunity to start tracking commission.'
                    }
                    action={!statusFilter && !typeFilter ? { label: '+ Submit a Case', onClick: () => router.push('/property/cases/new') } : undefined}
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
                                        {isAdmin && <th className="table-th">Agent</th>}
                                        <th className="table-th">Client</th>
                                        <th className="table-th">Type</th>
                                        <th className="table-th">Status</th>
                                        <th className="table-th">Bank</th>
                                        <th className="table-th" style={{ textAlign: 'right' }}>Loan Amount</th>
                                        <th className="table-th" style={{ textAlign: 'right' }}>Commission</th>
                                        <th className="table-th">Lock-in</th>
                                        <th className="table-th">Created</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cases.map(c => {
                                        const isOpDue = c.status === 'opportunity_due'
                                        const isVerified = c.status === 'verified' || c.status === 'paid'
                                        return (
                                            <tr
                                                key={c.id}
                                                onClick={() => router.push(`/property/cases/${c.id}`)}
                                                style={{
                                                    cursor: 'pointer',
                                                    background: isOpDue ? 'rgba(255,247,237,0.7)' : isVerified ? 'rgba(240,253,244,0.5)' : undefined,
                                                    borderLeft: isOpDue ? '3px solid #f97316' : '3px solid transparent',
                                                    transition: 'background 0.15s',
                                                }}
                                                onMouseEnter={e => { if (!isOpDue && !isVerified) (e.currentTarget as HTMLElement).style.background = '#f8fafc' }}
                                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isOpDue ? 'rgba(255,247,237,0.7)' : isVerified ? 'rgba(240,253,244,0.5)' : '' }}
                                            >
                                                {isAdmin && (
                                                    <td className="table-td" style={{ fontWeight: 500, color: '#475569' }}>{c.agent_name ?? '—'}</td>
                                                )}
                                                <td className="table-td">
                                                    <p style={{ fontWeight: 600, color: '#0f172a' }}>{c.client_name}</p>
                                                    <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{c.client_mobile}</p>
                                                </td>
                                                <td className="table-td" style={{ color: '#475569' }}>{CASE_TYPE_LABELS[c.case_type]}</td>
                                                <td className="table-td"><StatusBadge status={c.status} /></td>
                                                <td className="table-td" style={{ color: '#475569' }}>{c.banks?.name ?? '—'}</td>
                                                <td className="table-td" style={{ textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                                                    {c.outstanding_loan_amount ? formatCurrency(c.outstanding_loan_amount) : '—'}
                                                </td>
                                                <td className="table-td" style={{ textAlign: 'right', fontWeight: 700, color: '#059669', fontSize: 15 }}>
                                                    {c.agent_commission_amount ? formatCurrency(c.agent_commission_amount) : '—'}
                                                </td>
                                                <td className="table-td" style={{ color: '#475569' }}>
                                                    {c.lockin_confirmed_date ? formatDate(c.lockin_confirmed_date) : '—'}
                                                </td>
                                                <td className="table-td" style={{ fontSize: 12, color: '#94a3b8' }}>{formatDate(c.created_at)}</td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ padding: '10px 16px', borderTop: '1px solid #f1f5f9', fontSize: 12, color: '#94a3b8' }}>
                            {cases.length} case{cases.length !== 1 ? 's' : ''}
                        </div>
                    </div>

                    {/* Mobile card list */}
                    <div className="md:hidden" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {cases.map(c => {
                            const isOpDue = c.status === 'opportunity_due'
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => router.push(`/property/cases/${c.id}`)}
                                    className="card"
                                    style={{
                                        padding: '18px 20px',
                                        textAlign: 'left',
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: 14,
                                        width: '100%',
                                        background: 'none',
                                        borderLeft: isOpDue ? '3px solid #f97316' : undefined,
                                        cursor: 'pointer',
                                    }}
                                >
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 5 }}>
                                            <p style={{ fontWeight: 700, color: '#0f172a', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {c.client_name}
                                            </p>
                                            <StatusBadge status={c.status} />
                                        </div>
                                        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>
                                            {CASE_TYPE_LABELS[c.case_type]}{c.banks?.name ? ` · ${c.banks.name}` : ''}
                                        </p>
                                        {isAdmin && c.agent_name && (
                                            <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Agent: {c.agent_name}</p>
                                        )}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: 12, color: '#94a3b8' }}>{formatDate(c.created_at)}</span>
                                            {c.agent_commission_amount ? (
                                                <span style={{ fontSize: 16, fontWeight: 800, color: '#059669', letterSpacing: '-0.02em' }}>
                                                    {formatCurrency(c.agent_commission_amount)}
                                                </span>
                                            ) : c.outstanding_loan_amount ? (
                                                <span style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>
                                                    {formatCurrency(c.outstanding_loan_amount)}
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>
                                    <ArrowRight size={16} color="#cbd5e1" style={{ flexShrink: 0, marginTop: 4 }} />
                                </button>
                            )
                        })}
                    </div>
                </>
            )}
        </div>
    )
}
