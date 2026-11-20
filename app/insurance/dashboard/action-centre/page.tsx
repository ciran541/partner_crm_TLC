'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { invalidateCaseData } from '@/lib/insurance/caseCache'
import { usePagedCases, type CaseListRow } from '@/lib/insurance/usePagedCases'
import { todaySgt } from '@/lib/insurance/promotions'
import { addDays, daysBetween, SOON_DAYS } from '@/lib/insurance/followUps'
import { PIPELINE_STAGES, stageBadge, stageLabel } from '@/lib/insurance/stages'
import FollowUpCalendar, { monthRange } from '@/components/insurance/followup/FollowUpCalendar'
import FollowUpUpdateForm from '@/components/insurance/followup/FollowUpUpdateForm'
import Spinner from '@/components/shared/Spinner'
import InlineAlert from '@/components/shared/InlineAlert'
import {
    AlertCircle, CalendarDays, CalendarClock, CalendarPlus, ChevronRight, List, Target,
    TrendingUp, Search, Mail, CalendarCheck,
} from 'lucide-react'
import { calculateCommission } from '@/lib/property/commission'

/**
 * Action Centre — "what do I need to do now?"
 *
 * Replaces the old Follow Ups tab. Every case always has a next follow-up
 * (lib/insurance/followUps.ts), so this screen is the agent's to-do list:
 *
 *   Needs a follow-up date — cases that slipped through (older cases, pre-rule)
 *   Overdue / Today / Next 14 days — act on these now
 *   All upcoming (day 15+) — plan ahead: lock-ins expiring months or years
 *     out, with search / status / year / month filters and paging, since an
 *     agent can have thousands of these. No case appears in two sections.
 *
 * "Update FU" opens the status + date + remark form inline. There is no
 * "Mark done": the agent always sets the next date.
 */

const fmt = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
const money = (n?: number) => (n && n > 0 ? `$${Math.round(n).toLocaleString()}` : null)

type View = 'list' | 'calendar'
const VIEW_KEY = 'insurance-action-centre-view'

/** Saved List/Calendar preference (see the old Follow Ups page for why useSyncExternalStore). */
const viewStore = {
    listeners: new Set<() => void>(),
    subscribe(cb: () => void): () => void {
        viewStore.listeners.add(cb)
        window.addEventListener('storage', cb)
        return () => { viewStore.listeners.delete(cb); window.removeEventListener('storage', cb) }
    },
    get(): View {
        try { return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list' } catch { return 'list' }
    },
    serverGet(): View { return 'list' },
    set(v: View) {
        try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode */ }
        viewStore.listeners.forEach(l => l())
    },
}

