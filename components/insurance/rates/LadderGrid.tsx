'use client'

import { useState } from 'react'
import { AlertTriangle, Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { buildLadders, issueKey, money, type RateLadder } from '@/lib/insurance/rateLadders'
import { restrictedTo } from '@/lib/insurance/rateFilters'
import { ladderTitle } from '@/lib/insurance/rateUpdate'
import type { MortgagePackage, RateScheduleEntry } from '@/lib/types/rates'

interface Props {
    packages: MortgagePackage[]
    original: MortgagePackage[]
    today: string
    /** Warnings an admin marked as correct (issueKey). */
    checkedOk?: Set<string>
    onCheckOk?: (key: string, ok: boolean) => void
    /** Without these the grid is read-only (the review page). */
    onChange?: (p: MortgagePackage) => void
    onEdit?: (p: MortgagePackage) => void
    onAddStep?: (from: MortgagePackage) => void
    onRemove?: (p: MortgagePackage) => void
    /** Sticky Fixed · Floating · BUC / BTO buttons on top (the bank's Packages tab). */
    jumpBar?: boolean
    /** false = features folded away, with a switch per product (the bank's Packages tab). */
    showFeatures?: boolean
    onShowFeatures?: (show: boolean) => void
}

/** The bank's rates as a sheet: one card per product, loan sizes across, years down. */
export default function LadderGrid(props: Props) {
    const ladders = buildLadders(props.packages, props.today)
    if (!ladders.length) return <p className="py-12 text-center text-sm text-slate-400">No packages for this bank yet.</p>
    const cats = Object.keys(CATEGORY_LABEL).map(c => ({ c, products: ladders.filter(l => l.category === c).length, packages: props.packages.filter(p => p.category === c).length }))
    return (
        <div className="space-y-4">
            {props.jumpBar && (
                <nav aria-label="Go to" className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-[var(--bg-page)] flex flex-wrap gap-2">
                    {cats.map(({ c, products, packages }) => (
                        <button key={c} type="button" disabled={!products} onClick={() => document.getElementById(`grid-${c}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                            className="px-4 py-2 rounded-full border border-slate-200 bg-white text-sm font-semibold text-[#052d4a] hover:border-[#03a9e7] disabled:opacity-40 disabled:cursor-default">
                            {CATEGORY_LABEL[c]} <span className="font-normal text-slate-400">{packages}</span>
                        </button>
                    ))}
                    {props.onShowFeatures && (
                        <button type="button" onClick={() => props.onShowFeatures!(!props.showFeatures)} className="ml-auto px-4 py-2 rounded-full border border-slate-200 bg-white text-sm text-slate-600 hover:border-[#03a9e7]">
                            {props.showFeatures ? 'Hide features' : 'Show features'}
                        </button>
                    )}
                </nav>
            )}
            {ladders.map((l, i) => (
                <div key={l.key} className="space-y-4">
                    {/* A heading where each category starts: Fixed, Floating, BUC / BTO. */}
                    {l.category !== ladders[i - 1]?.category && (
                        <h2 id={props.jumpBar ? `grid-${l.category}` : undefined} className={`scroll-mt-16 text-xl font-bold text-[#052d4a] border-b-2 border-[#03a9e7] pb-1.5 ${i ? 'pt-4' : ''}`}>{CATEGORY_LABEL[l.category] ?? l.category}</h2>
                    )}
                    <LadderCard l={l} {...props} />
                </div>
            ))}
        </div>
    )
}

const CATEGORY_LABEL: Record<string, string> = { Fixed: 'Fixed', 'Floating (Completed)': 'Floating', BUC: 'BUC / BTO' }

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })

function LadderCard({ l, original, today, checkedOk, onCheckOk, onChange, onEdit, onAddStep, onRemove, showFeatures = true }: Props & { l: RateLadder }) {
    const [editing, setEditing] = useState(false)
    const [showChecked, setShowChecked] = useState(false)
    const canEdit = !!onChange
    const old = new Map(original.map(p => [p.id, p]))
    const years = Math.max(...l.steps.map(p => p.rate_schedule.filter(e => !e.thereafter).length))
    const rows = [...Array.from({ length: years }, (_, i) => i + 1), 'TA' as const]
    const checks = l.issues.filter(i => i.level === 'check')
    const open = checks.filter(i => !checkedOk?.has(issueKey(i)))
    const done = checks.filter(i => checkedOk?.has(issueKey(i)))
    const hasFeatures = l.steps.some(p => p.features.length || (old.get(p.id)?.features ?? []).length)
    // A product whose features changed always shows them, so a change is never hidden.
    const featuresChanged = l.steps.some(p => { const was = old.get(p.id)?.features; return !!was && (was.length !== p.features.length || was.some(f => !p.features.includes(f))) })
    const [featuresOpen, setFeaturesOpen] = useState(showFeatures)
    // The page-wide switch overrides each product's own choice when it changes.
    const [lastSwitch, setLastSwitch] = useState(showFeatures)
    if (lastSwitch !== showFeatures) { setLastSwitch(showFeatures); setFeaturesOpen(showFeatures) }
    const featuresShown = featuresOpen || featuresChanged || editing
    const featureCount = new Set(l.steps.flatMap(p => p.features)).size
    const confirmed = l.steps.map(s => s.confirmed_on ?? s.last_updated).sort()[0]
    const age = confirmed ? Math.floor((Date.parse(today) - Date.parse(confirmed)) / 86_400_000) : null

    return (
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b border-slate-100">
                <div>
                    <h3 className="font-bold text-[#052d4a]">{ladderTitle(l)}</h3>
                    <p className="text-xs text-slate-500">
                        {l.category === 'Floating (Completed)' ? 'Floating' : l.category} · {l.steps.length} loan size{l.steps.length === 1 ? '' : 's'}
                        {confirmed && <> · confirmed {day(confirmed)}{age != null && age > 30 && <span className="text-amber-700"> ({age} days ago)</span>}</>}
                    </p>
                </div>
                {canEdit && (
                    <div className="flex gap-2">
                        {editing && onAddStep && <button type="button" onClick={() => onAddStep(l.steps[l.steps.length - 1])} className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 inline-flex items-center gap-1"><Plus size={14} /> Loan size</button>}
                        <button type="button" onClick={() => setEditing(e => !e)} className={`text-sm font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5 ${editing ? 'bg-[#052d4a] text-white' : 'border border-slate-200 text-slate-600'}`}>
                            {editing ? <><Check size={14} /> Done</> : <><Pencil size={14} /> Edit rates</>}
                        </button>
                    </div>
                )}
            </div>

            {open.length > 0 && (
                <ul className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 divide-y divide-amber-100">
                    {open.map(i => (
                        <li key={issueKey(i)} className="flex items-center gap-2 px-3 py-2 text-sm text-amber-900">
                            <AlertTriangle size={14} className="shrink-0" />
                            <span className="flex-1">{i.text}</span>
                            {onCheckOk && <button type="button" onClick={() => onCheckOk(issueKey(i), true)} className="shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-md border border-amber-300 bg-white hover:bg-amber-100">It&apos;s correct</button>}
                        </li>
                    ))}
                </ul>
            )}
            {done.length > 0 && onCheckOk && (
                <div className="mx-4 mt-2 text-xs text-slate-500">
                    <button type="button" onClick={() => setShowChecked(s => !s)} className="py-1 underline">{done.length} warning{done.length === 1 ? '' : 's'} marked as correct</button>
                    {showChecked && done.map(i => (
                        <p key={issueKey(i)} className="flex items-center gap-2 py-1">
                            <span className="flex-1 line-through">{i.text}</span>
                            <button type="button" onClick={() => onCheckOk(issueKey(i), false)} className="text-[#0277a8] font-medium">Show again</button>
                        </p>
                    ))}
                </div>
            )}

            <div className="overflow-x-auto p-2">
                <table className="text-sm border-collapse min-w-full">
                    <thead>
                        <tr>
                            <th className="w-24" />
                            {l.steps.map(p => (
                                <th key={p.id} className="px-3 py-2 text-left align-top min-w-[180px]">
                                    <div className="flex items-center gap-1">
                                        <span className="text-base font-bold text-[#052d4a]">{money(Number(p.min_loan_size))}</span>
                                        {!old.has(p.id) && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">New</span>}
                                        {p.status === 'draft' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Draft</span>}
                                        {editing && <span className="ml-auto flex">
                                            <button type="button" aria-label="Edit everything" onClick={() => onEdit?.(p)} className="p-2 text-slate-400 hover:text-[#03a9e7]"><Pencil size={14} /></button>
                                            <button type="button" aria-label="Remove" onClick={() => onRemove?.(p)} className="p-2 text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                                        </span>}
                                    </div>
                                    <p className="text-[11px] font-normal text-slate-500">
                                        {p.property_type}
                                        {restrictedTo(p) ? <span className="text-violet-700"> · {restrictedTo(p)} only</span> : p.priority_min_loan != null ? <span className="text-violet-700"> · Priority {money(Number(p.priority_min_loan))}</span> : ''}
                                    </p>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r} className="border-t border-slate-100">
                                <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">{r === 'TA' ? 'Thereafter' : `Year ${r}`}</td>
                                {l.steps.map(p => {
                                    const idx = p.rate_schedule.findIndex(e => r === 'TA' ? e.thereafter : !e.thereafter && e.year === r)
                                    const e = p.rate_schedule[idx]
                                    const o = old.get(p.id)?.rate_schedule.find(x => r === 'TA' ? x.thereafter : !x.thereafter && x.year === r)
                                    const changed = !!e && (!o || label(o) !== label(e)) && old.has(p.id)
                                    return (
                                        <td key={p.id} className="px-3 py-1.5">
                                            {!e ? <span className="text-slate-300">–</span>
                                                : editing ? <RateCell key={`${p.id}-${r}-${value(e)}`} entry={e} changed={changed}
                                                    onSave={v => onChange?.({ ...p, rate_schedule: p.rate_schedule.map((x, i) => i === idx ? withValue(x, v) : x) })} />
                                                : <span className={`whitespace-nowrap tabular-nums ${changed ? 'font-bold text-emerald-700' : 'text-slate-700'}`}>{label(e)}</span>}
                                        </td>
                                    )
                                })}
                            </tr>
                        ))}
                        {featuresShown && (hasFeatures || editing) && (
                        <tr className="border-t border-slate-100 align-top">
                            <td className="px-3 py-2 text-xs text-slate-400">Features</td>
                            {l.steps.map(p => {
                                const was = old.get(p.id)?.features
                                const own = p.features
                                const gone = was?.filter(f => !p.features.includes(f)) ?? []
                                return (
                                    <td key={p.id} className="px-3 py-2">
                                        <ul className="space-y-1 text-xs">
                                            {own.map(f => <li key={f} className={`flex gap-1.5 ${was && !was.includes(f) ? 'text-emerald-700 font-bold' : 'text-slate-600'}`}><span className="text-slate-300">•</span>{f}</li>)}
                                            {gone.map(f => <li key={f} className="flex gap-1.5 text-red-600 line-through"><span className="text-slate-300">•</span>{f}</li>)}
                                            {!own.length && !gone.length && <li className="text-slate-300">–</li>}
                                        </ul>
                                        {editing && <button type="button" onClick={() => onEdit?.(p)} className="mt-1.5 text-xs font-medium text-[#0277a8] py-1">Edit features</button>}
                                    </td>
                                )
                            })}
                        </tr>
                        )}
                    </tbody>
                </table>
            </div>
            {!featuresShown && featureCount > 0 && (
                <button type="button" onClick={() => setFeaturesOpen(true)} className="mx-4 mb-3 text-sm font-medium text-[#0277a8] py-1.5">
                    Show features ({featureCount})
                </button>
            )}
            {featuresShown && featuresOpen && !featuresChanged && !editing && !showFeatures && (
                <button type="button" onClick={() => setFeaturesOpen(false)} className="mx-4 mb-1 text-sm font-medium text-[#0277a8] py-1.5">Hide features</button>
            )}
        </section>
    )
}

const value = (e: RateScheduleEntry) => e.type === 'fixed' ? e.rate : e.spreadSign === '-' && e.spread != null ? -e.spread : e.spread
const label = (e: RateScheduleEntry) => {
    const v = value(e)
    if (v == null) return '?'
    return e.type === 'fixed' ? `${v.toFixed(2)}%` : `${e.reference} ${v < 0 ? '−' : '+'} ${Math.abs(v).toFixed(2)}%`
}
function withValue(e: RateScheduleEntry, v: number): RateScheduleEntry {
    if (e.type === 'fixed') return { ...e, rate: v }
    return { ...e, spread: Math.abs(v), spreadSign: v < 0 ? '-' : undefined }
}

function RateCell({ entry, changed, onSave }: { entry: RateScheduleEntry; changed: boolean; onSave: (v: number) => void }) {
    const start = value(entry)
    return (
        <label className="flex items-center gap-1">
            {entry.type === 'floating' && <span className="text-xs text-slate-500 whitespace-nowrap">{entry.reference} +</span>}
            <input type="text" inputMode="decimal" defaultValue={start != null ? start.toFixed(2) : ''}
                aria-label="Rate"
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                onBlur={e => {
                    const v = Number(e.currentTarget.value)
                    if (e.currentTarget.value.trim() === '' || !Number.isFinite(v) || Math.abs(v) > 20) e.currentTarget.value = start != null ? start.toFixed(2) : ''
                    else if (v !== start) onSave(v)
                }}
                className={`w-16 px-2 py-1.5 rounded-md border text-sm tabular-nums outline-none focus:border-[#03a9e7] ${changed ? 'border-[#03a9e7] bg-sky-50 font-semibold' : 'border-slate-200'}`} />
            <span className="text-xs text-slate-400">%</span>
        </label>
    )
}
