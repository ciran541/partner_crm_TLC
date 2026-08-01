'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { invalidateCaseData } from '@/lib/insurance/caseCache'
import { usePagedCases, type CaseListRow } from '@/lib/insurance/usePagedCases'
import Spinner from '@/components/shared/Spinner'
import InlineAlert from '@/components/shared/InlineAlert'
import { Clock, CalendarDays, CheckCircle2, AlertCircle, ChevronRight, TrendingUp } from 'lucide-react'
import { calculateCommission } from '@/lib/property/commission'

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
}
function diffDays(iso: string): number {
    const target = new Date(iso); target.setHours(0, 0, 0, 0)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return Math.round((target.getTime() - today.getTime()) / 86400000)
}
const money = (n?: number) => (n && n > 0 ? `$${Math.round(n).toLocaleString()}` : null)
const caseFigure = (c: CaseListRow) => money(c.loan_size) ?? money(c.property_price) ?? money(c.existing_loan_amount)

export default function InsuranceFollowUpPage() {
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [adjustingId, setAdjustingId] = useState<string | null>(null)
    const [newDate, setNewDate] = useState('')
    const [saving, setSaving] = useState(false)

    const today = useMemo(() => new Date().toISOString().split('T')[0], [])

    // Two queries rather than one, so each half is ordered by the server the way
    // this screen wants it (overdue newest-first, upcoming soonest-first) and each
    // gets its own accurate count and its own paging.
    //
    // includeDrafts is TRUE here on purpose: the old store returned every case
    // and this screen never filtered drafts out, so a draft carrying a follow-up
    // date has always appeared. The admin follow-ups screen DID filter them, and
    // keeps doing so — the two are deliberately different, not an oversight.
    const commonQuery = { stage: 'all', includeDrafts: true, hasFollowUp: true, sort: 'follow_up_date' } as const

    const overdueQ = usePagedCases({ ...commonQuery, followUpTo: today, dir: 'desc' })
    const upcomingQ = usePagedCases({ ...commonQuery, followUpAfter: today, dir: 'asc' })

    const overdue = overdueQ.rows
    const upcoming = upcomingQ.rows
    const loading = overdueQ.loading || upcomingQ.loading
    const totalFollowUps = overdueQ.total + upcomingQ.total

    // Routed through the API so the change also syncs to the agent's Google Calendar.
    async function persist(id: string, followUpDate: string | null): Promise<string | null> {
        const res = await fetch(`/api/insurance/cases/${id}/followup`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ follow_up_date: followUpDate }),
        })
        if (!res.ok) { const d = await res.json().catch(() => ({})); return d.error || 'Failed to save' }
        return null
    }

    async function markDone(id: string) {
        setSaving(true)
        const err = await persist(id, null)
        setSaving(false)
        if (err) { setAlert({ type: 'error', message: err }); return }
        setAlert({ type: 'success', message: 'Follow-up cleared.' })
        // Refreshes both stores — see invalidateCaseData().
        invalidateCaseData()
    }

    async function saveDate(id: string) {
        if (!newDate) return
        setSaving(true)
        const err = await persist(id, newDate)
        setSaving(false)
        if (err) { setAlert({ type: 'error', message: err }); return }
        setAdjustingId(null); setNewDate('')
        setAlert({ type: 'success', message: 'Follow-up date updated.' })
        invalidateCaseData()
    }

    if (loading) {
        return <div className="flex items-center justify-center py-20"><Spinner size="md" color="#03a9e7" label="Loading follow-ups…" /></div>
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div>
                <h1 className="ios-page-title flex items-center gap-2"><Clock size={22} className="text-[#03a9e7]" /> Follow Ups</h1>
                <p className="page-subtitle">Cases with a follow-up reminder you set — reach out before they go cold.</p>
            </div>

            {alert && <InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} />}

            {totalFollowUps === 0 ? (
                <div className="card p-12 text-center space-y-3">
                    <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto"><Clock size={26} className="text-[#03a9e7]" /></div>
                    <p className="font-semibold text-slate-700">No follow-ups yet</p>
                    <p className="text-sm text-slate-500">Set a follow-up reminder from a case&apos;s workflow and it&apos;ll appear here.</p>
                    <Link href="/insurance/dashboard/cases" className="text-sm font-semibold text-[#03a9e7]">View all cases →</Link>
                </div>
            ) : (
                <div className="space-y-8">
                    {overdue.length > 0 && (
                        <section>
                            <div className="flex items-center gap-2 mb-3">
                                <AlertCircle size={16} className="text-red-500" />
                                {/* Server count — accurate even when only the first
                                    page of rows has been loaded. */}
                                <h2 className="text-sm font-bold text-red-500 uppercase tracking-wide">Overdue ({overdueQ.total})</h2>
                            </div>
                            <div className="space-y-2.5">
                                {overdue.map(c => (
                                    <FollowUpCard key={c.id} c={c} overdue
                                        adjusting={adjustingId === c.id} newDate={newDate} saving={saving}
                                        onStartAdjust={() => { setAdjustingId(c.id); setNewDate(c.follow_up_date!) }}
                                        onCancelAdjust={() => { setAdjustingId(null); setNewDate('') }}
                                        onNewDate={setNewDate} onSaveDate={() => saveDate(c.id)} onMarkDone={() => markDone(c.id)} />
                                ))}
                            </div>
                            <LoadMore q={overdueQ} />
                        </section>
                    )}
                    {upcoming.length > 0 && (
                        <section>
                            <div className="flex items-center gap-2 mb-3">
                                <Clock size={16} className="text-[#03a9e7]" />
                                <h2 className="text-sm font-bold text-[#03a9e7] uppercase tracking-wide">Upcoming ({upcomingQ.total})</h2>
                            </div>
                            <div className="space-y-2.5">
                                {upcoming.map(c => (
                                    <FollowUpCard key={c.id} c={c} overdue={false}
                                        adjusting={adjustingId === c.id} newDate={newDate} saving={saving}
                                        onStartAdjust={() => { setAdjustingId(c.id); setNewDate(c.follow_up_date!) }}
                                        onCancelAdjust={() => { setAdjustingId(null); setNewDate('') }}
                                        onNewDate={setNewDate} onSaveDate={() => saveDate(c.id)} onMarkDone={() => markDone(c.id)} />
                                ))}
                            </div>
                            <LoadMore q={upcomingQ} />
                        </section>
                    )}
                </div>
            )}
        </div>
    )
}

