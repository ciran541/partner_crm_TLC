'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
    Briefcase, BadgeCheck, Clock, ArrowRight, AlertCircle,
    Plus, Activity, DollarSign,
} from 'lucide-react'
import StatsCard from '@/components/shared/StatsCard'
import CommissionHero from '@/components/property/CommissionHero'
import UrgencyBanner from '@/components/shared/UrgencyBanner'
import Spinner from '@/components/shared/Spinner'
import EmptyState from '@/components/shared/EmptyState'
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

const INACTIVE_STATUSES: PropertyCaseStatus[] = ['paid', 'rejected']

function computeStats(cases: PropertyCase[]) {
    const today = new Date()
    const in90Days = new Date(today)
    in90Days.setDate(in90Days.getDate() + 90)

    return {
        total: cases.length,
        active: cases.filter(c => !INACTIVE_STATUSES.includes(c.status)).length,
        verified: cases.filter(c => c.status === 'verified').length,
        expiring: cases.filter(c => {
            const dateStr = c.lockin_confirmed_date
            if (!dateStr) return false
            const d = new Date(dateStr)
            return d >= today && d <= in90Days
        }).length,
        opportunityDue: cases.filter(c => c.status === 'opportunity_due').length,
    }
}

function computeEarnings(cases: PropertyCase[]) {
    const relevant = cases.filter(c => c.agent_commission_amount)
    return {
        total: relevant.reduce((sum, c) => sum + (c.agent_commission_amount ?? 0), 0),
        pending: cases.filter(c => c.commission_status === 'pending').reduce((sum, c) => sum + (c.agent_commission_amount ?? 0), 0),
        confirmed: cases.filter(c => c.commission_status === 'confirmed').reduce((sum, c) => sum + (c.agent_commission_amount ?? 0), 0),
        paid: cases.filter(c => c.commission_status === 'paid').reduce((sum, c) => sum + (c.agent_commission_amount ?? 0), 0),
    }
}

