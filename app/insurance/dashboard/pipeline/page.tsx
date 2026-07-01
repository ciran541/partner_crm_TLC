'use client'

import { useRouter } from 'next/navigation'
import {
    Plus, Briefcase, TrendingUp, Clock, ChevronRight,
    AlertTriangle, AlertCircle, ArrowRight, DollarSign,
} from 'lucide-react'
import StatsCard from '@/components/shared/StatsCard'
import UrgencyBanner from '@/components/shared/UrgencyBanner'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import { formatDate } from '@/lib/utils/formatDate'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { useCases } from '@/lib/insurance/useCases'
import { isDraftCase } from '@/lib/insurance/caseFilters'
import { commissionTotals } from '@/lib/insurance/commission'
import type { Case } from '@/lib/types'

const PLANNER_ROUTE = '/insurance/dashboard'

const STAGE_BADGE: Record<string, { bg: string; text: string }> = {
    'Closed Won': { bg: '#d1fae5', text: '#065f46' },
    'Closed Lost': { bg: '#fee2e2', text: '#991b1b' },
    'Pending Approval': { bg: '#fff7ed', text: '#9a3412' },
    'Pending Signature': { bg: '#fef3c7', text: '#92400e' },
}
const DEFAULT_STAGE_BADGE = { bg: '#e0f2fe', text: '#0369a1' }

function stageBadge(stage: string) {
    return STAGE_BADGE[stage] ?? DEFAULT_STAGE_BADGE
}

function computeStats(cases: Case[]) {
    const now = new Date()
    const in90Days = new Date(now)
    in90Days.setDate(now.getDate() + 90)

    return {
        total: cases.length,
        active: cases.filter(c => c.stage !== 'Closed Won' && c.stage !== 'Closed Lost').length,
        closedWon: cases.filter(c => c.stage === 'Closed Won').length,
        upcomingLockIns: cases.filter(c => {
            if (!c.lock_in_end_date || c.stage === 'Closed Lost') return false
            const d = new Date(c.lock_in_end_date)
            return d >= now && d <= in90Days
        }).length,
    }
}

