'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, ArrowRight, AlertCircle } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { formatDate } from '@/lib/utils/formatDate'
import { useCases } from '@/lib/insurance/useCases'

function daysLeft(dateString: string) {
    const now = new Date(); now.setHours(0, 0, 0, 0)
    const days = Math.ceil((new Date(dateString).getTime() - now.getTime()) / (1000 * 3600 * 24))
    return days < 0 ? 'Expired' : `${days} day${days === 1 ? '' : 's'}`
}

function timingTone(dateString: string) {
    const now = new Date(); now.setHours(0, 0, 0, 0)
    const days = Math.ceil((new Date(dateString).getTime() - now.getTime()) / (1000 * 3600 * 24))
    if (days <= 30) return { bg: '#fee2e2', text: '#991b1b' }
    if (days <= 60) return { bg: '#fff7ed', text: '#9a3412' }
    return { bg: '#fef9c3', text: '#854d0e' }
}

export default function UpcomingLockInsPage() {
    const router = useRouter()
    const { cases: allCases, loading, error } = useCases()

    // Derive the lock-in list from the shared cache (same 90-day window the
    // dashboard counts), sorted by soonest expiry.
    const cases = useMemo(() => {
        const now = new Date()
        const in90 = new Date(now)
        in90.setDate(now.getDate() + 90)
        return allCases
            .filter(c => {
                if (!c.lock_in_end_date || c.stage === 'Closed Lost') return false
                const d = new Date(c.lock_in_end_date)
                return d >= now && d <= in90
            })
            .sort((a, b) => new Date(a.lock_in_end_date!).getTime() - new Date(b.lock_in_end_date!).getTime())
    }, [allCases])

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header */}
            <div>
                <button
                    onClick={() => router.push('/insurance/dashboard/pipeline')}
                    style={{ background: 'none', border: 'none', color: '#64748b', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, cursor: 'pointer', fontWeight: 500, fontSize: 14 }}
                >
                    <ArrowLeft size={15} /> Back to Dashboard
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: '#fee2e2', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <AlertTriangle size={22} />
                    </div>
                    <div>
                        <h1 className="ios-page-title">Upcoming Lock-ins</h1>
                        <p className="page-subtitle">Cases requiring attention within 90 days.</p>
                    </div>
                </div>
            </div>

            {loading && (
                <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[0, 1, 2, 3].map(i => <Skeleton key={i} height={48} radius={10} />)}
                </div>
            )}

            {error && !loading && (
                <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, color: '#dc2626', fontSize: 14 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} /> {error}
                </div>
            )}

            {!loading && !error && cases.length === 0 && (
                <EmptyState
                    icon={AlertTriangle}
                    iconColor="#10b981"
                    title="No upcoming lock-ins"
                    description="No cases have a lock-in expiring within the next 90 days."
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
                                        <th className="table-th">Type</th>
                                        <th className="table-th">Current Bank</th>
                                        <th className="table-th">Lock-in End</th>
                                        <th className="table-th">Timing</th>
                                        <th className="table-th">Stage</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cases.map(c => {
                                        const tone = timingTone(c.lock_in_end_date!)
                                        return (
                                            <tr
                                                key={c.id}
                                                onClick={() => router.push(`/insurance/dashboard/cases/${c.id}`)}
                                                style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                                                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#f8fafc')}
                                                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = '')}
                                            >
                                                <td className="table-td" style={{ fontWeight: 600, color: '#0f172a' }}>{c.client_name || 'Unnamed'}</td>
                                                <td className="table-td" style={{ color: '#475569' }}>{c.case_type}</td>
                                                <td className="table-td" style={{ color: '#475569' }}>{c.current_bank || '—'}</td>
                                                <td className="table-td" style={{ fontWeight: 600, color: '#0f172a' }}>{formatDate(c.lock_in_end_date!)}</td>
                                                <td className="table-td"><span className="status-badge" style={{ background: tone.bg, color: tone.text }}>{daysLeft(c.lock_in_end_date!)}</span></td>
                                                <td className="table-td"><span className="status-badge" style={{ background: '#f1f5f9', color: '#475569' }}>{c.stage}</span></td>
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

                    {/* Mobile cards */}
                    <div className="md:hidden flex flex-col gap-2.5">
                        {cases.map(c => {
                            const tone = timingTone(c.lock_in_end_date!)
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => router.push(`/insurance/dashboard/cases/${c.id}`)}
                                    className="card"
                                    style={{ padding: '16px 18px', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 14, width: '100%', background: 'none', cursor: 'pointer' }}
                                >
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                                            <p style={{ fontWeight: 700, color: '#0f172a', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.client_name || 'Unnamed'}</p>
                                            <span className="status-badge" style={{ background: tone.bg, color: tone.text, flexShrink: 0 }}>{daysLeft(c.lock_in_end_date!)}</span>
                                        </div>
                                        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>{c.case_type}{c.current_bank ? ` · ${c.current_bank}` : ''}</p>
                                        <span style={{ fontSize: 12, color: '#94a3b8' }}>Lock-in ends {formatDate(c.lock_in_end_date!)}</span>
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
