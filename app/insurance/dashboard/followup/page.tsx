'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { invalidateCaseData } from '@/lib/insurance/caseCache'
import { usePagedCases, type CaseListRow } from '@/lib/insurance/usePagedCases'
import { todaySgt } from '@/lib/insurance/promotions'
import FollowUpCalendar, { monthRange } from '@/components/insurance/followup/FollowUpCalendar'
import Spinner from '@/components/shared/Spinner'
import InlineAlert from '@/components/shared/InlineAlert'
import { Clock, CalendarDays, CheckCircle2, AlertCircle, ChevronRight, TrendingUp, List } from 'lucide-react'
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

type View = 'list' | 'calendar'
const VIEW_KEY = 'insurance-followup-view'

/**
 * The saved view preference, read through useSyncExternalStore rather than an
 * effect. localStorage does not exist during Next's server render, so seeding
 * useState from it would hydrate-mismatch, and setting it from an effect causes
 * the cascading render the lint rule warns about. This is the primitive React
 * provides for exactly this shape: a server snapshot, a client snapshot, and a
 * subscription. Subscribing to `storage` as well keeps two open tabs in step.
 */
const viewStore = {
    listeners: new Set<() => void>(),
    subscribe(cb: () => void): () => void {
        viewStore.listeners.add(cb)
        window.addEventListener('storage', cb)
        return () => { viewStore.listeners.delete(cb); window.removeEventListener('storage', cb) }
    },
    /** Returns a primitive, so React's Object.is check settles immediately. */
    get(): View {
        return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list'
    },
    serverGet(): View {
        return 'list'
    },
    set(v: View) {
        localStorage.setItem(VIEW_KEY, v)
        viewStore.listeners.forEach(l => l())
    },
}
/** A month grid can show far more than one list page; 200 is the server's cap. */
const CALENDAR_LIMIT = 200
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const caseFigure = (c: CaseListRow) => money(c.loan_size) ?? money(c.property_price) ?? money(c.existing_loan_amount)

