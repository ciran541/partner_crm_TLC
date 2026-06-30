'use client'

import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { BANKER_DATA } from '@/lib/property/bankerData'
import type { ReferredBanker } from '@/lib/types'

const BANKS = Object.keys(BANKER_DATA)

// Residential bankers for a bank (insurance mortgages are residential for now).
function bankersFor(bank: string): string[] {
    return BANKER_DATA[bank]?.residential ?? []
}

interface Props {
    value: ReferredBanker[]
    onChange: (v: ReferredBanker[]) => void
    /** Read-only display (no add/remove controls) */
    readOnly?: boolean
}

export default function BankerMultiSelect({ value, onChange, readOnly }: Props) {
    const [bank, setBank] = useState('')

    const add = (name: string) => {
        if (!bank || !name) return
        if (value.some(b => b.bank === bank && b.name === name)) return
        onChange([...value, { bank, name }])
    }
    const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))

    const available = bankersFor(bank).filter(n => !value.some(b => b.bank === bank && b.name === n))

    if (readOnly) {
        if (!value.length) return <span className="text-slate-400">—</span>
        return (
            <div className="flex flex-wrap gap-1.5">
                {value.map((b, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 border border-sky-100 text-xs font-medium">
                        {b.name} <span className="text-sky-400">·</span> {b.bank}
                    </span>
                ))}
            </div>
        )
    }

    return (
        <div className="space-y-2.5">
            {value.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {value.map((b, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700 border border-sky-100 text-xs font-medium">
                            {b.name} <span className="text-sky-400">·</span> {b.bank}
                            <button type="button" onClick={() => remove(i)} className="text-sky-400 hover:text-red-500 transition-colors" aria-label={`Remove ${b.name}`}>
                                <X size={13} />
                            </button>
                        </span>
                    ))}
                </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
                <select
                    value={bank}
                    onChange={e => setBank(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 outline-none focus:border-[#03a9e7]"
                >
                    <option value="">Select bank…</option>
                    {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <select
                    value=""
                    disabled={!bank}
                    onChange={e => { add(e.target.value); }}
                    className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 outline-none focus:border-[#03a9e7] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <option value="">{bank ? (available.length ? 'Add banker…' : 'All added') : 'Pick a bank first'}</option>
                    {available.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="text-[11px] text-slate-400 inline-flex items-center gap-1">
                    <Plus size={11} /> Add one or more
                </span>
            </div>
        </div>
    )
}
