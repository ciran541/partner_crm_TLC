'use client'

import { useState } from 'react'
import { X, Save } from 'lucide-react'
import { EVENT_KEYS, EVENT_KEY_LABELS } from '@/lib/types/calendar'
import type { EconomicCalendarEvent, EconomicCalendarEventInput, EventKey } from '@/lib/types/calendar'
import Spinner from '@/components/shared/Spinner'

interface Props {
    initial: EconomicCalendarEvent | null
    saving: boolean
    onSave: (input: EconomicCalendarEventInput) => Promise<void>
    onClose: () => void
}

export default function CalendarEventEditorModal({ initial, saving, onSave, onClose }: Props) {
    const [eventKey, setEventKey] = useState<EventKey>(initial?.event_key ?? 'mas_mps')
    const [eventName, setEventName] = useState(initial?.event_name ?? EVENT_KEY_LABELS.mas_mps)
    const [eventDate, setEventDate] = useState(initial?.event_date ?? new Date().toISOString().slice(0, 10))
    const [impactStars, setImpactStars] = useState(initial?.impact_stars ?? 5)
    const [adminNotes, setAdminNotes] = useState(initial?.admin_notes ?? '')
    const [hidden, setHidden] = useState(initial?.hidden ?? false)

    const handleSubmit = () => {
        onSave({
            event_key: eventKey,
            event_name: eventName.trim(),
            event_date: eventDate,
            impact_stars: impactStars,
            admin_notes: adminNotes.trim() || null,
            hidden,
        })
    }

    const canSave = eventName.trim() && eventDate && !saving

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.5)', backdropFilter: 'blur(4px)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                    <h3 className="text-lg font-bold text-[#052d4a]">{initial ? 'Edit Event' : 'Add Event'}</h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full text-slate-400"><X size={20} /></button>
                </div>

                <div className="p-6 space-y-4 overflow-y-auto">
                    {!initial && (
                        <p className="text-xs text-slate-400">
                            Mainly for MAS Monetary Policy Statement dates, which have no automated source — MAS
                            releases this quarterly (Jan/Apr/Jul/Oct); check their Advance Release Calendar
                            (mas.gov.sg/monetary-policy/advance-release-calendar) for the next &quot;NLT&quot; date.
                            FOMC and CPI dates come in automatically.
                        </p>
                    )}

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Event Type</label>
                        <select value={eventKey} onChange={e => {
                            const key = e.target.value as EventKey
                            setEventKey(key)
                            if (!initial) setEventName(EVENT_KEY_LABELS[key])
                        }}
                            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] bg-white">
                            {EVENT_KEYS.map(k => <option key={k} value={k}>{EVENT_KEY_LABELS[k]}</option>)}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Event Name</label>
                        <input value={eventName} onChange={e => setEventName(e.target.value)}
                            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12" />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Date</label>
                        <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)}
                            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7]" />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Impact (stars)</label>
                        <select value={impactStars} onChange={e => setImpactStars(Number(e.target.value))}
                            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] bg-white">
                            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} star{n === 1 ? '' : 's'}</option>)}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Admin Notes</label>
                        <textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={2}
                            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 resize-y" />
                    </div>

                    <label className="flex items-center gap-2 text-sm text-slate-600">
                        <input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} />
                        Hidden from agents
                    </label>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 flex gap-3 justify-end shrink-0 bg-slate-50/50">
                    <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
                    <button onClick={handleSubmit} disabled={!canSave} className="btn-primary px-5 py-2 text-sm flex items-center gap-2">
                        {saving ? <Spinner size="sm" color="white" label="Saving…" /> : <><Save size={15} /> Save</>}
                    </button>
                </div>
            </div>
        </div>
    )
}