const CALENDAR_LIMIT = 200
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function ActionCentrePage() {
    const today = useMemo(() => todaySgt(), [])
    const yesterday = addDays(today, -1)
    const soonEnd = addDays(today, SOON_DAYS)

    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [editingId, setEditingId] = useState<string | null>(null)
    const view = useSyncExternalStore(viewStore.subscribe, viewStore.get, viewStore.serverGet)
    const [month, setMonth] = useState(() => startOfMonth(new Date()))
    const [selectedDate, setSelectedDate] = useState<string | null>(null)

    // "All upcoming" filters
    const [search, setSearch] = useState('')
    const [stage, setStage] = useState('all')
    const [year, setYear] = useState('')
    const [monthFilter, setMonthFilter] = useState('')

    const changeView = (v: View) => { setSelectedDate(null); setEditingId(null); viewStore.set(v) }

    const common = { stage: 'all', includeDrafts: true, hasFollowUp: true, sort: 'follow_up_date', dir: 'asc' } as const

    // Counts always load (they drive the tiles in both views); rows only in list view.
    const missingQ = usePagedCases({ stage: 'all', missingFollowUp: true, sort: 'updated_at', dir: 'desc' })
    const overdueQ = usePagedCases({ ...common, followUpTo: yesterday })
    const todayQ = usePagedCases({ ...common, followUpAfter: yesterday, followUpTo: today })
    const soonQ = usePagedCases({ ...common, followUpAfter: today, followUpTo: soonEnd })

    // Day 15 onward, narrowed by the filters. The window never reaches back
    // into the next-14-days block, so nothing shows twice.
    const laterRange = useMemo(() => {
        let after = soonEnd
        let to: string | undefined
        if (year) {
            const y = Number(year)
            const m = monthFilter ? Number(monthFilter) : null
            const start = m ? `${y}-${String(m).padStart(2, '0')}-01` : `${y}-01-01`
            const end = m ? new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) : `${y}-12-31`
            const dayBefore = addDays(start, -1)
            if (dayBefore > after) after = dayBefore
            to = end
        }
        return { after, to }
    }, [soonEnd, year, monthFilter])
    const laterEmpty = !!laterRange.to && laterRange.to <= laterRange.after
    const laterQ = usePagedCases(
        { ...common, stage, search, followUpAfter: laterRange.after, followUpTo: laterRange.to },
        { enabled: view === 'list' && !laterEmpty },
    )

    const range = useMemo(() => monthRange(month), [month])
    const monthQ = usePagedCases(
        { ...common, followUpAfter: range.after, followUpTo: range.to, limit: CALENDAR_LIMIT },
        { enabled: view === 'calendar' },
    )
    const dayRows = selectedDate ? monthQ.rows.filter(c => c.follow_up_date?.slice(0, 10) === selectedDate) : []

    const firstLoad = overdueQ.loading && todayQ.loading && soonQ.loading
    const nowCount = overdueQ.total + todayQ.total + soonQ.total + missingQ.total

    const onSaved = () => {
        setEditingId(null)
        setAlert({ type: 'success', message: 'Follow-up saved.' })
        invalidateCaseData()   // refreshes every section and the counts
    }

    const card = (c: CaseListRow) => (
        <ActionCard key={c.id} c={c} today={today}
            editing={editingId === c.id}
            onEdit={() => { setAlert(null); setEditingId(editingId === c.id ? null : c.id) }}
            onSaved={onSaved}
            onCancel={() => setEditingId(null)} />
    )

    const years = useMemo(() => {
        const y = Number(today.slice(0, 4))
        return Array.from({ length: 8 }, (_, i) => String(y + i))
    }, [today])

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="ios-page-title flex items-center gap-2"><Target size={22} className="text-[#03a9e7]" /> Action Centre</h1>
                    <p className="page-subtitle">Who you need to follow up with, and when. Every case always has a next step.</p>
                </div>
                <ViewToggle view={view} onChange={changeView} />
            </div>

            {/* Counts */}
            <div className="grid grid-cols-3 gap-3">
                <Stat label="Overdue" value={overdueQ.total} tone="red" />
                <Stat label="Today" value={todayQ.total} tone="amber" />
                <Stat label={`Next ${SOON_DAYS} days`} value={soonQ.total} tone="blue" />
            </div>

            {alert && <InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} />}

            {firstLoad ? (
                <div className="flex items-center justify-center py-16"><Spinner size="md" color="#03a9e7" label="Loading…" /></div>
            ) : view === 'calendar' ? (
                <div className="space-y-4">
                    {overdueQ.total + missingQ.total > 0 && (
                        <button onClick={() => changeView('list')}
                            className="w-full flex items-center gap-2 p-3 rounded-xl border border-red-200 bg-red-50 text-left hover:bg-red-100 transition-colors">
                            <AlertCircle size={15} className="text-red-500 shrink-0" />
                            <span className="text-xs font-semibold text-red-600">
                                {[overdueQ.total > 0 && `${overdueQ.total} overdue`, missingQ.total > 0 && `${missingQ.total} without a date`].filter(Boolean).join(' · ')}: open list view
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
                        <Section icon={CalendarDays} title={fmt(selectedDate)} count={dayRows.length} tone="blue">
                            {dayRows.length === 0
                                ? <p className="text-sm text-slate-400 px-1">No follow-ups on this date.</p>
                                : dayRows.map(card)}
                        </Section>
                    )}
                </div>
            ) : (
                <div className="space-y-8">
                    {nowCount === 0 && (
                        <div className="card p-8 text-center space-y-2">
                            <CalendarCheck size={28} className="text-emerald-500 mx-auto" />
                            <p className="font-semibold text-slate-700">You&apos;re all caught up</p>
                            <p className="text-sm text-slate-500">Nothing overdue or due in the next {SOON_DAYS} days.</p>
                        </div>
                    )}

                    {missingQ.total > 0 && (
                        <Section icon={CalendarPlus} title="Needs a follow-up date" count={missingQ.total} tone="red"
                            hint="Every case needs a next follow-up. Set one so these clients aren't forgotten.">
                            {missingQ.rows.map(card)}
                            <LoadMore q={missingQ} />
                        </Section>
                    )}
                    {overdueQ.total > 0 && (
                        <Section icon={AlertCircle} title="Overdue" count={overdueQ.total} tone="red">
                            {overdueQ.rows.map(card)}
                            <LoadMore q={overdueQ} />
                        </Section>
                    )}
                    {todayQ.total > 0 && (
                        <Section icon={CalendarClock} title="Today" count={todayQ.total} tone="amber">
                            {todayQ.rows.map(card)}
                            <LoadMore q={todayQ} />
                        </Section>
                    )}
                    {soonQ.total > 0 && (
                        <Section icon={CalendarDays} title={`Next ${SOON_DAYS} days`} count={soonQ.total} tone="blue">
                            {soonQ.rows.map(card)}
                            <LoadMore q={soonQ} />
                        </Section>
                    )}

                    {/* Plan ahead: everything from day 15 on */}
                    <section className="pt-2 border-t border-slate-200">
                        <div className="flex items-center gap-2 mb-1 mt-5">
                            <CalendarDays size={16} className="text-slate-500" />
                            <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wide">
                                All upcoming follow-ups {!laterEmpty && !laterQ.loading && `(${laterQ.total})`}
                            </h2>
                        </div>
                        <p className="text-xs text-slate-400 mb-3">From {fmt(addDays(soonEnd, 1))} onward, soonest first.</p>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                            <label className="col-span-2 relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Client name or mobile"
                                    className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7]" />
                            </label>
                            <select value={stage} onChange={e => setStage(e.target.value)}
                                className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7]">
                                <option value="all">All statuses</option>
                                {PIPELINE_STAGES.map(s => <option key={s} value={s}>{stageLabel(s)}</option>)}
                            </select>
                            <div className="flex gap-2">
                                <select value={year} onChange={e => { setYear(e.target.value); if (!e.target.value) setMonthFilter('') }}
                                    className="flex-1 min-w-0 px-2 py-2 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7]">
                                    <option value="">Any year</option>
                                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                                <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} disabled={!year}
                                    className="flex-1 min-w-0 px-2 py-2 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] disabled:opacity-50">
                                    <option value="">Any month</option>
                                    {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="space-y-2.5">
                            {laterEmpty ? (
                                <p className="text-sm text-slate-400 px-1">That period is covered by the sections above.</p>
                            ) : laterQ.loading ? (
                                <div className="py-6 flex justify-center"><Spinner size="sm" color="#03a9e7" label="Loading…" /></div>
                            ) : laterQ.rows.length === 0 ? (
                                <p className="text-sm text-slate-400 px-1">No follow-ups match.</p>
                            ) : laterQ.rows.map(card)}
                            {!laterEmpty && <LoadMore q={laterQ} />}
                        </div>
                    </section>
                </div>
            )}
        </div>
    )
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