/** Appends the next page of a section, so scroll position is preserved. */
function LoadMore({ q }: { q: { rows: unknown[]; total: number; hasMore: boolean; loadingMore: boolean; loadMore: () => void } }) {
    if (!q.hasMore) return null
    return (
        <button
            onClick={q.loadMore}
            disabled={q.loadingMore}
            className="mt-2.5 w-full py-2.5 text-xs font-semibold rounded-lg border border-slate-200 text-[#0369a1] hover:bg-slate-50 disabled:text-slate-300"
        >
            {q.loadingMore ? 'Loading…' : `Load more (${q.total - q.rows.length} remaining)`}
        </button>
    )
}

interface CardProps {
    c: CaseListRow
    overdue: boolean
    adjusting: boolean
    newDate: string
    saving: boolean
    onStartAdjust: () => void
    onCancelAdjust: () => void
    onNewDate: (v: string) => void
    onSaveDate: () => void
    onMarkDone: () => void
}

function FollowUpCard({ c, overdue, adjusting, newDate, saving, onStartAdjust, onCancelAdjust, onNewDate, onSaveDate, onMarkDone }: CardProps) {
    const days = diffDays(c.follow_up_date!)
    const figure = caseFigure(c)
    return (
        <div className="card p-4" style={{ borderLeft: `3px solid ${overdue ? '#ef4444' : '#03a9e7'}` }}>
            <div className="flex justify-between items-start gap-3 flex-wrap">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm font-bold text-slate-800 truncate">{c.client_name || 'Unnamed client'}</p>
                        {overdue && (
                            <span className="text-[11px] font-bold text-red-500 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full shrink-0">
                                {Math.abs(days) === 0 ? 'Today' : `${Math.abs(days)}d overdue`}
                            </span>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                        <span>{c.case_type}</span>
                        <span>· {c.stage}</span>
                        {figure && <span>· {figure}</span>}
                        {c.client_mobile && <span>· {c.client_mobile}</span>}
                    </div>
                    {c.closed_won_data?.combined_outstanding ? (
                        <p className="text-[11px] font-semibold text-[#03a9e7] mt-1 flex items-center gap-1">
                            <TrendingUp size={11} /> Potential next-cycle income: {money(calculateCommission(c.closed_won_data.combined_outstanding).agent)}
                            <span className="text-slate-400 font-normal">on {money(c.closed_won_data.combined_outstanding)} outstanding</span>
                        </p>
                    ) : null}
                </div>
                <div className="text-right shrink-0">
                    <div className="flex items-center gap-1.5 justify-end">
                        <CalendarDays size={13} className={overdue ? 'text-red-500' : 'text-[#03a9e7]'} />
                        <span className={`text-sm font-bold ${overdue ? 'text-red-500' : 'text-[#03a9e7]'}`}>{formatDate(c.follow_up_date!)}</span>
                    </div>
                    {!overdue && days >= 0 && <p className="text-[11px] text-slate-400">{days === 0 ? 'Today' : `in ${days} day${days !== 1 ? 's' : ''}`}</p>}
                </div>
            </div>

            {adjusting ? (
                <div className="mt-3 p-3 bg-slate-50 rounded-lg flex items-center gap-2 flex-wrap">
                    <input type="date" value={newDate} onChange={e => onNewDate(e.target.value)}
                        className="flex-1 min-w-[140px] px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12" />
                    <button onClick={onSaveDate} disabled={saving || !newDate} className="px-3.5 py-2 text-xs font-bold rounded-lg bg-[#03a9e7] text-white disabled:opacity-50">
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={onCancelAdjust} className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600">Cancel</button>
                </div>
            ) : (
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <button onClick={onStartAdjust} className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
                        <CalendarDays size={12} /> Adjust date
                    </button>
                    <button onClick={onMarkDone} disabled={saving} className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 flex items-center gap-1.5 disabled:opacity-50">
                        <CheckCircle2 size={12} /> Mark done
                    </button>
                    <Link href={`/insurance/dashboard/cases/${c.id}`} className="ml-auto px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-[#03a9e7] flex items-center gap-1">
                        View case <ChevronRight size={12} />
                    </Link>
                </div>
            )}
        </div>
    )
}
