'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { invalidateCaseLists } from '@/lib/insurance/caseCache'
import { useDebouncedValue } from '@/lib/insurance/usePagedCases'
import { actionCentreStore as store, applyFollowUpSave } from '@/lib/insurance/actionCentreStore'
import {
    CALENDAR_PREFIX, nothingDue, NOW_KEY, sectionKey, TAB_ORDER, urgentTab,
    type ActionCounts, type ActionDay, type ActionMeta, type ActionRow, type ActionTab,
} from '@/lib/insurance/actionCentre'
import { useList } from '@/lib/shared/useList'
import { todaySgt } from '@/lib/insurance/promotions'
import { addDays, daysBetween, SOON_DAYS } from '@/lib/insurance/followUps'
import { PIPELINE_STAGES, stageBadge, stageLabel } from '@/lib/insurance/stages'
import FollowUpCalendar, { ymd } from '@/components/insurance/followup/FollowUpCalendar'
import FollowUpUpdateForm, { type FollowUpSaved } from '@/components/insurance/followup/FollowUpUpdateForm'
import InlineAlert from '@/components/shared/InlineAlert'
import LoadFailed from '@/components/shared/LoadFailed'
import LoadMore from '@/components/shared/LoadMore'
import Skeleton from '@/components/shared/Skeleton'
import {
    AlertCircle, ArrowRight, CalendarDays, CalendarClock, ChevronRight, List, Target,
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
 *   Later (day 15+) — plan ahead: lock-ins expiring months or years out, with
 *     search / status / year / month filters. No case appears in two sections.
 *
 * Each is a TAB, one on screen at a time: every section is one tap away however
 * many cases the others hold. Opens on the most urgent one with cases, and never
 * switches by itself while the agent works.
 *
 * Built for thousands of cases: one request brings the counts and the first
 * rows (shared with the sidebar badge); more rows load on scroll; Later loads
 * only when opened. A save moves the one case between the loaded lists
 * (lib/insurance/actionCentre.ts), so the agent keeps their place.
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

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const FILTER = 'h-10 px-3 text-sm rounded-lg border border-slate-200 bg-white text-slate-700 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/20 shrink-0'

const LATER_DEBOUNCE_MS = 300

export default function ActionCentrePage() {
    const today = useMemo(() => todaySgt(), [])
    const soonEnd = addDays(today, SOON_DAYS)

    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [editingId, setEditingId] = useState<string | null>(null)
    const view = useSyncExternalStore(viewStore.subscribe, viewStore.get, viewStore.serverGet)
    const [tab, setTab] = useState<ActionTab | null>(null)
    const [month, setMonth] = useState(() => startOfMonth(new Date()))
    const [selectedDate, setSelectedDate] = useState<string | null>(null)

    const changeView = (v: View) => { setSelectedDate(null); setEditingId(null); viewStore.set(v) }
    const openTab = (t: ActionTab) => { setEditingId(null); setTab(t) }

    const isList = view === 'list'
    const now = useList<ActionRow, ActionMeta>(store, NOW_KEY)
    const counts = now.meta?.counts
    // Picked once, when the counts first arrive; after that only a tap changes it.
    if (counts && !tab) setTab(urgentTab(counts) ?? 'overdue')

    const listTab = tab && tab !== 'later' ? tab : 'overdue'
    // Waits for the counts: their request usually fills this list too.
    const tabQ = useList<ActionRow>(store, sectionKey(listTab), { enabled: isList && !!counts && !!tab && tab !== 'later' })

    const monthKey = `${CALENDAR_PREFIX}&month=${ymd(month).slice(0, 7)}`
    const cal = useList<ActionDay>(store, monthKey, { enabled: view === 'calendar' })
    const dayQ = useList<ActionRow>(store, sectionKey('day', { date: selectedDate ?? today }), { enabled: view === 'calendar' && !!selectedDate })

    const onSaved = (before: ActionRow, saved: FollowUpSaved) => {
        setEditingId(null)
        setAlert({ type: 'success', message: 'Follow-up saved.' })
        applyFollowUpSave(before, { ...before, ...saved }, today)
        invalidateCaseLists()
    }

    const card = (c: ActionRow) => (
        <ActionCard key={c.id} c={c} today={today}
            editing={editingId === c.id}
            onEdit={() => { setAlert(null); setEditingId(editingId === c.id ? null : c.id) }}
            onSaved={saved => onSaved(c, saved)}
            onCancel={() => setEditingId(null)} />
    )

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="ios-page-title flex items-center gap-2"><Target size={22} className="text-[#03a9e7]" /> Action Centre</h1>
                    <p className="page-subtitle">Who you need to follow up with, and when. Every case always has a next step.</p>
                </div>
                <ViewToggle view={view} onChange={changeView} />
            </div>

            {isList && <Tabs counts={counts} active={tab} onPick={openTab} />}

            {/* Floats, so saving deep in a long list neither hides it nor moves the list. */}
            {alert && (
                <div className="fixed bottom-24 md:bottom-4 inset-x-4 z-50 mx-auto max-w-md" role="status">
                    <InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} />
                </div>
            )}
            {now.outOfDate && <LoadFailed message="Couldn’t refresh. Showing what was loaded earlier." onRetry={now.retry} />}

            {view === 'calendar' ? (
                <div className="space-y-4">
                    {counts && counts.overdue + counts.missing > 0 && (
                        <button onClick={() => { changeView('list'); openTab(counts.overdue > 0 ? 'overdue' : 'missing') }}
                            className="w-full flex items-center gap-2 p-3 rounded-xl border border-red-200 bg-red-50 text-left hover:bg-red-100 transition-colors">
                            <AlertCircle size={15} className="text-red-500 shrink-0" />
                            <span className="text-xs font-semibold text-red-600">
                                {[counts.overdue > 0 && `${counts.overdue} overdue`, counts.missing > 0 && `${counts.missing} without a date`].filter(Boolean).join(' · ')}: open list view
                            </span>
                            <ChevronRight size={14} className="text-red-400 ml-auto shrink-0" />
                        </button>
                    )}
                    {(cal.status === 'error' || cal.outOfDate) && <LoadFailed message="Couldn’t load this month’s follow-ups." onRetry={cal.retry} />}
                    <FollowUpCalendar
                        days={cal.rows}
                        month={month}
                        today={today}
                        selectedDate={selectedDate}
                        loading={cal.status === 'loading'}
                        onPrevMonth={() => { setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1)); setSelectedDate(null) }}
                        onNextMonth={() => { setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1)); setSelectedDate(null) }}
                        onToday={() => { setMonth(startOfMonth(new Date())); setSelectedDate(today) }}
                        onSelectDate={setSelectedDate}
                    />
                    {selectedDate && (
                        <Section icon={CalendarDays} title={fmt(selectedDate)} count={dayQ.total} tone="blue">
                            <Rows q={dayQ} card={card} empty={<p className="text-sm on-navy-muted px-1">No follow-ups on this date.</p>} />
                        </Section>
                    )}
                </div>
            ) : now.status === 'error' ? (
                <LoadFailed message="Couldn’t load your follow-ups." onRetry={now.retry} />
            ) : !counts || !tab ? (
                <CardSkeletons n={5} />
            ) : (
                <div className="space-y-5" role="tabpanel" aria-label={TABS[tab].label}>
                    {nothingDue(counts) && <AllCaughtUp />}
                    {tab === 'later' ? (
                        <Later today={today} soonEnd={soonEnd} card={card} />
                    ) : (
                        <div className="space-y-2.5">
                            {tab === 'missing' && counts.missing > 0 && (
                                <p className="text-xs on-navy-muted">Every case needs a next follow-up. Set one so these clients aren&apos;t forgotten.</p>
                            )}
                            <Rows q={tabQ} card={card} empty={<TabEmpty tab={tab} counts={counts} onPick={openTab} />} />
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

// Two palettes: `text` sits inside white cards (stat tiles), `head` / `icon`
// sit straight on the navy Internal background (section headings).
const TONES = {
    red: { text: 'text-red-600', head: 'text-red-300', icon: 'text-red-300', pill: 'bg-red-50 text-red-600' },
    amber: { text: 'text-amber-600', head: 'text-amber-300', icon: 'text-amber-300', pill: 'bg-amber-50 text-amber-700' },
    blue: { text: 'text-[#0369a1]', head: 'text-sky-300', icon: 'text-sky-300', pill: 'bg-sky-50 text-[#0369a1]' },
} as const
type Tone = keyof typeof TONES

const TABS: Record<ActionTab, { label: string; empty: string; tone: string }> = {
    missing: { label: 'Needs a date', empty: 'Every case has a follow-up date.', tone: 'text-red-600' },
    overdue: { label: 'Overdue', empty: 'No overdue follow-ups.', tone: 'text-red-600' },
    today: { label: 'Today', empty: 'Nothing left for today.', tone: 'text-amber-600' },
    soon: { label: `Next ${SOON_DAYS} days`, empty: `Nothing due in the next ${SOON_DAYS} days.`, tone: 'text-[#0369a1]' },
    later: { label: 'Later', empty: '', tone: 'text-[#0369a1]' },
}

/** One section at a time. A count that isn't known yet shows a dash, never 0. */
function Tabs({ counts, active, onPick }: { counts?: ActionCounts; active: ActionTab | null; onPick: (t: ActionTab) => void }) {
    // "Needs a date" is there only when it has something (or is being looked at).
    const shown = TAB_ORDER.filter(t => t !== 'missing' || active === 'missing' || (counts?.missing ?? 0) > 0)
    return (
        <div role="tablist" aria-label="Follow-ups" className="flex gap-1 p-1 rounded-2xl bg-white border border-slate-200 overflow-x-auto">
            {shown.map(t => {
                const on = t === active
                const n = counts?.[t]
                return (
                    <button key={t} type="button" role="tab" aria-selected={on} onClick={() => onPick(t)}
                        className={`flex-1 shrink-0 min-h-[60px] px-3 rounded-xl text-center whitespace-nowrap transition-colors ${on ? 'bg-[#03a9e7] text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                        <span className="block text-xs font-semibold">{TABS[t].label}</span>
                        <span className={`block text-xl font-extrabold leading-tight ${on ? '' : n ? TABS[t].tone : 'text-slate-300'}`}>{n ?? '–'}</span>
                    </button>
                )
            })}
        </div>
    )
}

function AllCaughtUp() {
    return (
        <div className="card p-6 text-center space-y-1.5">
            <CalendarCheck size={28} className="text-emerald-500 mx-auto" />
            <p className="font-semibold text-slate-700">You&apos;re all caught up</p>
            <p className="text-sm text-slate-500">Nothing overdue or due in the next {SOON_DAYS} days.</p>
        </div>
    )
}

/** A cleared tab: says so, and offers the next one that needs work. */
function TabEmpty({ tab, counts, onPick }: { tab: ActionTab; counts: ActionCounts; onPick: (t: ActionTab) => void }) {
    const next = urgentTab(counts, tab)
    return (
        <div className="card p-6 text-center space-y-3">
            <p className="text-sm font-semibold text-slate-700">{TABS[tab].empty}</p>
            {next && (
                <button type="button" onClick={() => onPick(next)}
                    className="min-h-[44px] px-4 rounded-full bg-[#03a9e7] text-white text-sm font-bold inline-flex items-center gap-1.5">
                    Go to {TABS[next].label} ({counts[next]}) <ArrowRight size={14} />
                </button>
            )}
        </div>
    )
}

function CardSkeletons({ n }: { n: number }) {
    return <div className="space-y-2.5" aria-busy="true" aria-label="Loading follow-ups">{Array.from({ length: n }, (_, i) => <Skeleton key={i} height={92} radius={14} style={{ display: 'block' }} />)}</div>
}

type RowsQuery = ReturnType<typeof useList<ActionRow>>

/** One list in its four states: loading, failed, empty, rows. */
function Rows({ q, card, empty }: { q: RowsQuery; card: (c: ActionRow) => React.ReactNode; empty: React.ReactNode }) {
    if (q.status === 'loading') return <CardSkeletons n={3} />
    if (q.status === 'error') return <LoadFailed message="Couldn’t load these follow-ups." onRetry={q.retry} />
    if (q.status === 'empty') return <>{q.outOfDate && <LoadFailed message="Couldn’t refresh. Showing what was loaded earlier." onRetry={q.retry} />}{empty}</>
    return (
        <>
            {q.outOfDate && <LoadFailed message="Couldn’t refresh. Showing what was loaded earlier." onRetry={q.retry} />}
            {q.rows.map(card)}
            <LoadMore hasMore={q.hasMore} loading={q.loadingMore} failed={q.moreError} onLoad={q.loadMore}
                remaining={q.total == null ? null : q.total - q.rows.length} />
        </>
    )
}

/** Day 15 onward, narrowed by the filters. Mounted only when its tab is open, so it loads only then. */
function Later({ today, soonEnd, card }: { today: string; soonEnd: string; card: (c: ActionRow) => React.ReactNode }) {
    const [search, setSearch] = useState('')
    const [stage, setStage] = useState('')
    const [year, setYear] = useState('')
    const [monthFilter, setMonthFilter] = useState('')
    const typed = search.trim()
    const settled = useDebouncedValue(typed, LATER_DEBOUNCE_MS)

    const range = useMemo(() => {
        if (!year) return {}
        const y = Number(year)
        const m = monthFilter ? Number(monthFilter) : null
        return {
            from: m ? `${y}-${String(m).padStart(2, '0')}-01` : `${y}-01-01`,
            to: m ? new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) : `${y}-12-31`,
        } as { from?: string; to?: string }
    }, [year, monthFilter])
    // Wholly inside the sections above.
    const covered = !!range.to && range.to <= soonEnd
    const q = useList<ActionRow>(store, sectionKey('later', { ...range, stage, search: settled }), { enabled: !covered })
    const shown = settled !== typed ? { ...q, status: 'loading' as const } : q

    const years = useMemo(() => {
        const y = Number(today.slice(0, 4))
        return Array.from({ length: 8 }, (_, i) => String(y + i))
    }, [today])

    return (
        <section>
            <div className="flex items-center gap-2 mb-1">
                <CalendarDays size={16} className="on-navy-muted" />
                <h2 className="text-sm font-bold on-navy-strong uppercase tracking-wide">
                    All upcoming follow-ups {!covered && shown.status !== 'loading' && q.total != null && `(${q.total})`}
                </h2>
            </div>
            <p className="text-xs on-navy-muted mb-3">From {fmt(addDays(soonEnd, 1))} onward, soonest first.</p>

            {/* Search takes the free space; each dropdown keeps a fixed width so its
                label never truncates. Month appears only once a year is
                picked (a greyed-out control reads as broken). Wraps on iPad portrait. */}
            <div className="flex flex-wrap gap-2 mb-3">
                <label className="relative flex-1 min-w-[220px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={search} maxLength={80} onChange={e => setSearch(e.target.value)} placeholder="Client name or mobile"
                        className={`${FILTER} w-full pl-8`} />
                </label>
                <select value={stage} onChange={e => setStage(e.target.value)} className={`${FILTER} w-[170px]`} aria-label="Status">
                    <option value="">All statuses</option>
                    {PIPELINE_STAGES.map(s => <option key={s} value={s}>{stageLabel(s)}</option>)}
                </select>
                <select value={year} onChange={e => { setYear(e.target.value); if (!e.target.value) setMonthFilter('') }}
                    className={`${FILTER} w-[128px]`} aria-label="Year">
                    <option value="">All years</option>
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                {year && (
                    <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
                        className={`${FILTER} w-[140px]`} aria-label="Month">
                        <option value="">All months</option>
                        {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m} {year}</option>)}
                    </select>
                )}
            </div>

            <div className="space-y-2.5">
                {covered
                    ? <p className="text-sm on-navy-muted px-1">That period is covered by the sections above.</p>
                    : <Rows q={shown} card={card} empty={<p className="text-sm on-navy-muted px-1">{typed || stage || year ? 'No follow-ups match.' : `Nothing planned beyond the next ${SOON_DAYS} days.`}</p>} />}
            </div>
        </section>
    )
}

function Section({ icon: Icon, title, count, tone, hint, children }: {
    icon: React.ElementType; title: string; count?: number | null; tone: Tone; hint?: string; children: React.ReactNode
}) {
    return (
        <section>
            <div className="flex items-center gap-2 mb-1">
                <Icon size={16} className={TONES[tone].icon} />
                <h2 className={`text-sm font-bold uppercase tracking-wide ${TONES[tone].head}`}>{title}</h2>
                {count != null && <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${TONES[tone].pill}`}>{count}</span>}
            </div>
            {hint && <p className="text-xs on-navy-muted mb-2">{hint}</p>}
            <div className="space-y-2.5 mt-2">{children}</div>
        </section>
    )
}

function ActionCard({ c, today, editing, onEdit, onSaved, onCancel }: {
    c: ActionRow; today: string; editing: boolean
    onEdit: () => void; onSaved: (saved: FollowUpSaved) => void; onCancel: () => void
}) {
    const date = c.follow_up_date?.slice(0, 10)
    const days = date ? daysBetween(today, date) : null
    const overdue = days != null && days < 0
    const badge = stageBadge(c.stage)
    const nextCycle = c.closed_won_data?.combined_outstanding

    return (
        // Off-screen cards skip layout and paint, so a long list stays smooth on iPad.
        <div className="card p-4" style={{ contentVisibility: editing ? 'visible' : 'auto', containIntrinsicSize: 'auto 96px', borderLeft: `3px solid ${!date || overdue ? '#ef4444' : days === 0 ? '#f59e0b' : '#03a9e7'}` }}>
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
