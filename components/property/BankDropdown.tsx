'use client'

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface Bank { id: string; name: string }

interface Props {
    value: string
    onChange: (bankId: string) => void
    error?: string
}

export default function BankDropdown({ value, onChange, error }: Props) {
    const [banks, setBanks] = useState<Bank[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetch('/api/property/banks')
            .then(r => r.json())
            .then(json => setBanks(json.data ?? []))
            .finally(() => setLoading(false))
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
