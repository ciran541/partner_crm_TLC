'use client'

import { useState, useEffect, useCallback } from 'react'
import { Clock, CheckCircle2, AlertCircle, ChevronRight, CalendarDays } from 'lucide-react'
import Link from 'next/link'
import Spinner from '@/components/shared/Spinner'
import InlineAlert from '@/components/shared/InlineAlert'
import { formatCurrency } from '@/lib/utils/formatCurrency'

interface FollowUpCase {
    id: string
    client_name: string
    client_mobile: string
    follow_up_date: string
    lock_in_period?: number
    package_type?: string
    banker_name?: string
    projected_agent_income?: number
    agent_commission_amount?: number
    banks?: { id: string; name: string }
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
}

function diffDays(iso: string): number {
    const target = new Date(iso)
    target.setHours(0, 0, 0, 0)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return Math.round((target.getTime() - today.getTime()) / 86400000)
}

export default function FollowUpPage() {
    const [cases, setCases] = useState<FollowUpCase[]>([])
    const [loading, setLoading] = useState(true)
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [adjustingId, setAdjustingId] = useState<string | null>(null)
    const [newDate, setNewDate] = useState<string>('')
    const [saving, setSaving] = useState(false)

    const loadFollowUps = useCallback(async () => {
        setLoading(true)
        const res = await fetch('/api/property/followup')
        const json = await res.json()
        setCases(json.data ?? [])
        setLoading(false)
    }, [])

    useEffect(() => { loadFollowUps() }, [loadFollowUps])

    const today = new Date().toISOString().split('T')[0]
    const upcoming = cases.filter(c => c.follow_up_date > today).sort((a, b) => a.follow_up_date.localeCompare(b.follow_up_date))
    const overdue = cases.filter(c => c.follow_up_date <= today).sort((a, b) => b.follow_up_date.localeCompare(a.follow_up_date))

    async function handleMarkDone(id: string) {
        setSaving(true)
        const res = await fetch(`/api/property/cases/${id}/followup`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completed: true }),
        })
        setSaving(false)
        if (res.ok) {
            setAlert({ type: 'success', message: 'Follow-up marked as done.' })
            setCases(prev => prev.filter(c => c.id !== id))
        } else {
            setAlert({ type: 'error', message: 'Failed to mark as done. Please try again.' })
        }
    }

    async function handleAdjustDate(id: string) {
        if (!newDate) return
        setSaving(true)
        const res = await fetch(`/api/property/cases/${id}/followup`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ follow_up_date: newDate }),
        })
        setSaving(false)
        if (res.ok) {
            setAlert({ type: 'success', message: 'Follow-up date updated.' })
            setAdjustingId(null)
            setNewDate('')
            setCases(prev => prev.map(c => c.id === id ? { ...c, follow_up_date: newDate } : c))
        } else {
            setAlert({ type: 'error', message: 'Failed to update date. Please try again.' })
        }
    }

    if (loading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
                <Spinner size="md" color="#059669" label="Loading follow-ups…" />
            </div>
        )
    }

    return (
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <Clock size={26} color="#059669" />
                <h1 style={{ fontSize: 22, fontWeight: 800, color: '#052d4a', letterSpacing: '-0.02em' }}>Follow Ups</h1>
            </div>
            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 28 }}>
                Cases where you chose to follow up with the client yourself.
            </p>

            {alert && (
                <div style={{ marginBottom: 20 }}>
                    <InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} />
                </div>
            )}

            {cases.length === 0 ? (
                <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
                    <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                        <Clock size={26} color="#059669" />
                    </div>
                    <p style={{ fontSize: 16, fontWeight: 700, color: '#052d4a', marginBottom: 6 }}>No follow-ups yet</p>
                    <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>
                        Cases where you selected self-follow-up will appear here once they have a Letter of Offer date and lock-in period.
                    </p>
                    <Link href="/property/cases" style={{ fontSize: 13, fontWeight: 600, color: '#059669', textDecoration: 'none' }}>
                        View all cases →
                    </Link>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

                    {/* Overdue */}
                    {overdue.length > 0 && (
                        <section>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                <AlertCircle size={16} color="#ef4444" />
                                <h2 style={{ fontSize: 14, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                    Overdue ({overdue.length})
                                </h2>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {overdue.map(c => (
                                    <FollowUpCard
                                        key={c.id}
                                        c={c}
                                        isOverdue
                                        adjustingId={adjustingId}
                                        newDate={newDate}
                                        saving={saving}
                                        onStartAdjust={() => { setAdjustingId(c.id); setNewDate(c.follow_up_date) }}
                                        onCancelAdjust={() => { setAdjustingId(null); setNewDate('') }}
                                        onNewDateChange={setNewDate}
                                        onSaveDate={() => handleAdjustDate(c.id)}
                                        onMarkDone={() => handleMarkDone(c.id)}
                                    />
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Upcoming */}
                    {upcoming.length > 0 && (
                        <section>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                <Clock size={16} color="#059669" />
                                <h2 style={{ fontSize: 14, fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                    Upcoming ({upcoming.length})
                                </h2>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {upcoming.map(c => (
                                    <FollowUpCard
                                        key={c.id}
                                        c={c}
                                        isOverdue={false}
                                        adjustingId={adjustingId}
                                        newDate={newDate}
                                        saving={saving}
                                        onStartAdjust={() => { setAdjustingId(c.id); setNewDate(c.follow_up_date) }}
                                        onCancelAdjust={() => { setAdjustingId(null); setNewDate('') }}
                                        onNewDateChange={setNewDate}
                                        onSaveDate={() => handleAdjustDate(c.id)}
                                        onMarkDone={() => handleMarkDone(c.id)}
                                    />
                                ))}
                            </div>
                        </section>
                    )}
                </div>
            )}
        </div>
    )
}

function FollowUpCard({
    c, isOverdue, adjustingId, newDate, saving,
    onStartAdjust, onCancelAdjust, onNewDateChange, onSaveDate, onMarkDone,
}: {
    c: FollowUpCase
    isOverdue: boolean
    adjustingId: string | null
    newDate: string
    saving: boolean
    onStartAdjust: () => void
    onCancelAdjust: () => void
    onNewDateChange: (v: string) => void
    onSaveDate: () => void
    onMarkDone: () => void
}) {
    const days = diffDays(c.follow_up_date)
    const isAdjusting = adjustingId === c.id
    const futureIncome = c.projected_agent_income ?? c.agent_commission_amount

    return (
        <div
            className="card"
            style={{
                padding: '18px 20px',
                borderLeft: `3px solid ${isOverdue ? '#ef4444' : '#059669'}`,
                borderRadius: 12,
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                {/* Left: client info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <p style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.client_name}
                        </p>
                        {isOverdue && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', background: '#fef2f2', border: '1px solid #fecaca', padding: '1px 8px', borderRadius: 20, flexShrink: 0 }}>
                                {Math.abs(days) === 0 ? 'Today' : `${Math.abs(days)}d overdue`}
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12, color: '#64748b' }}>
                        {c.banks?.name && <span>{c.banks.name}</span>}
                        {c.banker_name && <span>· {c.banker_name}</span>}
                        {c.lock_in_period && <span>· {c.lock_in_period}yr {c.package_type ? (c.package_type.charAt(0).toUpperCase() + c.package_type.slice(1)) : ''}</span>}
                        {c.client_mobile && <span style={{ marginTop: 2 }}>{c.client_mobile}</span>}
                    </div>
                </div>

                {/* Right: date + commission */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end', marginBottom: 3 }}>
                        <CalendarDays size={13} color={isOverdue ? '#ef4444' : '#059669'} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: isOverdue ? '#ef4444' : '#059669' }}>
                            {formatDate(c.follow_up_date)}
                        </span>
                    </div>
                    {!isOverdue && days >= 0 && (
                        <p style={{ fontSize: 11, color: '#94a3b8' }}>
                            {days === 0 ? 'Today' : `in ${days} day${days !== 1 ? 's' : ''}`}
                        </p>
                    )}
                    {futureIncome && (
                        <p style={{ fontSize: 12, fontWeight: 700, color: '#059669', marginTop: 4 }}>
                            {formatCurrency(futureIncome)}
                        </p>
                    )}
                </div>
            </div>

            {/* Adjust date inline */}
            {isAdjusting && (
                <div style={{ marginTop: 14, padding: '12px 14px', background: '#f8fafc', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <input
                        type="date"
                        value={newDate}
                        onChange={e => onNewDateChange(e.target.value)}
                        style={{ padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid #d1d5db', outline: 'none', flex: 1, minWidth: 140 }}
                        onFocus={e => { e.target.style.borderColor = '#059669'; e.target.style.boxShadow = '0 0 0 3px rgba(5,150,105,0.12)' }}
                        onBlur={e => { e.target.style.borderColor = '#d1d5db'; e.target.style.boxShadow = 'none' }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            onClick={onSaveDate}
                            disabled={saving || !newDate}
                            style={{
                                padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 7, cursor: 'pointer',
                                background: '#059669', color: 'white', border: 'none',
                                opacity: saving || !newDate ? 0.5 : 1,
                            }}
                        >
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                            onClick={onCancelAdjust}
                            style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: 'pointer', background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Actions row */}
            {!isAdjusting && (
                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                        onClick={onStartAdjust}
                        style={{
                            padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: 'pointer',
                            background: 'white', color: '#64748b', border: '1px solid #e2e8f0',
                            display: 'flex', alignItems: 'center', gap: 5,
                        }}
                    >
                        <CalendarDays size={12} /> Adjust Date
                    </button>
                    <button
                        onClick={onMarkDone}
                        disabled={saving}
                        style={{
                            padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: 'pointer',
                            background: '#f0fdf4', color: '#059669', border: '1px solid #bbf7d0',
                            display: 'flex', alignItems: 'center', gap: 5,
                            opacity: saving ? 0.5 : 1,
                        }}
                    >
                        <CheckCircle2 size={12} /> Mark Done
                    </button>
                    <Link
                        href={`/property/cases/${c.id}`}
                        style={{
                            padding: '7px 12px', fontSize: 12, fontWeight: 600, borderRadius: 7,
                            color: '#94a3b8', textDecoration: 'none',
                            display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto',
                        }}
                    >
                        View case <ChevronRight size={12} />
                    </Link>
                </div>
            )}
        </div>
    )
}
