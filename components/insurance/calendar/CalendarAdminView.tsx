'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, Plus, Pencil, Trash2, EyeOff, Eye, RefreshCcw, Upload, Search } from 'lucide-react'
import { EVENT_KEYS, EVENT_KEY_LABELS } from '@/lib/types/calendar'
import type { EconomicCalendarEvent, EconomicCalendarEventInput } from '@/lib/types/calendar'
import CalendarEventEditorModal from '@/components/insurance/calendar/CalendarEventEditorModal'
import IcsImportModal from '@/components/insurance/calendar/IcsImportModal'
import ImpactStars from '@/components/insurance/resources/ImpactStars'
import InlineAlert from '@/components/shared/InlineAlert'
import Spinner from '@/components/shared/Spinner'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'

// Admin QA console. FOMC dates + CPI values refresh automatically (daily
// cron + "Refresh now"); CPI release dates come in via the ICS import
// (roughly annual); MAS MPS dates are added manually here, quarterly (Jan/Apr/Jul/Oct).
export default function CalendarAdminView() {
    const [events, setEvents] = useState<EconomicCalendarEvent[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [keyFilter, setKeyFilter] = useState('')
    const [editorOpen, setEditorOpen] = useState(false)
    const [editing, setEditing] = useState<EconomicCalendarEvent | null>(null)
    const [icsModalOpen, setIcsModalOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [refreshing, setRefreshing] = useState(false)
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    const load = async () => {
        setLoading(true)
        const res = await fetch('/api/admin/insurance/calendar')
        const json = await res.json()
        setEvents(json.data ?? [])
        setLoading(false)
    }
    useEffect(() => { load() }, [])

    const filtered = events.filter(e => {
        if (keyFilter && e.event_key !== keyFilter) return false
        if (search) return e.event_name.toLowerCase().includes(search.toLowerCase())
        return true
    })

    const handleRefresh = async () => {
        setRefreshing(true)
        try {
            const res = await fetch('/api/admin/insurance/calendar/refresh', { method: 'POST' })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error ?? 'Refresh failed')
            setAlert({ type: 'success', message: `Refreshed — ${json.fomcUpserted} FOMC date(s) checked, ${json.cpiUpdated} CPI row(s) updated.` })
            await load()
        } catch (e: any) {
            setAlert({ type: 'error', message: e.message })
        } finally {
            setRefreshing(false)
        }
    }

    const handleToggleHidden = async (ev: EconomicCalendarEvent) => {
        const res = await fetch('/api/admin/insurance/calendar', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: ev.id, patch: { hidden: !ev.hidden } }),
        })
        if (res.ok) await load()
        else setAlert({ type: 'error', message: 'Update failed.' })
    }

    const handleDelete = async (ev: EconomicCalendarEvent) => {
        if (!confirm(`Delete "${ev.event_name}" (${ev.event_date})? This cannot be undone.`)) return
        const res = await fetch(`/api/admin/insurance/calendar?id=${ev.id}`, { method: 'DELETE' })
        if (res.ok) { setAlert({ type: 'success', message: 'Event deleted.' }); await load() }
        else setAlert({ type: 'error', message: 'Delete failed.' })
    }

    const handleSave = async (input: EconomicCalendarEventInput) => {
        setSaving(true)
        try {
            const url = '/api/admin/insurance/calendar'
            const body = editing ? { id: editing.id, patch: input } : { input }
            const method = editing ? 'PATCH' : 'POST'
            const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Save failed') }
            setEditorOpen(false); setEditing(null)
            setAlert({ type: 'success', message: editing ? 'Event updated.' : 'Event added.' })
            await load()
        } catch (e: any) {
            setAlert({ type: 'error', message: e.message })
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="max-w-5xl mx-auto space-y-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="ios-page-title flex items-center gap-2">
                        <CalendarClock size={24} className="text-[#03a9e7]" /> Economic Calendar
                    </h1>
                    <p className="page-subtitle">FOMC dates (scraped) and CPI values (FRED) refresh automatically. CPI dates need an occasional ICS import; MAS MPS dates are added here manually.</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setIcsModalOpen(true)} title="Import CPI release dates from BLS's ICS file"
                        className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7] transition-colors flex items-center gap-2">
                        <Upload size={15} /> Import CPI Dates
                    </button>
                    <button onClick={handleRefresh} disabled={refreshing} title="Refresh FOMC dates + CPI values now"
                        className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7] transition-colors flex items-center gap-2 disabled:opacity-50">
                        {refreshing ? <Spinner size="sm" color="#64748b" /> : <RefreshCcw size={15} />}
                        Refresh now
                    </button>
                    <button onClick={() => { setEditing(null); setEditorOpen(true) }} className="btn-primary px-4 py-2 text-sm flex items-center gap-2">
                        <Plus size={16} /> Add Event
                    </button>
                </div>
            </div>

            {alert && <InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} />}

            <div className="flex gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter events…"
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7]" />
                </div>
                <select value={keyFilter} onChange={e => setKeyFilter(e.target.value)}
                    className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7]">
                    <option value="">All types</option>
                    {EVENT_KEYS.map(k => <option key={k} value={k}>{EVENT_KEY_LABELS[k]}</option>)}
                </select>
            </div>

            {loading ? (
                <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} height={44} radius={10} />)}
                </div>
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={CalendarClock}
                    iconColor="#03a9e7"
                    title={search || keyFilter ? 'No events match' : 'No events yet'}
                    description={search || keyFilter ? 'Try a different search term or type filter.' : 'Click "Refresh now" to pull in FOMC dates, or "Add Event" for a MAS MPS date.'}
                />
            ) : (
                <div className="card overflow-hidden">
                    <div className="table-scroll">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-100 text-left text-xs text-slate-400 uppercase tracking-wide">
                                <th className="px-4 py-3 font-semibold">Date</th>
                                <th className="px-4 py-3 font-semibold">Event</th>
                                <th className="px-4 py-3 font-semibold hidden sm:table-cell">Forecast / Actual</th>
                                <th className="px-4 py-3 font-semibold">Impact</th>
                                <th className="px-4 py-3 font-semibold">Status</th>
                                <th className="px-4 py-3 font-semibold text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(ev => (
                                <tr key={ev.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{ev.event_date}</td>
                                    <td className="px-4 py-3">
                                        <p className="font-medium text-slate-800">{ev.event_name}</p>
                                        {ev.admin_notes && <p className="text-xs text-slate-400 line-clamp-1">{ev.admin_notes}</p>}
                                    </td>
                                    <td className="px-4 py-3 hidden sm:table-cell text-xs text-slate-500">
                                        {ev.forecast != null && `F: ${ev.forecast.toFixed(2)}%`}
                                        {ev.actual != null && ` A: ${ev.actual.toFixed(2)}%`}
                                        {ev.forecast == null && ev.actual == null && '—'}
                                    </td>
                                    <td className="px-4 py-3"><ImpactStars count={ev.impact_stars} /></td>
                                    <td className="px-4 py-3">
                                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ev.hidden ? 'bg-slate-100 text-slate-500' : ev.is_manual ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                            {ev.hidden ? 'Hidden' : ev.is_manual ? 'Manual' : 'Automated'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-1 justify-end">
                                            <button onClick={() => { setEditing(ev); setEditorOpen(true) }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Edit"><Pencil size={15} /></button>
                                            <button onClick={() => handleToggleHidden(ev)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title={ev.hidden ? 'Unhide' : 'Hide'}>
                                                {ev.hidden ? <Eye size={15} /> : <EyeOff size={15} />}
                                            </button>
                                            <button onClick={() => handleDelete(ev)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Delete"><Trash2 size={15} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                </div>
            )}

            {editorOpen && (
                <CalendarEventEditorModal initial={editing} saving={saving} onSave={handleSave} onClose={() => { setEditorOpen(false); setEditing(null) }} />
            )}
            {icsModalOpen && (
                <IcsImportModal onClose={() => setIcsModalOpen(false)} onImported={load} />
            )}
        </div>
    )
}
