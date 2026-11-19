'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, List, Grid3x3, ExternalLink } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import EmptyState from '@/components/shared/EmptyState'
import ImpactStars from '@/components/insurance/resources/ImpactStars'
import CountdownBadge from '@/components/insurance/resources/CountdownBadge'
import CalendarGridView from '@/components/insurance/resources/CalendarGridView'
import type { EconomicCalendarEvent, EventKey } from '@/lib/types/calendar'

type ViewMode = 'list' | 'calendar'

function pct(v: number | null): string {
    return v != null ? `${v.toFixed(2)}%` : '—'
}

export default function CalendarPage() {
    const [events, setEvents] = useState<EconomicCalendarEvent[]>([])
    const [nearest, setNearest] = useState<Partial<Record<EventKey, EconomicCalendarEvent>>>({})
    const [loading, setLoading] = useState(true)
    const [fetchErr, setFetchErr] = useState<string | null>(null)
    const [viewMode, setViewMode] = useState<ViewMode>('list')

    useEffect(() => {
        setLoading(true)
        fetch('/api/insurance/resources/calendar')
            .then(r => r.ok ? r.json() : Promise.reject('Failed'))
            .then(d => { setEvents(d.data ?? []); setNearest(d.nearest ?? {}) })
            .catch(() => setFetchErr('Could not load the economic calendar. Please refresh.'))
            .finally(() => setLoading(false))
    }, [])

    if (loading) return <div className="flex justify-center py-24"><Spinner /></div>
    if (fetchErr) return <div className="card text-center py-12 text-sm text-red-500">{fetchErr}</div>

    const today = new Date().toISOString().slice(0, 10)
    const upcoming = events.filter(e => e.event_date >= today)
    // Past events are only worth listing once they carry an outcome — a figure or
    // a link to the published statement. A past date on its own tells an agent
    // nothing they can use with a client.
    const results = events
        .filter(e => e.event_date < today && (e.actual != null || e.source_url))
        .sort((a, b) => b.event_date.localeCompare(a.event_date))

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <CountdownBadge label="Next FOMC Meeting" date={nearest.fomc_meeting?.event_date} />
                <CountdownBadge label="Next US CPI Release" date={nearest.us_cpi?.event_date} />
                <CountdownBadge label="Next MAS Policy Statement" date={nearest.mas_mps?.event_date} />
            </div>

            <div className="flex justify-end">
                <div className="inline-flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
                    <button
                        onClick={() => setViewMode('list')}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
                            viewMode === 'list' ? 'bg-white text-[#052d4a] shadow-sm' : 'text-slate-400 hover:text-slate-600'
                        }`}
                    >
                        <List size={13} /> List
                    </button>
                    <button
                        onClick={() => setViewMode('calendar')}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
                            viewMode === 'calendar' ? 'bg-white text-[#052d4a] shadow-sm' : 'text-slate-400 hover:text-slate-600'
                        }`}
                    >
                        <Grid3x3 size={13} /> Calendar
                    </button>
                </div>
            </div>

            {viewMode === 'calendar' ? (
                <CalendarGridView events={events} />
            ) : upcoming.length === 0 ? (
                <EmptyState
                    icon={CalendarClock}
                    iconColor="#03a9e7"
                    title="No upcoming events"
                    description="FOMC meetings, US CPI releases, and MAS policy statements will appear here as they're scheduled."
                />
            ) : (
                <div className="card overflow-hidden">
                    <div className="table-scroll">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-100 text-left text-xs text-slate-400 uppercase tracking-wide">
                                <th className="px-4 py-3 font-semibold">Date</th>
                                <th className="px-4 py-3 font-semibold">Event</th>
                                <th className="px-4 py-3 font-semibold hidden sm:table-cell">Expected</th>
                                <th className="px-4 py-3 font-semibold hidden sm:table-cell">Previous</th>
                                <th className="px-4 py-3 font-semibold">Impact</th>
                            </tr>
                        </thead>
                        <tbody>
                            {upcoming.map(e => (
                                <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                                        {new Date(e.event_date).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                                    </td>
                                    <td className="px-4 py-3 font-medium text-slate-800">{e.event_name}</td>
                                    <td className="px-4 py-3 hidden sm:table-cell text-slate-600">{pct(e.forecast)}</td>
                                    <td className="px-4 py-3 hidden sm:table-cell text-slate-600">{pct(e.previous)}</td>
                                    <td className="px-4 py-3"><ImpactStars count={e.impact_stars} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                </div>
            )}

            {viewMode === 'list' && results.length > 0 && (
                <div className="card overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100">
                        <p className="text-[11px] font-bold text-[#052d4a] uppercase tracking-wider">Recent results</p>
                    </div>
                    <div className="table-scroll">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-100 text-left text-xs text-slate-400 uppercase tracking-wide">
                                <th className="px-4 py-3 font-semibold">Date</th>
                                <th className="px-4 py-3 font-semibold">Event</th>
                                <th className="px-4 py-3 font-semibold">Actual</th>
                                <th className="px-4 py-3 font-semibold hidden sm:table-cell">Previous</th>
                                <th className="px-4 py-3 font-semibold">Report</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.map(e => (
                                <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                                        {new Date(e.event_date).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                                    </td>
                                    <td className="px-4 py-3 font-medium text-slate-800">{e.event_name}</td>
                                    <td className="px-4 py-3 font-semibold text-[#052d4a] tabular-nums">{pct(e.actual)}</td>
                                    <td className="px-4 py-3 hidden sm:table-cell text-slate-600 tabular-nums">{pct(e.previous)}</td>
                                    <td className="px-4 py-3">
                                        {e.source_url ? (
                                            <a href={e.source_url} target="_blank" rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-[#03a9e7] font-medium hover:underline">
                                                Read <ExternalLink size={12} />
                                            </a>
                                        ) : <span className="text-slate-300">—</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                </div>
            )}

            <p className="text-xs text-slate-400 mt-4 text-center">
                FOMC: Federal Reserve · US CPI: Bureau of Labor Statistics / FRED (forecast shown is 1-year inflation expectation, not literal analyst consensus) · MAS: Monetary Authority of Singapore
            </p>
        </div>
    )
}
