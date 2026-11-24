'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
    DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable,
    useSensor, useSensors, type DragEndEvent, type DragStartEvent, type TouchSensorOptions,
} from '@dnd-kit/core'
import type { TouchEvent as ReactTouchEvent } from 'react'
import { AlertCircle, ArrowRightLeft, CalendarDays, Clock, GripVertical, Phone } from 'lucide-react'
import { usePagedCases, type CaseListRow } from '@/lib/insurance/usePagedCases'
import { invalidateCaseData } from '@/lib/insurance/caseCache'
import { stageLabel } from '@/lib/insurance/stages'
import { todaySgt } from '@/lib/insurance/promotions'
import { addDays } from '@/lib/insurance/followUps'
import { daysInStage, isStuck } from '@/lib/insurance/stageAge'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import FollowUpUpdateForm from '@/components/insurance/followup/FollowUpUpdateForm'
import BankerMultiSelect from '@/components/insurance/BankerMultiSelect'
import type { PipelineStage, ReferredBanker } from '@/lib/types'

/**
 * Track — the open pipeline as a board (Cases → Track, the default tab).
 *
 * Four columns: Active (Touched Base) · Pending Docs · Pending Approval ·
 * Pending Signature, each with its count and potential revenue (0.15% of the
 * column's loan volume, same figure as the Cases list). A case leaves the board
 * when it becomes Inactive, Closed Won or Closed Lost — those happen on the case
 * page, where Closed Won gets its careful review.
 *
 * Speed first: drag a card to another column (forwards or back) and a small
 * form asks only for the next follow-up (quick-pick dates, remark pre-filled for
 * the new status); moving into Pending Docs also offers an optional banker
 * picker. One save updates status + follow-up (+ bankers) together.
 *
 * Touch (iPad) — three ways to move a card, none needing instructions:
 *   • press and hold anywhere on the card (~¼ s) → it lifts, then drag;
 *     a quick swipe still scrolls the board (the hold hasn't completed);
 *   • the ⋮⋮ grip on its left edge drags immediately (touch-action: none);
 *   • the ⇄ Move button → pick the column. No dragging at all.
 * Two touch sensors split the work by WHERE the finger lands (grip vs card),
 * so their activation rules never fight. A single press-and-hold sensor with a
 * tiny tolerance failed on iPad: any wobble during the hold became a scroll.
 * With a mouse the whole card drags after 6px.
 */

const REVENUE_RATE = 0.0015
const PAGE = 30

interface Col { stage: PipelineStage; head: string; body: string; accent: string }
const COLUMNS: Col[] = [
    { stage: 'Touched Base',      head: '#fef3c7', body: '#fffbeb', accent: '#b45309' },   // yellow
    { stage: 'Pending Docs',      head: '#dcfce7', body: '#f0fdf4', accent: '#15803d' },   // light green
    { stage: 'Pending Approval',  head: '#bbf7d0', body: '#ecfdf5', accent: '#166534' },   // mid green
    { stage: 'Pending Signature', head: '#86efac', body: '#e7f8ee', accent: '#14532d' },   // deep green
]

/** Time of the last drag start/end — a click right after one is the drop, not a tap. */
let lastDragAt = 0

const onlyOneFinger = (event: TouchEvent) => event.touches.length <= 1
const onGrip = (event: TouchEvent) => !!(event.target as HTMLElement | null)?.closest?.('[data-drag-grip]')

/** Touch that starts on the ⋮⋮ grip: drags immediately. */
class GripTouchSensor extends TouchSensor {
    static activators = [{
        eventName: 'onTouchStart' as const,
        handler: ({ nativeEvent }: ReactTouchEvent, { onActivation }: TouchSensorOptions) => {
            if (!onlyOneFinger(nativeEvent) || !onGrip(nativeEvent)) return false
            onActivation?.({ event: nativeEvent })
            return true
        },
    }]
}

/** Touch anywhere else on the card: lifts after a short hold, so swipes still scroll. */
class HoldTouchSensor extends TouchSensor {
    static activators = [{
        eventName: 'onTouchStart' as const,
        handler: ({ nativeEvent }: ReactTouchEvent, { onActivation }: TouchSensorOptions) => {
            if (!onlyOneFinger(nativeEvent) || onGrip(nativeEvent)) return false
            onActivation?.({ event: nativeEvent })
            return true
        },
    }]
}

const fmtShort = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: '2-digit' })

interface Banker { name: string; bank: string }
type Filter = { followUpTo?: string; bankerName?: string; bankerBank?: string }