export default function PipelineDashboard() {
    const router = useRouter()
    const { cases: allCases, loading, error } = useCases()

    // Drafts (planner sessions with no client yet) stay out of the pipeline view.
    const cases = allCases.filter(c => !isDraftCase(c))
    const stats = computeStats(cases)
    const comm = commissionTotals(cases)
    const recentCases = cases.slice(0, 5)

    const hour = new Date().getHours()
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                    <h1 className="ios-page-title">{greeting}</h1>
                    <p className="page-subtitle">Here&apos;s your pipeline overview.</p>
                </div>
                <button
                    onClick={() => router.push(PLANNER_ROUTE)}
                    className="btn-primary btn-sm"
                    style={{ flexShrink: 0 }}
                >
                    <Plus size={15} />
                    New Plan
                </button>
            </div>

            {loading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }} className="lg:grid-cols-4">
                        {[0, 1, 2, 3].map(i => <Skeleton key={i} height={104} radius={14} />)}
                    </div>
                    <div style={{ display: 'grid', gap: 20 }} className="lg:grid-cols-2">
                        <Skeleton height={300} radius={14} />
                        <Skeleton height={300} radius={14} />
                    </div>
                </div>
            )}

            {error && !loading && (
                <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10, color: '#dc2626', fontSize: 14 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    {error}
                </div>
            )}

            {!loading && !error && (
                <>
                    {/* Stats grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }} className="lg:grid-cols-4">
                        <StatsCard
                            title="Total Cases"
                            value={stats.total}
                            icon={Briefcase}
                            color="#03a9e7"
                            onClick={() => router.push('/insurance/dashboard/cases')}
                        />
                        <StatsCard
                            title="Active Pipeline"
                            value={stats.active}
                            icon={Clock}
                            color="#f59e0b"
                            onClick={() => router.push('/insurance/dashboard/cases')}
                        />
                        <StatsCard
                            title="Closed Won"
                            value={stats.closedWon}
                            icon={TrendingUp}
                            color="#10b981"
                        />
                        <StatsCard
                            title="Upcoming Lock-ins"
                            value={stats.upcomingLockIns}
                            icon={AlertTriangle}
                            color="#f59e0b"
                            subtitle="within 90 days"
                            variant="alert"
                            onClick={() => router.push('/insurance/dashboard/cases/lock-in-end')}
                        />
                    </div>

                    {/* Commission summary */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 1fr)', gap: 14 }} className="sm:grid-cols-3">
                        <StatsCard
                            title="Open Commission"
                            value={formatCurrency(comm.open)}
                            icon={DollarSign}
                            color="#0369a1"
                            variant="money"
                            subtitle={`${comm.activeCases} active case${comm.activeCases !== 1 ? 's' : ''}`}
                            onClick={() => router.push('/insurance/dashboard/earnings')}
                        />
                        <StatsCard
                            title="Closed — Unpaid"
                            value={formatCurrency(comm.closedUnpaid)}
                            icon={Clock}
                            color="#d97706"
                            variant="money"
                            onClick={() => router.push('/insurance/dashboard/earnings')}
                        />
                        <StatsCard
                            title="Closed — Paid"
                            value={formatCurrency(comm.closedPaid)}
                            icon={TrendingUp}
                            color="#16a34a"
                            variant="money"
                            onClick={() => router.push('/insurance/dashboard/earnings')}
                        />
                    </div>

                    {/* Urgency banner */}
                    <UrgencyBanner
                        count={stats.upcomingLockIns}
                        onAction={() => router.push('/insurance/dashboard/cases/lock-in-end')}
                        actionLabel="Review"
                    />

                    {/* Bottom two-column */}
                    <div style={{ display: 'grid', gap: 20 }} className="lg:grid-cols-2">
                        {/* Recent Cases */}
                        <div className="card" style={{ padding: 24 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                                <span className="section-label" style={{ marginBottom: 0 }}>Recent Cases</span>
                                <button
                                    onClick={() => router.push('/insurance/dashboard/cases')}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 5,
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        color: '#03a9e7', fontSize: 12, fontWeight: 600,
                                    }}
                                >
                                    View all <ArrowRight size={12} />
                                </button>
                            </div>

                            {recentCases.length === 0 ? (
                                <EmptyState
                                    icon={Briefcase}
                                    iconColor="#03a9e7"
                                    title="No cases yet"
                                    description="Start a plan from the Mortgage Planner to begin tracking your pipeline."
                                    action={{ label: 'Open Planner', onClick: () => router.push(PLANNER_ROUTE) }}
                                />
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    {recentCases.map(c => {
                                        const badge = stageBadge(c.stage)
                                        return (
                                            <button
                                                key={c.id}
                                                onClick={() => router.push(`/insurance/dashboard/cases/${c.id}`)}
                                                className="pressable"
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 12,
                                                    padding: '10px 12px', borderRadius: 10,
                                                    background: 'none', border: 'none', cursor: 'pointer',
                                                    textAlign: 'left', width: '100%',
                                                }}
                                                onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                            >
                                                <div style={{
                                                    width: 38, height: 38, borderRadius: '50%',
                                                    background: '#e0f2fe', color: '#0369a1',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    fontWeight: 700, flexShrink: 0,
                                                }}>
                                                    {c.client_name ? c.client_name[0].toUpperCase() : '?'}
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <p style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {c.client_name || 'Unnamed Client'}
                                                    </p>
                                                    <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                                                        {c.case_type} · {formatDate(c.created_at)}
                                                    </p>
                                                </div>
                                                <span className="status-badge" style={{ color: badge.text, background: badge.bg, flexShrink: 0 }}>
                                                    {c.stage}
                                                </span>
                                                <ChevronRight size={16} color="#cbd5e1" style={{ flexShrink: 0 }} />
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Promo / quick action */}
                        <div
                            className="card"
                            style={{
                                padding: 24,
                                background: 'linear-gradient(135deg, #052d4a 0%, #0284c7 100%)',
                                display: 'flex', flexDirection: 'column', gap: 16,
                            }}
                        >
                            <div style={{
                                width: 42, height: 42, borderRadius: 11,
                                background: 'rgba(255,255,255,0.18)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Briefcase size={20} color="white" />
                            </div>
                            <div>
                                <h3 style={{ fontSize: 18, fontWeight: 700, color: 'white' }}>Grow Your Business</h3>
                                <p style={{ fontSize: 13, color: '#e0f2fe', marginTop: 6, lineHeight: 1.5 }}>
                                    Track your mortgage cases efficiently. Follow up with &quot;Pending Signature&quot; cases to close deals faster.
                                </p>
                            </div>
                            <button
                                onClick={() => router.push('/insurance/dashboard/cases')}
                                className="pressable"
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    width: '100%', padding: '12px 0', borderRadius: 9,
                                    background: 'white', color: '#052d4a',
                                    fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer',
                                }}
                            >
                                Go to Pipeline <ArrowRight size={14} />
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
