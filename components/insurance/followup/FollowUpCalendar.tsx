'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { CaseListRow } from '@/lib/insurance/usePagedCases'

/**
 * Month grid of follow-up dates — the in-app alternative to syncing follow-ups
 * to Google Calendar, for agents who would rather not connect their Google
 * account (lib/google/syncFollowUpInsurance.ts stays opt-in).
 *
 * Presentational only: the page owns the month, the query and every mutation,
 * so the day-detail panel below the grid reuses the same FollowUpCard — and its
 * Adjust / Mark done / View case actions — that list view already uses, rather
 * than growing a second copy of that logic here.
 */

/** Local-date YYYY-MM-DD. Never toISOString() — that shifts to UTC and would
 *  put an evening follow-up on the previous day for the whole SGT day. */
export function ymd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The month's inclusive bounds, as the query wants them.
 *  `after` is EXCLUSIVE server-side (follow_up_date > after), so it is the last
 *  day of the previous month — not the 1st, which would drop the 1st itself. */
export function monthRange(month: Date): { after: string; to: string } {
    const y = month.getFullYear()
    const m = month.getMonth()
    return { after: ymd(new Date(y, m, 0)), to: ymd(new Date(y, m + 1, 0)) }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_CHIPS = 3

interface Props {
    rows: CaseListRow[]
    month: Date
    today: string
    selectedDate: string | null
    loading: boolean
    onPrevMonth: () => void
    onNextMonth: () => void
    onToday: () => void
    onSelectDate: (date: string | null) => void
}

export default function FollowUpCalendar({
    rows, month, today, selectedDate, loading,
    onPrevMonth, onNextMonth, onToday, onSelectDate,
}: Props) {
    const year = month.getFullYear()
    const monthIndex = month.getMonth()

    // Group by date once, so each cell is a map lookup rather than a filter over
    // every row — a busy month is otherwise 42 passes over the whole list.
    const byDate = new Map<string, CaseListRow[]>()
    for (const r of rows) {
        if (!r.follow_up_date) continue
        const key = r.follow_up_date.slice(0, 10)
        const list = byDate.get(key)
        if (list) list.push(r)
        else byDate.set(key, [r])
    }

    const leadingBlanks = new Date(year, monthIndex, 1).getDay()
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()

    // Pad to whole weeks so the grid keeps a stable 6-row height and the panel
    // below does not jump as you page between months.
    const cells: (number | null)[] = [
        ...Array<null>(leadingBlanks).fill(null),
        ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ]
    while (cells.length % 7 !== 0) cells.push(null)

    const monthLabel = month.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })

    return (
        <div className={`card p-4 ${loading ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between mb-3">
                <button
                    onClick={onPrevMonth}
                    aria-label="Previous month"
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                    <ChevronLeft size={16} />
                </button>
                <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-800">{monthLabel}</h2>
                    <button
                        onClick={onToday}
                        className="text-[11px] font-semibold text-[#03a9e7] hover:underline"
                    >
                        Today
                    </button>
                </div>
                <button
                    onClick={onNextMonth}
                    aria-label="Next month"
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                    <ChevronRight size={16} />
                </button>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-1">
                {WEEKDAYS.map(d => (
                    <div key={d} className="text-center text-[10px] font-bold uppercase tracking-wide text-slate-400 py-1">
                        {d.slice(0, 1)}<span className="hidden sm:inline">{d.slice(1)}</span>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
                {cells.map((day, i) => {
                    if (day === null) return <div key={`blank-${i}`} className="min-h-[68px] rounded-lg bg-slate-50/40" />

                    const date = ymd(new Date(year, monthIndex, day))
                    const items = byDate.get(date) ?? []
                    const isToday = date === today
                    const isSelected = date === selectedDate
                    const isPast = date < today

                    return (
                        <button
                            key={date}
                            onClick={() => onSelectDate(isSelected ? null : date)}
                            className={`min-h-[68px] p-1 rounded-lg border text-left align-top transition-colors ${
                                isSelected
                                    ? 'border-[#03a9e7] bg-sky-50 ring-2 ring-[#03a9e7]/20'
                                    : items.length > 0
                                        ? 'border-slate-200 hover:bg-slate-50'
                                        : 'border-transparent hover:bg-slate-50'
                            }`}
                        >
                            <span className={`inline-flex items-center justify-center w-5 h-5 mb-0.5 text-[11px] font-bold rounded-full ${
                                isToday ? 'bg-[#03a9e7] text-white' : 'text-slate-500'
                            }`}>
                                {day}
                            </span>

                            <span className="block space-y-0.5">
                                {items.slice(0, MAX_CHIPS).map(c => (
                                    <span
                                        key={c.id}
                                        title={c.client_name || 'Unnamed client'}
                                        className={`block truncate text-[10px] leading-tight font-semibold px-1 py-0.5 rounded ${
                                            isPast
                                                ? 'bg-red-50 text-red-600'
                                                : 'bg-sky-100 text-[#0369a1]'
                                        }`}
                                    >
                                        {c.client_name || 'Unnamed'}
                                    </span>
                                ))}
                                {items.length > MAX_CHIPS && (
                                    <span className="block text-[10px] font-semibold text-slate-400 px-1">
                                        +{items.length - MAX_CHIPS} more
                                    </span>
                                )}
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