export default function InsuranceFollowUpPage() {
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [adjustingId, setAdjustingId] = useState<string | null>(null)
    const [newDate, setNewDate] = useState('')
    const [saving, setSaving] = useState(false)

    const view = useSyncExternalStore(viewStore.subscribe, viewStore.get, viewStore.serverGet)
    const [month, setMonth] = useState(() => startOfMonth(new Date()))
    const [selectedDate, setSelectedDate] = useState<string | null>(null)

    function changeView(next: View) {
        setSelectedDate(null)
        viewStore.set(next)
    }

    // SGT, not UTC. toISOString() reports YESTERDAY between midnight and 8am
    // SGT, which would push a follow-up due today into "upcoming" and mis-colour
    // the calendar's today marker for that whole window (same reason todaySgt()
    // exists for promotions).
    const today = useMemo(() => todaySgt(), [])

    // Two queries rather than one, so each half is ordered by the server the way
    // this screen wants it (overdue newest-first, upcoming soonest-first) and each
    // gets its own accurate count and its own paging.
    //
    // includeDrafts is TRUE here on purpose: the old store returned every case
    // and this screen never filtered drafts out, so a draft carrying a follow-up
    // date has always appeared. The admin follow-ups screen DID filter them, and
    // keeps doing so — the two are deliberately different, not an oversight.
    const commonQuery = { stage: 'all', includeDrafts: true, hasFollowUp: true, sort: 'follow_up_date' } as const

    //
    // Overdue stays enabled in BOTH views: the calendar only spans the month you
    // are looking at, so without it a stale follow-up from two months back would
    // simply vanish from an agent who lives in calendar view. It becomes the
    // banner below instead.
    const overdueQ = usePagedCases({ ...commonQuery, followUpTo: today, dir: 'desc' })
    const upcomingQ = usePagedCases(
        { ...commonQuery, followUpAfter: today, dir: 'asc' },
        { enabled: view === 'list' },
    )

    // One request per month browsed, bounded by the range rather than by paging —
    // a calendar cannot render a half-loaded month the way a list can.
    const range = useMemo(() => monthRange(month), [month])
    const monthQ = usePagedCases(
        { ...commonQuery, followUpAfter: range.after, followUpTo: range.to, dir: 'asc', limit: CALENDAR_LIMIT },
        { enabled: view === 'calendar' },
    )

    const overdue = overdueQ.rows
    const upcoming = upcomingQ.rows
    const loading = view === 'list' ? overdueQ.loading || upcomingQ.loading : monthQ.loading
    const totalFollowUps = overdueQ.total + upcomingQ.total

    const dayRows = selectedDate
        ? monthQ.rows.filter(c => c.follow_up_date?.slice(0, 10) === selectedDate)
        : []

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
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="ios-page-title flex items-center gap-2"><Clock size={22} className="text-[#03a9e7]" /> Follow Ups</h1>
                    <p className="page-subtitle">Cases with a follow-up reminder you set — reach out before they go cold.</p>
                </div>
                <ViewToggle view={view} onChange={changeView} />
            </div>

            {alert && <InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} />}

            {view === 'calendar' ? (
                <div className="space-y-4">
                    {/* The grid only covers the month on screen, so anything older
                        would be invisible here. Surfaced rather than hidden. */}
                    {overdueQ.total > 0 && (
                        <button
                            onClick={() => changeView('list')}
                            className="w-full flex items-center gap-2 p-3 rounded-xl border border-red-200 bg-red-50 text-left hover:bg-red-100 transition-colors"
                        >
                            <AlertCircle size={15} className="text-red-500 shrink-0" />
                            <span className="text-xs font-semibold text-red-600">
                                {overdueQ.total} overdue follow-up{overdueQ.total !== 1 ? 's' : ''} — open list view
                            </span>
                            <ChevronRight size={14} className="text-red-400 ml-auto shrink-0" />
                        </button>
                    )}

                    <FollowUpCalendar
                        rows={monthQ.rows}
                        month={month}
                        today={today}
                        selectedDate={selectedDate}
                        loading={monthQ.refreshing}
                        onPrevMonth={() => { setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1)); setSelectedDate(null) }}
                        onNextMonth={() => { setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1)); setSelectedDate(null) }}
                        onToday={() => { setMonth(startOfMonth(new Date())); setSelectedDate(today) }}
                        onSelectDate={setSelectedDate}
                    />

                    {selectedDate && (
                        <section>
                            <div className="flex items-center gap-2 mb-3">
                                <CalendarDays size={16} className="text-[#03a9e7]" />
                                <h2 className="text-sm font-bold text-[#03a9e7] uppercase tracking-wide">
                                    {formatDate(selectedDate)} ({dayRows.length})
                                </h2>
                            </div>
                            {dayRows.length === 0 ? (
                                <p className="text-sm text-slate-400 px-1">No follow-ups on this date.</p>
                            ) : (
                                <div className="space-y-2.5">
                                    {dayRows.map(c => (
                                        <FollowUpCard key={c.id} c={c} overdue={c.follow_up_date!.slice(0, 10) < today}
                                            adjusting={adjustingId === c.id} newDate={newDate} saving={saving}
                                            onStartAdjust={() => { setAdjustingId(c.id); setNewDate(c.follow_up_date!) }}
                                            onCancelAdjust={() => { setAdjustingId(null); setNewDate('') }}
                                            onNewDate={setNewDate} onSaveDate={() => saveDate(c.id)} onMarkDone={() => markDone(c.id)} />
                                    ))}
                                </div>
                            )}
                        </section>
                    )}

                    {monthQ.rows.length === 0 && !monthQ.refreshing && (
                        <p className="text-xs text-slate-400 text-center">No follow-ups this month.</p>
                    )}
                </div>
            ) : totalFollowUps === 0 ? (
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

/** List / Calendar switch. The choice is remembered per browser, since an agent
 *  who prefers one has no reason to re-pick it on every visit. */
function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
    const base = 'px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors'
    const on = 'bg-[#03a9e7] text-white'
    const off = 'text-slate-500 hover:bg-slate-100'
    return (
        <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-200 bg-white shrink-0">
            <button onClick={() => onChange('list')} className={`${base} ${view === 'list' ? on : off}`} aria-pressed={view === 'list'}>
                <List size={13} /> List
            </button>
            <button onClick={() => onChange('calendar')} className={`${base} ${view === 'calendar' ? on : off}`} aria-pressed={view === 'calendar'}>
                <CalendarDays size={13} /> Calendar
            </button>
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
