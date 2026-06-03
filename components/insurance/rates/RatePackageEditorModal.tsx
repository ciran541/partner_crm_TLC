'use client'

import { useState } from 'react'
import { X, Save, Plus, Trash2 } from 'lucide-react'
import {
    MortgagePackage, MortgagePackageInput, RateScheduleEntry,
    PROPERTY_TYPES, RATE_CATEGORIES, LOCKIN_OPTIONS, RATE_REFERENCES, RateCategory,
} from '@/lib/types/rates'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import Spinner from '@/components/shared/Spinner'

interface Props {
    initial?: MortgagePackage | null
    onSave: (input: MortgagePackageInput) => Promise<void>
    onClose: () => void
    saving: boolean
}

const inputCls = 'w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12'
const labelCls = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5'

export default function RatePackageEditorModal({ initial, onSave, onClose, saving }: Props) {
    const [bank, setBank] = useState(initial?.bank ?? '')
    const [propertyType, setPropertyType] = useState(initial?.property_type ?? 'HDB / Private')
    const [category, setCategory] = useState<RateCategory>(initial?.category ?? 'Fixed')
    const [minLoan, setMinLoan] = useState(String(initial?.min_loan_size ?? ''))
    const [packageName, setPackageName] = useState(initial?.package_name ?? '')
    const [lockin, setLockin] = useState(initial?.lockin_years ?? 0)
    const [schedule, setSchedule] = useState<RateScheduleEntry[]>(
        initial?.rate_schedule?.length ? initial.rate_schedule : [{ year: 1, type: 'fixed' }]
    )
    const [features, setFeatures] = useState<string[]>(initial?.features?.length ? initial.features : [''])
    const [subsidies, setSubsidies] = useState(initial?.subsidies ?? '')
    const [remarks, setRemarks] = useState(initial?.remarks ?? '')
    const [status, setStatus] = useState<'published' | 'draft'>(initial?.status ?? 'published')

    const hasThereafter = schedule.some(e => e.thereafter)
    const nextYear = schedule.filter(e => !e.thereafter).length + 1

    const updateEntry = (i: number, patch: Partial<RateScheduleEntry>) =>
        setSchedule(s => s.map((e, idx) => idx === i ? { ...e, ...patch } : e))
    const removeEntry = (i: number) => setSchedule(s => s.filter((_, idx) => idx !== i))

    const addYear = () => {
        // insert before the thereafter row if present
        const yearEntry: RateScheduleEntry = { year: nextYear, type: 'fixed' }
        setSchedule(s => {
            const tIdx = s.findIndex(e => e.thereafter)
            if (tIdx === -1) return [...s, yearEntry]
            return [...s.slice(0, tIdx), yearEntry, ...s.slice(tIdx)]
        })
    }
    const addThereafter = () => {
        if (hasThereafter) return
        setSchedule(s => [...s, { thereafter: true, type: 'floating', reference: '3M SORA' }])
    }

    const handleSubmit = () => {
        onSave({
            bank: bank.trim(),
            property_type: propertyType,
            category,
            min_loan_size: Number(minLoan) || 0,
            package_name: packageName.trim(),
            lockin_years: lockin,
            rate_schedule: schedule,
            features: features.map(f => f.trim()).filter(Boolean),
            subsidies: subsidies.trim() || null,
            remarks: remarks.trim() || null,
            status,
        })
    }

    const canSave = bank.trim() && packageName.trim() && schedule.length > 0 && !saving

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.5)', backdropFilter: 'blur(4px)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                    <h3 className="text-lg font-bold text-[#052d4a]">{initial ? 'Edit Package' : 'New Package'}</h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full text-slate-400"><X size={20} /></button>
                </div>

                <div className="p-6 space-y-4 overflow-y-auto">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className={labelCls}>Bank *</label>
                            <InsuranceBankDropdown value={bank} onChange={setBank} />
                        </div>
                        <div>
                            <label className={labelCls}>Property type</label>
                            <select value={propertyType} onChange={e => setPropertyType(e.target.value)} className={`${inputCls} bg-white`}>
                                {PROPERTY_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className={labelCls}>Package name *</label>
                        <input value={packageName} onChange={e => setPackageName(e.target.value)}
                            placeholder="e.g. OCBC 2Y Fixed Rates – 2 Years Lock-In" className={inputCls} />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <label className={labelCls}>Category</label>
                            <select value={category} onChange={e => setCategory(e.target.value as RateCategory)} className={`${inputCls} bg-white`}>
                                {RATE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>Lock-in</label>
                            <select value={lockin} onChange={e => setLockin(Number(e.target.value))} className={`${inputCls} bg-white`}>
                                {LOCKIN_OPTIONS.map(y => <option key={y} value={y}>{y === 0 ? 'No Lock-in' : `${y} Year${y > 1 ? 's' : ''}`}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>Min. loan (SGD)</label>
                            <input value={minLoan} onChange={e => setMinLoan(e.target.value.replace(/[^\d]/g, ''))}
                                inputMode="numeric" placeholder="300000" className={inputCls} />
                        </div>
                    </div>

                    {/* Rate schedule builder */}
                    <div>
                        <label className={labelCls}>Rate schedule</label>
                        <div className="space-y-2">
                            {schedule.map((e, i) => (
                                <RateRow key={i} entry={e}
                                    label={e.thereafter ? 'Thereafter' : `Year ${e.year ?? i + 1}`}
                                    onChange={patch => updateEntry(i, patch)}
                                    onRemove={() => removeEntry(i)}
                                    canRemove={schedule.length > 1} />
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

                    {/* Features */}
                    <div>
                        <label className={labelCls}>Features</label>
                        <div className="space-y-2">
                            {features.map((f, i) => (
                                <div key={i} className="flex gap-2">
                                    <input value={f} onChange={e => setFeatures(arr => arr.map((x, idx) => idx === i ? e.target.value : x))}
                                        placeholder="e.g. One free conversion after 12 months" className={inputCls} />
                                    <button type="button" onClick={() => setFeatures(arr => arr.filter((_, idx) => idx !== i))}
                                        className="shrink-0 p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={15} /></button>
                                </div>
                            ))}
                        </div>
                        <button type="button" onClick={() => setFeatures(arr => [...arr, ''])}
                            className="text-xs font-medium px-3 py-1.5 mt-2 rounded-lg border border-slate-200 text-slate-600 hover:border-[#03a9e7] flex items-center gap-1">
                            <Plus size={13} /> Add feature
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className={labelCls}>Subsidies</label>
                            <input value={subsidies} onChange={e => setSubsidies(e.target.value)} placeholder="optional" className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>Remarks (internal)</label>
                            <input value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="optional" className={inputCls} />
                        </div>
                    </div>

                    <div>
                        <label className={labelCls}>Status</label>
                        <select value={status} onChange={e => setStatus(e.target.value as 'published' | 'draft')} className={`${inputCls} bg-white`}>
                            <option value="published">Published (visible to agents)</option>
                            <option value="draft">Draft (admin only)</option>
                        </select>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 flex gap-3 justify-end shrink-0 bg-slate-50/50">
                    <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
                    <button onClick={handleSubmit} disabled={!canSave} className="btn-primary px-5 py-2 text-sm flex items-center gap-2">
                        {saving ? <Spinner size="sm" color="white" label="Saving…" /> : <><Save size={15} /> Save Package</>}
                    </button>
                </div>
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
                <div className="flex items-center gap-1">
                    <input list="rate-refs" value={entry.reference ?? ''} onChange={e => onChange({ reference: e.target.value })}
                        placeholder="3M SORA" className={`${rowInput} w-32`} />
                    <span className="text-xs text-slate-400">+</span>
                    <input type="number" step="0.01" value={entry.spread ?? ''} onChange={e => onChange({ spread: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                        placeholder="0.35" className={`${rowInput} w-20`} />
                    <span className="text-xs text-slate-400">%</span>
                    <datalist id="rate-refs">{RATE_REFERENCES.map(r => <option key={r} value={r} />)}</datalist>
                </div>
            )}

            {canRemove && (
                <button type="button" onClick={onRemove} className="ml-auto p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button>
            )}
        </div>
    )
}
