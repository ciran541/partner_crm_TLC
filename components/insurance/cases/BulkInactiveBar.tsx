'use client'

import { useState } from 'react'
import { CalendarClock, UserCheck, X } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import { invalidateCaseData } from '@/lib/insurance/caseCache'
import { addDays } from '@/lib/insurance/followUps'
import { todaySgt } from '@/lib/insurance/promotions'

export const BULK_MAX = 50

/** Cases → Inactive: what to do with the selected clients. Fixed to the bottom so it's always in reach. */
export default function BulkInactiveBar({ ids, onClear, onDone }: {
    ids: string[]
    onClear: () => void
    /** `failed` ids stay selected so the agent can give them another date. */
    onDone: (message: string, ok: boolean, failedIds: string[]) => void
}) {
    const today = todaySgt()
    const [mode, setMode] = useState<'activate' | 'date' | null>(null)
    const [date, setDate] = useState('')
    const [saving, setSaving] = useState(false)
    const [err, setErr] = useState<string | null>(null)
    const n = ids.length
    const clients = `${n} client${n === 1 ? '' : 's'}`

    const save = async () => {
        setSaving(true); setErr(null)
        try {
            const res = await fetch('/api/insurance/cases/bulk-followup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids, follow_up_date: date, activate: mode === 'activate' }),
            })
            const d = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(d.error || 'Could not save')
            invalidateCaseData()
            const failed = (d.failed ?? []) as { id: string; name: string; reason: string }[]
            const done = `${d.updated} client${d.updated === 1 ? '' : 's'} ${mode === 'activate' ? 'moved to Active' : 'updated'}.`
            onDone([done, ...failed.map(f => `${f.name}: ${f.reason}.`)].join(' '), failed.length === 0, failed.map(f => f.id))
            setMode(null); setDate('')
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Could not save')
        } finally {
            setSaving(false)
        }
    }

    const pill = 'h-11 px-4 rounded-full text-sm font-bold flex items-center gap-1.5'
    return (
        <>
            <div className="fixed left-0 right-0 bottom-[calc(80px+env(safe-area-inset-bottom))] md:bottom-6 z-30 flex justify-center px-4 pointer-events-none">
                <div className="pointer-events-auto bg-white rounded-full shadow-2xl border border-slate-200 p-1.5 flex items-center gap-1.5 flex-wrap justify-center">
                    <span className="px-3 text-sm font-bold text-[#052d4a]">{n} selected</span>
                    <button type="button" onClick={() => { setDate(today); setMode('activate') }} className={`${pill} bg-[#03a9e7] text-white`}><UserCheck size={15} /> Make Active</button>
                    <button type="button" onClick={() => { setDate(''); setMode('date') }} className={`${pill} border border-slate-200 text-slate-700`}><CalendarClock size={15} /> Set follow-up</button>
                    <button type="button" aria-label="Clear selection" onClick={onClear} className="w-11 h-11 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100"><X size={18} /></button>
                </div>
            </div>

            {mode && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.55)' }} onClick={() => !saving && setMode(null)}>
                    <div className="card w-full max-w-md p-6 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div>
                            <p className="text-base font-bold text-[#052d4a]">{mode === 'activate' ? `Make ${clients} Active` : `Set follow-up for ${clients}`}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{mode === 'activate' ? 'They join Track with this follow-up date.' : 'They stay Inactive with this follow-up date.'}</p>
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5" htmlFor="bulk-date">Follow-up date *</label>
                            <input id="bulk-date" type="date" value={date} min={today} onChange={e => setDate(e.target.value)}
                                className="w-full max-w-[220px] px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7]" />
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {[['Today', 0], ['Tomorrow', 1], ['1 week', 7], ['2 weeks', 14]].map(([label, days]) => {
                                    const v = addDays(today, days as number)
                                    return (
                                        <button key={label} type="button" onClick={() => setDate(v)}
                                            className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${date === v ? 'bg-[#03a9e7] text-white border-[#03a9e7]' : 'border-slate-200 text-slate-600'}`}>{label}</button>
                                    )
                                })}
                            </div>
                        </div>
                        {err && <p className="text-sm text-red-600">{err}</p>}
                        <div className="flex justify-end gap-2">
                            <button type="button" disabled={saving} onClick={() => setMode(null)} className="px-4 py-2 text-sm font-semibold rounded-full border border-slate-200 text-slate-600">Cancel</button>
                            <button type="button" disabled={saving || !date || date < today} onClick={save} className="px-4 py-2 text-sm font-bold rounded-full bg-[#03a9e7] text-white disabled:opacity-40">
                                {saving ? <Spinner size="sm" color="white" label="Saving…" /> : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
