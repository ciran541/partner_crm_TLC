'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DollarSign, AlertCircle, ArrowRight } from 'lucide-react'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import { formatDate } from '@/lib/utils/formatDate'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { useCases } from '@/lib/property/useCases'
import type { PropertyCase, PropertyCaseType, PropertyCommissionStatus } from '@/lib/types/property'

const CASE_TYPE_LABELS: Record<PropertyCaseType, string> = {
    new_purchase: 'New Purchase',
    refinance: 'Refinance',
    decoupling: 'Decoupling',
    equity: 'Equity',
}

const COMMISSION_STATUS_CONFIG: Record<PropertyCommissionStatus, { label: string; color: string; bg: string; dot: string }> = {
    pending:   { label: 'Pending',   color: '#d97706', bg: '#fffbeb', dot: '#f59e0b' },
    confirmed: { label: 'Confirmed', color: '#2563eb', bg: '#eff6ff', dot: '#3b82f6' },
    paid:      { label: 'Paid',      color: '#16a34a', bg: '#f0fdf4', dot: '#22c55e' },
}

type Tab = 'all' | PropertyCommissionStatus

function sum(cases: PropertyCase[], status?: PropertyCommissionStatus): number {
    return cases
        .filter(c => c.agent_commission_amount != null && (status ? c.commission_status === status : true))
        .reduce((acc, c) => acc + (c.agent_commission_amount ?? 0), 0)
}

function countByStatus(cases: PropertyCase[], status: PropertyCommissionStatus): number {
    return cases.filter(c => c.agent_commission_amount != null && c.commission_status === status).length
}

