'use client'

import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import ImpactStars from '@/components/insurance/resources/ImpactStars'
import type { EconomicCalendarEvent, EventKey } from '@/lib/types/calendar'

const EVENT_KEY_COLORS: Record<EventKey, string> = {
    fomc_meeting: 'bg-blue-100 text-blue-700',
    us_cpi: 'bg-amber-100 text-amber-700',
    mas_mps: 'bg-purple-100 text-purple-700',
}

const EVENT_KEY_SHORT: Record<EventKey, string> = {
    fomc_meeting: 'FOMC',
    us_cpi: 'CPI',
    mas_mps: 'MAS',
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10)
}

export default function CalendarGridView({ events }: { events: EconomicCalendarEvent[] }) {
    const [monthStart, setMonthStart] = useState(() => {
        const d = new Date()
        return new Date(d.getFullYear(), d.getMonth(), 1)
    })
    const [selectedDate, setSelectedDate] = useState<string | null>(null)

    const eventsByDate = useMemo(() => {
        const map = new Map<string, EconomicCalendarEvent[]>()
        for (const e of events) {
            const list = map.get(e.event_date) ?? []
            list.push(e)
            map.set(e.event_date, list)
        }
        return map
    }, [events])

    const gridDays = useMemo(() => {
        const startWeekday = monthStart.getDay()
        const gridStart = new Date(monthStart)
        gridStart.setDate(gridStart.getDate() - startWeekday)

        const days: Date[] = []
        for (let i = 0; i < 42; i++) {
            const d = new Date(gridStart)
            d.setDate(gridStart.getDate() + i)
            days.push(d)
        }
        return days
    }, [monthStart])

    const todayIso = toIsoDate(new Date())
    const monthLabel = monthStart.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })
    const selectedEvents = selectedDate ? (eventsByDate.get(selectedDate) ?? []) : []

    const goToMonth = (delta: number) => {
        setMonthStart(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1))
        setSelectedDate(null)
    }
    const goToToday = () => {
        const d = new Date()
        setMonthStart(new Date(d.getFullYear(), d.getMonth(), 1))
        setSelectedDate(null)
    }

    return (
        <div className="space-y-3">
            <div className="card !p-4">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <button onClick={() => goToMonth(-1)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><ChevronLeft size={18} /></button>
                        <p className="font-semibold text-sm text-[#052d4a] w-36 text-center">{monthLabel}</p>
                        <button onClick={() => goToMonth(1)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><ChevronRight size={18} /></button>
                    </div>
                    <button onClick={goToToday} className="text-xs font-semibold text-[#03a9e7] hover:text-[#0284c7]">Today</button>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center mb-1">
                    {WEEKDAYS.map(w => <div key={w} className="text-[11px] font-semibold text-slate-400 uppercase py-1">{w}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-1">
                    {gridDays.map(d => {
                        const iso = toIsoDate(d)
                        const inMonth = d.getMonth() === monthStart.getMonth()
                        const dayEvents = eventsByDate.get(iso) ?? []
                        const isToday = iso === todayIso
                        const isSelected = iso === selectedDate
                        return (
                            <button
                                key={iso}
                                onClick={() => dayEvents.length > 0 && setSelectedDate(isSelected ? null : iso)}
                                className={`min-h-[64px] rounded-lg border p-1.5 text-left transition-colors ${
                                    isSelected ? 'border-[#03a9e7] bg-sky-50' : 'border-slate-100'
                                } ${inMonth ? 'bg-white' : 'bg-slate-50/50'} ${dayEvents.length > 0 ? 'cursor-pointer hover:border-[#03a9e7]' : 'cursor-default'}`}
                            >
                                <p className={`text-xs mb-1 ${inMonth ? 'text-slate-600' : 'text-slate-300'} ${isToday ? 'font-bold text-[#03a9e7]' : ''}`}>
                                    {d.getDate()}
                                </p>
                                <div className="space-y-0.5">
                                    {dayEvents.slice(0, 2).map(e => (
                                        <span key={e.id} className={`block text-[10px] font-semibold px-1 py-0.5 rounded ${EVENT_KEY_COLORS[e.event_key]} truncate`}>
                                            {EVENT_KEY_SHORT[e.event_key]}
                                        </span>
                                    ))}
                                </div>
                            </button>
                        )
                    })}
                </div>
            </div>

            {selectedDate && selectedEvents.length > 0 && (
                <div className="card !p-4 space-y-3">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                        {new Date(selectedDate).toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                    {selectedEvents.map(e => (
                        <div key={e.id} className="flex items-start justify-between gap-3 border-t border-slate-50 pt-3 first:border-0 first:pt-0">
                            <div>
                                <p className="font-medium text-sm text-slate-800">{e.event_name}</p>
                                <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                                    {e.forecast != null && <span>Forecast: {e.forecast.toFixed(2)}%</span>}
                                    {e.previous != null && <span>Previous: {e.previous.toFixed(2)}%</span>}
                                    {e.actual != null && <span>Actual: {e.actual.toFixed(2)}%</span>}
                                </div>
                            </div>
                            <ImpactStars count={e.impact_stars} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
