'use client'

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface Bank { id: string; name: string }

let cache: Bank[] | null = null
let inflight: Promise<Bank[]> | null = null

function loadBanks(): Promise<Bank[]> {
    if (cache) return Promise.resolve(cache)
    if (inflight) return inflight
    inflight = fetch('/api/insurance/banks')
        .then(r => r.json())
        .then(json => { cache = json.data ?? []; return cache! })
        .finally(() => { inflight = null })
    return inflight
}

interface Props {
    value: string
    onChange: (value: string) => void
    placeholder?: string
}

export default function InsuranceBankDropdown({ value, onChange, placeholder = 'Select a bank…' }: Props) {
    const [banks, setBanks] = useState<Bank[]>(cache ?? [])
    const [loading, setLoading] = useState(!cache)

    useEffect(() => {
        if (cache) return
        let active = true
        loadBanks()
            .then(data => { if (active) setBanks(data) })
            .finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [])

    return (
        <div className="relative">
            <select
                value={value}
                onChange={e => onChange(e.target.value)}
                disabled={loading}
                className={`w-full appearance-none pl-3 pr-8 py-2.5 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 transition-all ${loading ? 'text-slate-400' : 'text-slate-700'}`}
            >
                <option value="">{loading ? 'Loading banks…' : placeholder}</option>
                {banks.map(b => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                ))}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
    )
}
