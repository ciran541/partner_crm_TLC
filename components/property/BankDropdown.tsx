'use client'

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface Bank { id: string; name: string }

interface Props {
    value: string
    onChange: (bankId: string) => void
    error?: string
}

// Banks are near-static — cache the list at module scope so reopening the
// New/Edit case form doesn't refetch (and shows the dropdown instantly).
let banksCache: Bank[] | null = null
let banksInflight: Promise<Bank[]> | null = null

function loadBanks(): Promise<Bank[]> {
    if (banksCache) return Promise.resolve(banksCache)
    if (banksInflight) return banksInflight
    banksInflight = fetch('/api/property/banks')
        .then(r => r.json())
        .then(json => {
            banksCache = json.data ?? []
            return banksCache!
        })
        .finally(() => { banksInflight = null })
    return banksInflight
}

export default function BankDropdown({ value, onChange, error }: Props) {
    const [banks, setBanks] = useState<Bank[]>(banksCache ?? [])
    const [loading, setLoading] = useState(!banksCache)

    useEffect(() => {
        if (banksCache) return
        let active = true
        loadBanks()
            .then(data => { if (active) setBanks(data) })
            .finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [])

    return (
        <div>
            <div className="relative">
                <select
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    disabled={loading}
                    className={`w-full appearance-none pl-3 pr-8 py-2.5 text-sm rounded-lg border transition-colors outline-none
                        ${error
                            ? 'border-red-400 bg-red-50 focus:border-red-500 focus:ring-2 focus:ring-red-200'
                            : 'border-slate-200 bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'
                        }
                        ${loading ? 'text-slate-400' : 'text-slate-700'}`}
                >
                    <option value="">{loading ? 'Loading banks…' : 'Select a bank (optional)'}</option>
                    {banks.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                </select>
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
    )
}