export default function PropertyDashboardPage() {
    const router = useRouter()
    const [cases, setCases] = useState<PropertyCase[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        fetch('/api/property/cases?limit=100')
            .then(r => r.json())
            .then(json => setCases(json.data ?? []))
            .catch(() => setError('Failed to load dashboard data.'))
            .finally(() => setLoading(false))
    }, [])

    const stats = computeStats(cases)
    const earnings = computeEarnings(cases)
    const recentCases = cases.slice(0, 5)

    // Greeting
    const hour = new Date().getHours()
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            {/* Page header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                <div>
                    <h1 style={{ fontSize: 24, fontWeight: 700, color: '#052d4a', lineHeight: 1.2 }}>{greeting}</h1>
                    <p style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>Here&apos;s your case and earnings overview.</p>
                </div>
                <button
                    onClick={() => router.push('/property/cases/new')}
                    className="btn-emerald btn-sm"
                    style={{ flexShrink: 0 }}
                >
                    <Plus size={15} />
                    New Case
                </button>
            </div>

            {loading && (
                <div className="card" style={{ padding: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Spinner size="md" color="#059669" label="Loading your dashboard…" />
                </div>
            )}

            {error && (
                <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10, color: '#dc2626', fontSize: 14 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    {error}
                </div>
            )}

            {!loading && !error && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {/* Commission Hero — money first */}
                    <CommissionHero
                        total={earnings.total}
                        pending={earnings.pending}
                        confirmed={earnings.confirmed}
                        paid={earnings.paid}
                        onViewEarnings={() => router.push('/property/earnings')}
                    />

                    {/* Stats grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}
                        className="lg:grid-cols-4">
                        <StatsCard
                            title="Active Cases"
                            value={stats.active}
                            icon={Activity}
                            color="#03a9e7"
                            onClick={() => router.push('/property/cases')}
                        />
                        <StatsCard
                            title="Verified"
                            value={stats.verified}
                            icon={BadgeCheck}
                            color="#059669"
                            onClick={() => router.push('/property/cases?status=verified')}
                        />
                        <StatsCard
                            title="Lock-ins Expiring"
                            value={stats.expiring}
                            icon={Clock}
                            color="#f59e0b"
                            subtitle="within 90 days"
                            variant="alert"
                        />
                        <StatsCard
                            title="Total Cases"
                            value={stats.total}
                            icon={Briefcase}
                            color="#94a3b8"
                            onClick={() => router.push('/property/cases')}
                        />
                    </div>

                    {/* Urgency banner */}
                    <UrgencyBanner
                        count={stats.opportunityDue}
                        onAction={() => router.push('/property/cases?status=opportunity_due')}
                        actionLabel="View Cases"
                    />

                    {/* Bottom two-column */}
                    <div style={{ display: 'grid', gap: 20 }} className="lg:grid-cols-3">
                        {/* Recent Cases */}
                        <div className="card lg:col-span-2" style={{ padding: 24 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                                <span className="section-label">Recent Cases</span>
                                <button
                                    onClick={() => router.push('/property/cases')}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 5,
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        color: '#059669', fontSize: 12, fontWeight: 600,
                                    }}
                                >
                                    View all <ArrowRight size={12} />
                                </button>
                            </div>

                            {recentCases.length === 0 ? (
                                <EmptyState
                                    icon={Briefcase}
                                    iconColor="#059669"
                                    title="No cases yet"
                                    description="Submit your first mortgage case to start tracking your commission."
                                    action={{ label: 'Submit First Case', onClick: () => router.push('/property/cases/new') }}
                                />
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    {recentCases.map(c => {
                                        const badge = STATUS_CONFIG[c.status]
                                        return (
                                            <button
                                                key={c.id}
                                                onClick={() => router.push(`/property/cases/${c.id}`)}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 12,
                                                    padding: '10px 12px', borderRadius: 10,
                                                    background: 'none', border: 'none', cursor: 'pointer',
                                                    textAlign: 'left', width: '100%',
                                                    transition: 'background 0.15s',
                                                }}
                                                onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                            >
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <p style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {c.client_name}
                                                    </p>
                                                    <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                                                        {CASE_TYPE_LABELS[c.case_type]} · {formatDate(c.created_at)}
                                                    </p>
                                                </div>
                                                {c.agent_commission_amount ? (
                                                    <p style={{ fontSize: 15, fontWeight: 700, color: '#059669', flexShrink: 0 }}>
                                                        {formatCurrency(c.agent_commission_amount)}
                                                    </p>
                                                ) : null}
                                                <span
                                                    className="status-badge"
                                                    style={{ color: badge.color, background: badge.bg, flexShrink: 0 }}
                                                >
                                                    {badge.label}
                                                </span>
                                                <ArrowRight size={14} color="#cbd5e1" style={{ flexShrink: 0 }} />
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Quick actions */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            <div
                                className="card"
                                style={{
                                    padding: 24,
                                    background: 'linear-gradient(135deg, #059669 0%, #065f46 100%)',
                                    display: 'flex', flexDirection: 'column', gap: 16,
                                }}
                            >
                                <div style={{
                                    width: 42, height: 42, borderRadius: 11,
                                    background: 'rgba(255,255,255,0.18)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <Plus size={20} color="white" />
                                </div>
                                <div>
                                    <h3 style={{ fontSize: 15, fontWeight: 700, color: 'white' }}>Submit a New Case</h3>
                                    <p style={{ fontSize: 13, color: '#d1fae5', marginTop: 5, lineHeight: 1.5 }}>
                                        Upload a mortgage opportunity to start tracking commission.
                                    </p>
                                </div>
                                <button
                                    onClick={() => router.push('/property/cases/new')}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                        width: '100%', padding: '10px 0', borderRadius: 9,
                                        background: 'white', color: '#065f46',
                                        fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer',
                                        transition: 'background 0.15s',
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#ecfdf5')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                                >
                                    New Case <ArrowRight size={14} />
                                </button>
                            </div>

                            <button
                                onClick={() => router.push('/property/earnings')}
                                className="card"
                                style={{
                                    padding: '18px 20px',
                                    display: 'flex', alignItems: 'center', gap: 14,
                                    background: 'none', border: '1px solid #e2e8f0',
                                    cursor: 'pointer', textAlign: 'left', width: '100%',
                                    transition: 'box-shadow 0.2s',
                                }}
                            >
                                <div style={{
                                    width: 38, height: 38, borderRadius: 10,
                                    background: '#f0fdf4',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                }}>
                                    <DollarSign size={18} color="#059669" />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <p style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>View Earnings</p>
                                    <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Track all your commission payouts</p>
                                </div>
                                <ArrowRight size={14} color="#cbd5e1" />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