function useOpenBankers(agent?: string): (Banker & { cases: number })[] {
    const [list, setList] = useState<(Banker & { cases: number })[]>([])
    useEffect(() => {
        let alive = true
        fetch(`/api/insurance/cases/bankers${agent ? `?agent=${agent}` : ''}`)
            .then(r => (r.ok ? r.json() : { bankers: [] }))
            .then(d => { if (alive) setList(d.bankers ?? []) })
            .catch(() => { /* the filter just doesn't show */ })
        return () => { alive = false }
    }, [agent])
    return list
}

export default function TrackBoard({ search, agent, readOnly, hrefFor = id => `/insurance/dashboard/cases/${id}` }: {
    search: string
    agent?: string
    /** Admin: look, don't move. Cards also show the agent. */
    readOnly?: boolean
    hrefFor?: (id: string) => string
}) {
    const today = todaySgt()
    const [overdueOnly, setOverdueOnly] = useState(false)
    const [banker, setBanker] = useState<Banker | null>(null)
    const bankers = useOpenBankers(agent)
    const filter = {
        ...(overdueOnly ? { followUpTo: addDays(today, -1) } : {}),
        ...(banker ? { bankerName: banker.name, bankerBank: banker.bank } : {}),
    }
    const [dragging, setDragging] = useState<CaseListRow | null>(null)
    // `to` unset = opened from the Move button: pick the column first.
    const [move, setMove] = useState<{ c: CaseListRow; to?: PipelineStage } | null>(null)

    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
        useSensor(GripTouchSensor, { activationConstraint: { distance: 4 } }),
        useSensor(HoldTouchSensor, { activationConstraint: { delay: 250, tolerance: 14 } }),
    )

    const onDragStart = (e: DragStartEvent) => {
        lastDragAt = Date.now()
        setDragging((e.active.data.current?.c as CaseListRow) ?? null)
    }
    const onDragEnd = (e: DragEndEvent) => {
        lastDragAt = Date.now()
        setDragging(null)
        const c = e.active.data.current?.c as CaseListRow | undefined
        const to = e.over?.id as PipelineStage | undefined
        if (c && to && to !== c.stage) setMove({ c, to })
    }

    return (
        <>
            <div className="flex flex-wrap items-center gap-2 mb-3">
                <button type="button" onClick={() => setOverdueOnly(v => !v)} aria-pressed={overdueOnly}
                    className={`h-10 px-3.5 rounded-full text-sm font-semibold border flex items-center gap-1.5 transition-colors ${
                        overdueOnly ? 'bg-red-500 border-red-500 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}>
                    <AlertCircle size={15} /> Overdue follow-up
                </button>
                {(bankers.length > 0 || banker) && (
                    <select aria-label="Banker" value={banker ? JSON.stringify([banker.name, banker.bank]) : ''}
                        onChange={e => {
                            if (!e.target.value) { setBanker(null); return }
                            const [name, bank] = JSON.parse(e.target.value) as [string, string]
                            setBanker({ name, bank })
                        }}
                        className={`h-10 px-3 max-w-[260px] rounded-full text-sm font-semibold border bg-white outline-none focus:border-[#03a9e7] ${banker ? 'border-[#03a9e7] text-[#0369a1]' : 'border-slate-200 text-slate-600'}`}>
                        <option value="">All bankers</option>
                        {banker && !bankers.some(b => b.name === banker.name && b.bank === banker.bank) && (
                            <option value={JSON.stringify([banker.name, banker.bank])}>{banker.name} ({banker.bank})</option>
                        )}
                        {bankers.map(b => (
                            <option key={`${b.bank}|${b.name}`} value={JSON.stringify([b.name, b.bank])}>{b.name} ({b.bank}) · {b.cases}</option>
                        ))}
                    </select>
                )}
                {(overdueOnly || banker) && (
                    <button type="button" onClick={() => { setOverdueOnly(false); setBanker(null) }} className="h-10 px-2 text-sm font-semibold on-navy-muted">Clear</button>
                )}
            </div>
            <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => { lastDragAt = Date.now(); setDragging(null) }}>
                <div className="grid grid-flow-col auto-cols-[minmax(232px,1fr)] gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                    {COLUMNS.map(col => (
                        <Column key={col.stage} col={col} filter={filter} readOnly={readOnly} hrefFor={hrefFor} search={search} agent={agent} today={today} draggingId={dragging?.id}
                            onMove={c => setMove({ c })} />
                    ))}
                </div>
                <DragOverlay dropAnimation={null}>
                    {dragging ? <CardBody c={dragging} today={today} showBanker={dragging.stage !== 'Touched Base'} lifted /> : null}
                </DragOverlay>
            </DndContext>

            {move && (
                <MoveModal c={move.c} to={move.to} onClose={() => setMove(null)} />
            )}
        </>
    )
}

