'use client'

import { Plus, Trash2 } from 'lucide-react'
import { RateScheduleEntry, RATE_REFERENCES } from '@/lib/types/rates'

/**
 * Year-by-year rate schedule builder (Fixed % or Floating reference + spread,
 * plus an optional "Thereafter" out-of-lock-in row). Reused by the workflow
 * package builder and the Closed-Won modal. Mirrors the admin RatePackageEditor.
 */
export default function RateScheduleEditor({ schedule, onChange }: {
    schedule: RateScheduleEntry[]
    onChange: (s: RateScheduleEntry[]) => void
}) {
    const hasThereafter = schedule.some(e => e.thereafter)
    const yearRows = schedule.filter(e => !e.thereafter)

    const update = (i: number, patch: Partial<RateScheduleEntry>) =>
        onChange(schedule.map((e, idx) => idx === i ? { ...e, ...patch } : e))
    const remove = (i: number) => onChange(schedule.filter((_, idx) => idx !== i))

    const addYear = () => {
        const entry: RateScheduleEntry = { year: yearRows.length + 1, type: 'fixed' }
        const tIdx = schedule.findIndex(e => e.thereafter)
        onChange(tIdx === -1 ? [...schedule, entry] : [...schedule.slice(0, tIdx), entry, ...schedule.slice(tIdx)])
    }
    const addThereafter = () => {
        if (hasThereafter) return
        onChange([...schedule, { thereafter: true, type: 'floating', reference: '3M SORA' }])
    }

    return (
        <div>
            <div className="space-y-2">
                {schedule.map((e, i) => (
                    <div key={i}>
                        {e.thereafter && (
                            <div className="flex items-center gap-3 px-1 py-1.5">
                                <div className="flex-1 h-px bg-slate-200" />
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Out of lock-in</span>
                                <div className="flex-1 h-px bg-slate-200" />
                            </div>
                        )}
                        <RateRow
                            entry={e}
                            label={e.thereafter ? 'Thereafter' : `Year ${schedule.slice(0, i).filter(x => !x.thereafter).length + 1}`}
                            onChange={patch => update(i, patch)}
                            onRemove={() => remove(i)}
                            canRemove={schedule.length > 1}
                        />
                    </div>
                ))}
            </div>
            <div className="flex gap-2 mt-2">
                <button type="button" onClick={addYear}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-[#03a9e7] flex items-center gap-1">
                    <Plus size={13} /> Add year
                </button>
                <button type="button" onClick={addThereafter} disabled={hasThereafter}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-[#03a9e7] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1">
                    <Plus size={13} /> Add &ldquo;Thereafter&rdquo;
                </button>
            </div>
        </div>
    )
}

function RateRow({ entry, label, onChange, onRemove, canRemove }: {
    entry: RateScheduleEntry
    label: string
    onChange: (patch: Partial<RateScheduleEntry>) => void
    onRemove: () => void
    canRemove: boolean
}) {
    const rowInput = 'px-2.5 py-2 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7]'
    return (
        <div className="flex items-center gap-2 flex-wrap">
            <span className="w-20 shrink-0 text-xs font-semibold text-slate-500">{label}</span>

            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                {(['fixed', 'floating'] as const).map(t => (
                    <button key={t} type="button" onClick={() => onChange({ type: t })}
                        className={`px-3 py-2 font-medium capitalize transition-colors ${entry.type === t ? 'bg-[#052d4a] text-white' : 'bg-white text-slate-600'}`}>
                        {t}
                    </button>
                ))}
            </div>

            {entry.type === 'fixed' ? (
                <div className="flex items-center gap-1">
                    <input type="number" step="0.01" value={entry.rate ?? ''} onChange={e => onChange({ rate: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                        placeholder="2.00" className={`${rowInput} w-20`} />
                    <span className="text-xs text-slate-400">% Fixed</span>
                </div>
            ) : (
                <div className="flex items-center gap-1 flex-wrap">
                    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs shrink-0">
                        {RATE_REFERENCES.map(r => (
                            <button key={r} type="button" onClick={() => onChange({ reference: r })}
                                className={`px-2.5 py-1.5 font-semibold transition-colors ${(entry.reference ?? '3M SORA') === r ? 'bg-[#052d4a] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                                {r}
                            </button>
                        ))}
                    </div>
                    <span className="text-xs text-slate-400">+</span>
                    <input type="number" step="0.01" value={entry.spread ?? ''} onChange={e => onChange({ spread: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                        placeholder="0.35" className={`${rowInput} w-20`} />
                    <span className="text-xs text-slate-400">%</span>
                </div>
            )}

            {canRemove && (
                <button type="button" onClick={onRemove} className="ml-auto p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button>
            )}
        </div>
    )
}
