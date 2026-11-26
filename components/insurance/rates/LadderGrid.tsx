'use client'

import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react'
import { buildLadders, money } from '@/lib/insurance/rateLadders'
import { restrictedTo } from '@/lib/insurance/rateFilters'
import { ladderTitle } from '@/lib/insurance/rateUpdate'
import type { MortgagePackage, RateScheduleEntry } from '@/lib/types/rates'

interface Props {
    packages: MortgagePackage[]
    original: MortgagePackage[]
    today: string
    /** Without these the grid is read-only (the review page). */
    onChange?: (p: MortgagePackage) => void
    onEdit?: (p: MortgagePackage) => void
    onAddStep?: (from: MortgagePackage) => void
    onRemove?: (p: MortgagePackage) => void
}

/** The bank's rates as a sheet: products down, loan sizes across. Click a figure and type. */
export default function LadderGrid({ packages, original, today, onChange, onEdit, onAddStep, onRemove }: Props) {
    const editable = !!onChange
    const ladders = buildLadders(packages, today)
    const old = new Map(original.map(p => [p.id, p]))

    if (!ladders.length) return <p className="py-12 text-center text-sm text-slate-400">No packages for this bank yet.</p>

    return (
        <div className="space-y-4">
            {ladders.map(l => {
                const years = Math.max(...l.steps.map(p => p.rate_schedule.filter(e => !e.thereafter).length))
                const rows = [...Array.from({ length: years }, (_, i) => i + 1), 'TA' as const]
                const checks = l.issues.filter(i => i.level === 'check')
                const flagged = new Set(checks.filter(i => i.packageIds.length < l.steps.length || l.steps.length === 1).flatMap(i => i.packageIds))
                return (
                    <section key={l.key} className="bg-white rounded-2xl border border-slate-200 p-4">
                        <div className="flex items-center justify-between gap-2 mb-2">
                            <h3 className="font-bold text-[#052d4a] text-sm">{ladderTitle(l)} <span className="font-normal text-slate-400">· {l.category}</span></h3>
                            {onAddStep && <button type="button" onClick={() => onAddStep(l.steps[l.steps.length - 1])} className="text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:border-[#03a9e7] inline-flex items-center gap-1">
                                <Plus size={13} /> Add loan size
                            </button>}
                        </div>
                        {checks.map(i => (
                            <p key={i.text + i.packageIds.join()} className="text-xs text-amber-800 bg-amber-50 rounded-lg px-2.5 py-1.5 mb-1.5 flex gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {i.text}</p>
                        ))}
                        <div className="overflow-x-auto">
                            <table className="text-sm border-collapse min-w-full">
                                <thead>
                                    <tr>
                                        <th className="text-left text-[11px] font-semibold text-slate-400 p-2 w-24">Min loan</th>
                                        {l.steps.map(p => (
                                            <th key={p.id} className={`p-2 text-left align-top border-l border-slate-100 min-w-[190px] ${flagged.has(p.id) ? 'bg-amber-50' : ''}`}>
                                                <div className="flex items-center justify-between gap-1">
                                                    <span className="font-bold text-[#052d4a]">{money(Number(p.min_loan_size))}</span>
                                                    {editable && <span className="flex">
                                                        <button type="button" aria-label="Edit everything" onClick={() => onEdit?.(p)} className="p-2 text-slate-400 hover:text-[#03a9e7]"><Pencil size={14} /></button>
                                                        <button type="button" aria-label="Remove" onClick={() => onRemove?.(p)} className="p-2 text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                                                    </span>}
                                                </div>
                                                <p className="text-[11px] font-normal text-slate-500">
                                                    {p.property_type}
                                                    {restrictedTo(p) ? ` · ${restrictedTo(p)} only` : p.priority_min_loan != null ? ` · Priority ${money(Number(p.priority_min_loan))}` : ''}
                                                    {p.status === 'draft' ? ' · Draft' : ''}
                                                    {!old.has(p.id) ? ' · New' : ''}
                                                </p>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(r => (
                                        <tr key={r} className="border-t border-slate-100">
                                            <td className="p-2 text-[11px] font-semibold text-slate-400">{r === 'TA' ? 'Thereafter' : `Year ${r}`}</td>
                                            {l.steps.map(p => {
                                                const idx = p.rate_schedule.findIndex(e => r === 'TA' ? e.thereafter : !e.thereafter && e.year === r)
                                                const e = p.rate_schedule[idx]
                                                const o = old.get(p.id)?.rate_schedule.find(x => r === 'TA' ? x.thereafter : !x.thereafter && x.year === r)
                                                return (
                                                    <td key={p.id} className="p-1.5 border-l border-slate-100">
                                                        {e && !editable ? (
                                                            <span className={`px-2 whitespace-nowrap ${o && value(o) !== value(e) ? 'font-bold text-emerald-700' : 'text-slate-700'}`}>{e.type === 'floating' ? `${e.reference} ` : ''}{value(e)?.toFixed(2)}%</span>
                                                        ) : e ? (
                                                            <RateCell key={`${p.id}-${r}-${value(e)}`} entry={e} changed={!!o && value(o) !== value(e)}
                                                                onSave={v => onChange?.({ ...p, rate_schedule: p.rate_schedule.map((x, i) => i === idx ? withValue(x, v) : x) })} />
                                                        ) : <span className="px-2 text-slate-300">–</span>}
                                                    </td>
                                                )
                                            })}
                                        </tr>
                                    ))}
                                    <tr className="border-t border-slate-100 align-top">
                                        <td className="p-2 text-[11px] font-semibold text-slate-400">Features</td>
                                        {l.steps.map(p => {
                                            const was = old.get(p.id)?.features
                                            return (
                                                <td key={p.id} className="p-2 border-l border-slate-100">
                                                    <ul className="space-y-1 text-xs">
                                                        {p.features.map(f => <li key={f} className={`flex gap-1.5 ${was && !was.includes(f) ? 'text-emerald-700 font-bold' : 'text-slate-600'}`}><span className="text-slate-300">•</span>{f}</li>)}
                                                        {was?.filter(f => !p.features.includes(f)).map(f => <li key={f} className="flex gap-1.5 text-red-600 line-through"><span className="text-slate-300">•</span>{f}</li>)}
                                                        {!p.features.length && !was?.length && <li className="text-slate-300">None</li>}
                                                    </ul>
                                                </td>
                                            )
                                        })}
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        {l.issues.filter(i => i.level === 'info' && !i.packageIds.length).map(i => <p key={i.text} className="text-[11px] text-slate-400 mt-1">{i.text}</p>)}
                    </section>
                )
            })}
        </div>
    )
}

const value = (e: RateScheduleEntry) => e.type === 'fixed' ? e.rate : e.spreadSign === '-' && e.spread != null ? -e.spread : e.spread
function withValue(e: RateScheduleEntry, v: number): RateScheduleEntry {
    if (e.type === 'fixed') return { ...e, rate: v }
    return { ...e, spread: Math.abs(v), spreadSign: v < 0 ? '-' : undefined }
}

function RateCell({ entry, changed, onSave }: { entry: RateScheduleEntry; changed: boolean; onSave: (v: number) => void }) {
    const start = value(entry)
    return (
        <label className="flex items-center gap-1">
            {entry.type === 'floating' && <span className="text-[11px] text-slate-500 whitespace-nowrap">{entry.reference}</span>}
            <input type="text" inputMode="decimal" defaultValue={start != null ? start.toFixed(2) : ''}
                aria-label="Rate"
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                onBlur={e => {
                    const v = Number(e.currentTarget.value)
                    if (e.currentTarget.value.trim() === '' || !Number.isFinite(v) || Math.abs(v) > 20) e.currentTarget.value = start != null ? start.toFixed(2) : ''
                    else if (v !== start) onSave(v)
                }}
                className={`w-16 px-2 py-1.5 rounded-md border text-sm tabular-nums outline-none focus:border-[#03a9e7] ${changed ? 'border-[#03a9e7] bg-sky-50 font-semibold' : 'border-slate-200'}`} />
            <span className="text-[11px] text-slate-400">%</span>
        </label>
    )
}