function Column({ col, filter, search, agent, today, draggingId, onMove, readOnly, hrefFor }: {
    readOnly?: boolean; hrefFor: (id: string) => string
    col: Col; filter: Filter; search: string; agent?: string; today: string; draggingId?: string
    onMove: (c: CaseListRow) => void
}) {
    const q = usePagedCases({ ...filter, stage: col.stage, search, agent, sort: 'follow_up_date', dir: 'asc', limit: PAGE })
    const { setNodeRef, isOver } = useDroppable({ id: col.stage })

    return (
        <section ref={setNodeRef}
            className="rounded-2xl flex flex-col min-h-[320px] transition-shadow"
            style={{ background: col.body, boxShadow: isOver ? `0 0 0 2px ${col.accent}` : '0 0 0 1px #e2e8f0' }}>
            <header className="rounded-t-2xl px-3.5 py-3" style={{ background: col.head }}>
                <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold" style={{ color: col.accent }}>{stageLabel(col.stage)}</h3>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white/70" style={{ color: col.accent }}>{q.total}</span>
                </div>
                <p className="text-lg font-extrabold text-[#052d4a] leading-tight mt-0.5">{q.loanVolume > 0 ? formatCurrency(q.loanVolume * REVENUE_RATE) : '$0'}</p>
                <p className="text-[10px] text-slate-500">potential revenue</p>
            </header>

            <div className={`flex-1 p-2 space-y-2 ${q.refreshing ? 'opacity-60' : ''}`}>
                {q.loading ? (
                    <p className="text-xs text-slate-400 text-center py-6">Loading…</p>
                ) : q.rows.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-8 border-2 border-dashed border-slate-200 rounded-xl">
                        {search || Object.keys(filter).length > 0 ? 'No matches' : readOnly ? 'No cases' : 'Drag a case here'}
                    </p>
                ) : q.rows.map(c => (
                    <DraggableCard key={c.id} c={c} today={today} hidden={draggingId === c.id} onMove={() => onMove(c)} readOnly={readOnly} href={hrefFor(c.id)} />
                ))}
                {q.hasMore && (
                    <button onClick={q.loadMore} disabled={q.loadingMore}
                        className="w-full py-2 text-xs font-semibold rounded-lg bg-white/70 text-slate-600 hover:bg-white">
                        {q.loadingMore ? 'Loading…' : `Show more (${q.total - q.rows.length})`}
                    </button>
                )}
            </div>
        </section>
    )
}

function DraggableCard({ c, today, hidden, onMove, readOnly, href }: { c: CaseListRow; today: string; hidden: boolean; onMove: () => void; readOnly?: boolean; href: string }) {
    const router = useRouter()
    const { setNodeRef, attributes, listeners } = useDraggable({ id: c.id, data: { c }, disabled: readOnly })
    return (
        <div ref={setNodeRef} {...(readOnly ? {} : { ...attributes, ...listeners })}
            // A drop (or a hold that lifted the card) also ends in a click — ignore it.
            onClick={() => { if (Date.now() - lastDragAt > 400) router.push(href) }}
            className="select-none"
            style={{ opacity: hidden ? 0.3 : 1, WebkitTouchCallout: 'none' }}>
            <CardBody c={c} today={today} showBanker={c.stage !== 'Touched Base'} onMove={readOnly ? undefined : onMove} readOnly={readOnly} />
        </div>
    )
}