const TONES = {
    red: { text: 'text-red-600', icon: 'text-red-500', pill: 'bg-red-50 text-red-600' },
    amber: { text: 'text-amber-600', icon: 'text-amber-500', pill: 'bg-amber-50 text-amber-700' },
    blue: { text: 'text-[#0369a1]', icon: 'text-[#03a9e7]', pill: 'bg-sky-50 text-[#0369a1]' },
} as const
type Tone = keyof typeof TONES

function Stat({ label, value, tone }: { label: string; value: number; tone: Tone }) {
    return (
        <div className="card p-3.5">
            <p className="text-[11px] font-semibold text-slate-500">{label}</p>
            <p className={`text-2xl font-extrabold ${value > 0 ? TONES[tone].text : 'text-slate-300'}`}>{value}</p>
        </div>
    )
}

function Section({ icon: Icon, title, count, tone, hint, children }: {
    icon: React.ElementType; title: string; count: number; tone: Tone; hint?: string; children: React.ReactNode
}) {
    return (
        <section>
            <div className="flex items-center gap-2 mb-1">
                <Icon size={16} className={TONES[tone].icon} />
                <h2 className={`text-sm font-bold uppercase tracking-wide ${TONES[tone].text}`}>{title}</h2>
                <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${TONES[tone].pill}`}>{count}</span>
            </div>
            {hint && <p className="text-xs text-slate-500 mb-2">{hint}</p>}
            <div className="space-y-2.5 mt-2">{children}</div>
        </section>
    )
}

function ActionCard({ c, today, editing, onEdit, onSaved, onCancel }: {
    c: CaseListRow; today: string; editing: boolean
    onEdit: () => void; onSaved: () => void; onCancel: () => void
}) {
    const date = c.follow_up_date?.slice(0, 10)
    const days = date ? daysBetween(today, date) : null
    const overdue = days != null && days < 0
    const badge = stageBadge(c.stage)
    const nextCycle = c.closed_won_data?.combined_outstanding

    return (
        <div className="card p-4" style={{ borderLeft: `3px solid ${!date || overdue ? '#ef4444' : days === 0 ? '#f59e0b' : '#03a9e7'}` }}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/insurance/dashboard/cases/${c.id}`} className="text-sm font-bold text-slate-800 hover:text-[#03a9e7] truncate">
                            {c.client_name || 'Unnamed client'}
                        </Link>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: badge.bg, color: badge.text }}>{stageLabel(c.stage)}</span>
                        {c.stage === 'Closed Won' && c.client_reminder_opt_in && (
                            <span title="Client gets a WhatsApp + email reminder on this date" className="text-[#03a9e7]"><Mail size={13} /></span>
                        )}
                    </div>
                    {c.follow_up_remark && <p className="text-sm text-slate-700 mt-0.5">{c.follow_up_remark}</p>}
                    <p className={`text-xs mt-1 flex items-center gap-1 ${!date || overdue ? 'text-red-600' : days === 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                        <CalendarDays size={12} />
                        {!date ? 'No follow-up date'
                            : `${fmt(date)} · ${days === 0 ? 'Due today' : overdue ? `${-days!} day${days === -1 ? '' : 's'} overdue` : `in ${days} day${days === 1 ? '' : 's'}`}`}
                        <span className="text-slate-400">· {c.case_type}{c.client_mobile ? ` · ${c.client_mobile}` : ''}</span>
                    </p>
                    {nextCycle ? (
                        <p className="text-[11px] font-semibold text-[#03a9e7] mt-1 flex items-center gap-1">
                            <TrendingUp size={11} /> Potential next-cycle income: {money(calculateCommission(nextCycle).agent)}
                        </p>
                    ) : null}
                </div>
                <button type="button" onClick={onEdit}
                    className={`shrink-0 px-3 py-1.5 text-xs font-bold rounded-full border flex items-center gap-1.5 transition-colors ${
                        editing ? 'border-slate-300 text-slate-500' : 'border-[#03a9e7] text-[#03a9e7] hover:bg-sky-50'
                    }`}>
                    <CalendarClock size={13} /> {editing ? 'Close' : date ? 'Update FU' : 'Set FU'}
                </button>
            </div>
            {editing && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                    <FollowUpUpdateForm c={c} title={`Update follow-up · ${c.client_name || 'client'}`} onSaved={onSaved} onCancel={onCancel} />
                </div>
            )}
        </div>
    )
}

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

function LoadMore({ q }: { q: { rows: unknown[]; total: number; hasMore: boolean; loadingMore: boolean; loadMore: () => void } }) {
    if (!q.hasMore) return null
    return (
        <button onClick={q.loadMore} disabled={q.loadingMore}
            className="mt-1 w-full py-2.5 text-xs font-semibold rounded-lg border border-slate-200 text-[#0369a1] hover:bg-slate-50 disabled:text-slate-300">
            {q.loadingMore ? 'Loading…' : `Load more (${q.total - q.rows.length} remaining)`}
        </button>
    )
}
