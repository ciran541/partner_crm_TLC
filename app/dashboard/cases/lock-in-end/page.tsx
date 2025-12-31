'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Case } from '@/lib/types'
import { AlertTriangle, ArrowLeft, Eye } from 'lucide-react'

export default function UpcomingLockInsPage() {
    const router = useRouter()
    const [cases, setCases] = useState<Case[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadLockIns()
    }, [])

    const loadLockIns = async () => {
        setLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        // Fetch all cases slightly more efficiently if possible, but for now reuse pattern
        // Filtering in memory for date math simplicity as per dashboard
        const { data } = await supabase
            .from('cases')
            .select('*')
            .order('lock_in_end_date', { ascending: true })

        if (data) {
            const now = new Date()
            // Clear time for fair comparison
            now.setHours(0, 0, 0, 0)

            const ninetyDaysFromNow = new Date()
            ninetyDaysFromNow.setDate(now.getDate() + 90)

            const relevantCases = data.filter(c => {
                if (!c.lock_in_end_date || c.stage === 'Closed Lost') return false
                const d = new Date(c.lock_in_end_date)
                // We want dates in the future (or today) but not too far out
                return d >= now && d <= ninetyDaysFromNow
            })
            setCases(relevantCases)
        }
        setLoading(false)
    }

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        })
    }

    const getDaysRemaining = (dateString: string) => {
        const now = new Date()
        now.setHours(0, 0, 0, 0)
        const d = new Date(dateString)
        const diff = d.getTime() - now.getTime()
        const days = Math.ceil(diff / (1000 * 3600 * 24))

        if (days < 0) return 'Expired'
        return `${days} days`
    }

    if (loading) return <div style={{ padding: 20 }}>Loading...</div>

    return (
        <div>
            <div style={{ marginBottom: '24px' }}>
                <button
                    onClick={() => router.push('/dashboard')}
                    style={{
                        background: 'none', border: 'none', color: '#64748b',
                        display: 'flex', alignItems: 'center', gap: '8px',
                        marginBottom: '12px', cursor: 'pointer', fontWeight: '500'
                    }}
                >
                    <ArrowLeft size={16} />
                    Back to Dashboard
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ padding: 10, background: '#fee2e2', borderRadius: 8, color: '#ef4444' }}>
                        <AlertTriangle size={24} />
                    </div>
                    <div>
                        <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#052d4a', margin: 0 }}>Upcoming Lock-ins</h1>
                        <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Cases requiring attention within 90 days</p>
                    </div>
                </div>
            </div>

            <div className="card" style={{ overflow: 'hidden' }}>
                {cases.length === 0 ? (
                    <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}>
                        <p>No upcoming lock-ins found.</p>
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            <tr>
                                <th style={{ padding: '16px', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Client Name</th>
                                <th style={{ padding: '16px', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Type</th>
                                <th style={{ padding: '16px', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Bank</th>
                                <th style={{ padding: '16px', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Lock-in End</th>
                                <th style={{ padding: '16px', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Timing</th>
                                <th style={{ padding: '16px', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Stage</th>
                                <th style={{ padding: '16px', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {cases.map((c) => (
                                <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: '16px', fontWeight: '500', color: '#0f172a' }}>
                                        <a href={`/dashboard/cases/${c.id}`} style={{ color: '#0369a1', textDecoration: 'none' }}>
                                            {c.client_name || 'Unnamed'}
                                        </a>
                                    </td>
                                    <td style={{ padding: '16px', color: '#475569' }}>{c.case_type}</td>
                                    <td style={{ padding: '16px', color: '#475569' }}>{c.current_bank || '-'}</td>
                                    <td style={{ padding: '16px', color: '#0f172a', fontWeight: '500' }}>
                                        {formatDate(c.lock_in_end_date!)}
                                    </td>
                                    <td style={{ padding: '16px' }}>
                                        <span style={{
                                            background: '#fee2e2', color: '#991b1b',
                                            padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: '600'
                                        }}>
                                            {getDaysRemaining(c.lock_in_end_date!)}
                                        </span>
                                    </td>
                                    <td style={{ padding: '16px' }}>
                                        <span className="status-badge" style={{ background: '#f1f5f9', color: '#475569' }}>
                                            {c.stage}
                                        </span>
                                    </td>
                                    <td style={{ padding: '16px', textAlign: 'right' }}>
                                        <button
                                            onClick={() => router.push(`/dashboard/cases/${c.id}`)}
                                            style={{
                                                padding: '6px',
                                                background: 'transparent',
                                                border: '1px solid #e2e8f0',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                color: '#64748b'
                                            }}
                                            title="View Details"
                                        >
                                            <Eye size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}
