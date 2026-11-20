'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
    DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable,
    useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { CalendarDays, GripVertical, Phone } from 'lucide-react'
import { usePagedCases, type CaseListRow } from '@/lib/insurance/usePagedCases'
import { invalidateCaseData } from '@/lib/insurance/caseCache'
import { stageLabel } from '@/lib/insurance/stages'
import { todaySgt } from '@/lib/insurance/promotions'
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
 * Touch (iPad): each card has a grip strip on its left edge. The grip has
 * `touch-action: none`, so a finger on it drags IMMEDIATELY; anywhere else on
 * the card the browser keeps the touch for scrolling (it cancels the pointer,
 * so no drag starts) and a tap opens the case. An earlier press-and-hold
 * approach failed on iPad whenever the finger drifted during the hold — iOS
 * claimed it as a scroll. With a mouse the whole card drags after 6px.
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

const fmtShort = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: '2-digit' })

export default function TrackBoard({ search, agent }: { search: string; agent?: string }) {
    const today = todaySgt()
    const [dragging, setDragging] = useState<CaseListRow | null>(null)
    const [move, setMove] = useState<{ c: CaseListRow; to: PipelineStage } | null>(null)

    // One pointer sensor for mouse, pen and touch. Touch only reaches it from
    // the grip (touch-action: none); elsewhere iOS takes the touch for scrolling.
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    )

    const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current?.c as CaseListRow) ?? null)
    const onDragEnd = (e: DragEndEvent) => {
        setDragging(null)
        const c = e.active.data.current?.c as CaseListRow | undefined
        const to = e.over?.id as PipelineStage | undefined
        if (c && to && to !== c.stage) setMove({ c, to })
    }

    return (
        <>
            <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
                <div className="grid grid-flow-col auto-cols-[minmax(232px,1fr)] gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                    {COLUMNS.map(col => (
                        <Column key={col.stage} col={col} search={search} agent={agent} today={today} draggingId={dragging?.id} />
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

function Column({ col, search, agent, today, draggingId }: {
    col: Col; search: string; agent?: string; today: string; draggingId?: string
}) {
    const q = usePagedCases({ stage: col.stage, search, agent, sort: 'follow_up_date', dir: 'asc', limit: PAGE })
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
                        {search ? 'No matches' : 'Drag a case here'}
                    </p>
                ) : q.rows.map(c => (
                    <DraggableCard key={c.id} c={c} today={today} hidden={draggingId === c.id} />
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

function DraggableCard({ c, today, hidden }: { c: CaseListRow; today: string; hidden: boolean }) {
    const router = useRouter()
    const { setNodeRef, attributes, listeners } = useDraggable({ id: c.id, data: { c } })
    return (
        <div ref={setNodeRef} {...attributes} {...listeners}
            onClick={() => router.push(`/insurance/dashboard/cases/${c.id}`)}
            className="select-none"
            style={{ opacity: hidden ? 0.3 : 1, WebkitTouchCallout: 'none' }}>
            <CardBody c={c} today={today} showBanker={c.stage !== 'Touched Base'} />
        </div>
    )
}

function CardBody({ c, today, showBanker, lifted }: { c: CaseListRow; today: string; showBanker: boolean; lifted?: boolean }) {
    const fu = c.follow_up_date?.slice(0, 10)
    const overdue = !fu || fu < today
    const dueToday = fu === today
    const banker = c.referred_bankers?.[0]
    const more = (c.referred_bankers?.length ?? 0) - 1
    return (
        <div className={`bg-white rounded-xl border border-slate-200 flex cursor-grab ${lifted ? 'shadow-xl rotate-1 cursor-grabbing' : 'hover:border-slate-300 hover:shadow-sm'}`}>
            {/* Drag grip — touch-action: none makes a finger here drag at once on iPad.
                A tap on it doesn't open the case. */}
            <span aria-hidden onClick={e => e.stopPropagation()}
                className="w-8 shrink-0 flex items-center justify-center rounded-l-xl bg-slate-50 border-r border-slate-100 text-slate-400 cursor-grab"
                style={{ touchAction: 'none' }}>
                <GripVertical size={16} />
            </span>
            <div className="flex-1 min-w-0 px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-slate-800 truncate">{c.client_name || 'Unnamed'}</p>
                <p className="text-sm font-bold text-[#052d4a] shrink-0">{c.loan_value ? formatCurrency(c.loan_value) : '—'}</p>
            </div>
            {c.client_mobile && (
                <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5"><Phone size={11} /> {c.client_mobile}</p>
            )}
            {showBanker && (
                <p className="text-xs text-slate-500 truncate mt-0.5">
                    {banker ? `${banker.name} (${banker.bank})${more > 0 ? ` +${more}` : ''}` : <span className="text-slate-300">No banker</span>}
                </p>
            )}
            <p className={`text-xs font-semibold flex items-center gap-1 mt-1 ${overdue ? 'text-red-600' : dueToday ? 'text-amber-600' : 'text-slate-500'}`}>
                <CalendarDays size={11} /> {fu ? `FU ${fmtShort(fu)}` : 'No follow-up'}{dueToday ? ' · today' : ''}
            </p>
            </div>
        </div>
    )
}

function MoveModal({ c, to, onClose }: { c: CaseListRow; to: PipelineStage; onClose: () => void }) {
    const [bankers, setBankers] = useState<ReferredBanker[]>(c.referred_bankers ?? [])
    const askBanker = to === 'Pending Docs'
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