function CardBody({ c, today, showBanker, lifted, onMove, readOnly }: { readOnly?: boolean; c: CaseListRow; today: string; showBanker: boolean; lifted?: boolean; onMove?: () => void }) {
    const fu = c.follow_up_date?.slice(0, 10)
    const overdue = !fu || fu < today
    const dueToday = fu === today
    const banker = c.referred_bankers?.[0]
    const more = (c.referred_bankers?.length ?? 0) - 1
    const days = daysInStage(c.stage_changed_at)
    const stuck = isStuck(c.stage, days)
    return (
        <div className={`bg-white rounded-xl border border-slate-200 flex ${readOnly ? 'cursor-pointer' : 'cursor-grab'} ${lifted ? 'shadow-xl rotate-1 cursor-grabbing' : 'hover:border-slate-300 hover:shadow-sm'}`}>
            {/* Drag grip — touch-action: none makes a finger here drag at once on iPad.
                A tap on it doesn't open the case. */}
            {!readOnly && <span aria-hidden data-drag-grip onClick={e => e.stopPropagation()}
                className="w-8 shrink-0 flex items-center justify-center rounded-l-xl bg-slate-50 border-r border-slate-100 text-slate-400 cursor-grab"
                style={{ touchAction: 'none' }}>
                <GripVertical size={16} />
            </span>}
            <div className="flex-1 min-w-0 px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-slate-800 truncate">{c.client_name || 'Unnamed'}</p>
                <p className="text-sm font-bold text-[#052d4a] shrink-0">{c.loan_value ? formatCurrency(c.loan_value) : '—'}</p>
            </div>
            {readOnly && <p className="text-xs font-semibold text-[#0369a1] truncate">{c.profiles?.name ?? '—'}</p>}
            {c.client_mobile && (
                <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5"><Phone size={11} /> {c.client_mobile}</p>
            )}
            {showBanker && (
                <p className="text-xs text-slate-500 truncate mt-0.5">
                    {banker ? `${banker.name} (${banker.bank})${more > 0 ? ` +${more}` : ''}` : <span className="text-slate-300">No banker</span>}
                </p>
            )}
            {days != null && (
                <p className={`text-[11px] flex items-center gap-1 mt-0.5 ${stuck ? 'font-bold text-amber-700' : 'text-slate-400'}`}>
                    <Clock size={11} /> {days === 0 ? 'New in this stage today' : `${days} day${days === 1 ? '' : 's'} in this stage`}
                </p>
            )}
            <p className={`text-xs font-semibold flex items-center gap-1 mt-1 ${overdue ? 'text-red-600' : dueToday ? 'text-amber-600' : 'text-slate-500'}`}>
                <CalendarDays size={11} /> {fu ? `FU ${fmtShort(fu)}` : 'No follow-up'}{dueToday ? ' · today' : ''}
                {onMove && (
                    // Move without dragging. Stops its own touches so it never starts a drag.
                    <button type="button" aria-label="Move to another column" title="Move to another column"
                        onClick={e => { e.stopPropagation(); onMove() }}
                        onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}
                        className="ml-auto -my-1 -mr-1 h-8 px-2 rounded-lg flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-[#03a9e7]">
                        <ArrowRightLeft size={13} /> Move
                    </button>
                )}
            </p>
            </div>
        </div>
    )
}

function MoveModal({ c, to: initialTo, onClose }: { c: CaseListRow; to?: PipelineStage; onClose: () => void }) {
    const [to, setTo] = useState<PipelineStage | undefined>(initialTo)
    const [bankers, setBankers] = useState<ReferredBanker[]>(c.referred_bankers ?? [])
    const askBanker = to === 'Pending Docs'
    if (!to) {
        return (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.55)', backdropFilter: 'blur(3px)' }}
                onClick={onClose}>
                <div className="card w-full max-w-sm p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
                    <p className="text-sm font-bold text-[#052d4a] mb-3">Move {c.client_name || 'case'} to…</p>
                    <div className="space-y-2">
                        {COLUMNS.filter(col => col.stage !== c.stage).map(col => (
                            <button key={col.stage} type="button" onClick={() => setTo(col.stage)}
                                className="w-full h-12 px-4 rounded-xl text-left text-sm font-bold flex items-center justify-between border border-slate-200 hover:border-[#03a9e7]"
                                style={{ background: col.head, color: col.accent }}>
                                {stageLabel(col.stage)} <span aria-hidden>→</span>
                            </button>
                        ))}
                    </div>
                    <button type="button" onClick={onClose} className="mt-3 w-full h-10 text-sm font-semibold text-slate-500 rounded-xl hover:bg-slate-50">Cancel</button>
                </div>
            </div>
        )
    }
    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.55)', backdropFilter: 'blur(3px)' }}
            onClick={onClose}>
            <div className="card w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <FollowUpUpdateForm
                    c={c}
                    presetStage={to}
                    allowStageChange={false}
                    title={`${c.client_name || 'Case'} → ${stageLabel(to)}`}
                    extra={askBanker ? (
                        <div>
                            <p className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                                Referred banker(s) <span className="normal-case font-normal text-slate-400">(optional)</span>
                            </p>
                            <BankerMultiSelect value={bankers} onChange={setBankers} />
                        </div>
                    ) : undefined}
                    extraBody={askBanker ? { referred_bankers: bankers } : undefined}
                    onSaved={() => { onClose(); invalidateCaseData() }}
                    onCancel={onClose}
                />
            </div>
        </div>
    )
}