export default function PropertyEarningsPage() {
    const router = useRouter()
    const { cases, loading, error } = useCases()
    const [tab, setTab] = useState<Tab>('all')

    const withCommission = cases.filter(c => c.agent_commission_amount != null)

    const totalPortfolio = sum(withCommission)
    const totalPending   = sum(withCommission, 'pending')
    const totalConfirmed = sum(withCommission, 'confirmed')
    const totalPaid      = sum(withCommission, 'paid')

    const filtered = tab === 'all'
        ? withCommission
        : withCommission.filter(c => c.commission_status === tab)

    const tabs: { key: Tab; label: string; count?: number }[] = [
        { key: 'all',       label: 'All',       count: withCommission.length },
        { key: 'pending',   label: 'Pending',   count: countByStatus(withCommission, 'pending') },
        { key: 'confirmed', label: 'Confirmed', count: countByStatus(withCommission, 'confirmed') },
        { key: 'paid',      label: 'Paid',      count: countByStatus(withCommission, 'paid') },
    ]

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header */}
            <div>
                <h1 className="ios-page-title">Earnings</h1>
                <p className="page-subtitle">Your commission breakdown across all submitted cases.</p>
            </div>

            {loading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} className="lg:grid-cols-[1.5fr_1fr]">
                        <Skeleton height={140} radius={14} />
                        <Skeleton height={140} radius={14} />
                    </div>
                    <Skeleton height={300} radius={14} />
                </div>
            )}

            {error && (
                <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, color: '#dc2626', fontSize: 14 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />{error}
                </div>
            )}

            {!loading && !error && (
                <>
                    {/* Hero earnings row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} className="lg:grid-cols-[1.5fr_1fr]">
                        {/* Total portfolio hero */}
                        <div className="card" style={{ padding: '32px 28px' }}>
                            <p className="metric-label" style={{ color: '#059669', marginBottom: 12 }}>Total Portfolio</p>
                            <p style={{
                                fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 800,
                                color: '#0f172a', letterSpacing: '-0.04em', lineHeight: 1,
                            }}>
                                {formatCurrency(totalPortfolio)}
                            </p>
                            <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 10 }}>
                                {withCommission.length} case{withCommission.length !== 1 ? 's' : ''} with commission
                            </p>
                        </div>

                        {/* Breakdown card */}
                        <div className="card" style={{ padding: '24px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16 }}>
                            {([
                                { label: 'Pending',   value: totalPending,   dot: '#f59e0b', textColor: '#d97706' },
                                { label: 'Confirmed', value: totalConfirmed, dot: '#3b82f6', textColor: '#2563eb' },
                                { label: 'Paid Out',  value: totalPaid,      dot: '#22c55e', textColor: '#16a34a' },
                            ] as const).map(({ label, value, dot, textColor }) => (
                                <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                                        <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>{label}</span>
                                    </div>
                                    <span style={{ fontSize: 16, fontWeight: 700, color: textColor, letterSpacing: '-0.01em' }}>
                                        {formatCurrency(value)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {withCommission.length === 0 ? (
                        <EmptyState
                            icon={DollarSign}
                            iconColor="#059669"
                            title="No commission data yet"
                            description="Submit a case with an outstanding loan amount to see commission estimates here."
                            action={{ label: 'Submit a Case', onClick: () => router.push('/property/cases/new') }}
                        />
                    ) : (
                        <div className="card" style={{ overflow: 'hidden' }}>
                            {/* Tabs */}
                            <div className="scroll-x" style={{ display: 'flex', borderBottom: '1px solid #f1f5f9', padding: '0 16px', gap: 4 }}>
                                {tabs.map(t => {
                                    const active = tab === t.key
                                    return (
                                        <button
                                            key={t.key}
                                            onClick={() => setTab(t.key)}
                                            style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 7,
                                                padding: '13px 16px', fontSize: 14,
                                                fontWeight: active ? 700 : 500,
                                                color: active ? '#059669' : '#64748b',
                                                borderBottom: active ? '2px solid #059669' : '2px solid transparent',
                                                marginBottom: -1, background: 'none', border: 'none',
                                                cursor: 'pointer', whiteSpace: 'nowrap',
                                                transition: 'color 0.15s',
                                            }}
                                        >
                                            {t.label}
                                            {t.count !== undefined && (
                                                <span style={{
                                                    fontSize: 11, fontWeight: 700,
                                                    padding: '2px 6px', borderRadius: 9999,
                                                    background: active ? '#d1fae5' : '#f1f5f9',
                                                    color: active ? '#065f46' : '#64748b',
                                                }}>
                                                    {t.count}
                                                </span>
                                            )}
                                        </button>
                                    )
                                })}
                            </div>

                            {filtered.length === 0 ? (
                                <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: 14, color: '#94a3b8' }}>
                                    No {tab === 'all' ? '' : tab} commissions.
                                </div>
                            ) : (
                                <>
                                    {/* Desktop table */}
                                    <div className="hidden md:block" style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                                                    <th className="table-th">Client</th>
                                                    <th className="table-th">Type</th>
                                                    <th className="table-th" style={{ textAlign: 'right' }}>Loan Amount</th>
                                                    <th className="table-th" style={{ textAlign: 'right' }}>Gross</th>
                                                    <th className="table-th" style={{ textAlign: 'right' }}>Your Share</th>
                                                    <th className="table-th">Status</th>
                                                    <th className="table-th">Submitted</th>
                                                    <th className="table-th" />
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filtered.map(c => {
                                                    const cfg = COMMISSION_STATUS_CONFIG[c.commission_status]
                                                    return (
                                                        <tr
                                                            key={c.id}
                                                            onClick={() => router.push(`/property/cases/${c.id}`)}
                                                            style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                                                            onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                                            onMouseLeave={e => (e.currentTarget.style.background = '')}
                                                        >
                                                            <td className="table-td">
                                                                <p style={{ fontWeight: 600, color: '#0f172a' }}>{c.client_name}</p>
                                                            </td>
                                                            <td className="table-td" style={{ color: '#475569' }}>{CASE_TYPE_LABELS[c.case_type]}</td>
                                                            <td className="table-td" style={{ textAlign: 'right', color: '#475569' }}>
                                                                {c.outstanding_loan_amount ? formatCurrency(c.outstanding_loan_amount) : '—'}
                                                            </td>
                                                            <td className="table-td" style={{ textAlign: 'right', color: '#475569' }}>
                                                                {formatCurrency(c.gross_commission_amount)}
                                                            </td>
                                                            <td className="table-td" style={{ textAlign: 'right', fontWeight: 800, color: '#059669', fontSize: 16 }}>
                                                                {formatCurrency(c.agent_commission_amount)}
                                                            </td>
                                                            <td className="table-td">
                                                                <span
                                                                    className="status-badge"
                                                                    style={{ color: cfg.color, background: cfg.bg }}
                                                                >
                                                                    {cfg.label}
                                                                </span>
                                                            </td>
                                                            <td className="table-td" style={{ fontSize: 12, color: '#94a3b8' }}>{formatDate(c.created_at)}</td>
                                                            <td className="table-td">
                                                                <ArrowRight size={14} color="#d1d5db" />
                                                            </td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Mobile cards */}
                                    <div className="md:hidden" style={{ borderTop: '1px solid #f1f5f9' }}>
                                        {filtered.map(c => {
                                            const cfg = COMMISSION_STATUS_CONFIG[c.commission_status]
                                            return (
                                                <button
                                                    key={c.id}
                                                    onClick={() => router.push(`/property/cases/${c.id}`)}
                                                    className="pressable"
                                                    style={{
                                                        width: '100%', padding: '16px', textAlign: 'left',
                                                        background: 'none', border: 'none', cursor: 'pointer',
                                                        borderBottom: '1px solid #f8fafc',
                                                    }}
                                                    onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                                >
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                                                        <p style={{ fontWeight: 700, color: '#0f172a', fontSize: 15 }}>{c.client_name}</p>
                                                        <span className="status-badge" style={{ color: cfg.color, background: cfg.bg, flexShrink: 0 }}>
                                                            {cfg.label}
                                                        </span>
                                                    </div>
                                                    <p style={{ fontSize: 13, color: '#64748b', marginBottom: 10 }}>
                                                        {CASE_TYPE_LABELS[c.case_type]} · {formatDate(c.created_at)}
                                                    </p>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <span style={{ fontSize: 12, color: '#94a3b8' }}>Your Share</span>
                                                        <span style={{ fontSize: 18, fontWeight: 800, color: '#059669', letterSpacing: '-0.02em' }}>
                                                            {formatCurrency(c.agent_commission_amount)}
                                                        </span>
                                                    </div>
                                                </button>
                                            )
                                        })}
                                    </div>

                                    {/* Sticky footer total */}
                                    <div
                                        style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '12px 20px', borderTop: '1px solid #f1f5f9',
                                            background: '#f8fafc', position: 'sticky', bottom: 0,
                                        }}
                                    >
                                        <p style={{ fontSize: 12, color: '#94a3b8' }}>
                                            {filtered.length} case{filtered.length !== 1 ? 's' : ''}
                                        </p>
                                        <p style={{ fontSize: 15, fontWeight: 800, color: '#059669' }}>
                                            {formatCurrency(sum(filtered))} total
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
