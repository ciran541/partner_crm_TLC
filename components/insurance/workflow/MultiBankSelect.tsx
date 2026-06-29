'use client'

import { useEffect, useState } from 'react'

// Module-level cache so the bank list is fetched once per session and shared
// across every workflow that renders a MultiBankSelect.
let bankCache: { id: string; name: string }[] | null = null

/** Multi-select bank chips — used to capture the banks a client holds
 *  priority / privilege status with (refinancing, equity loan, decoupling). */
export default function MultiBankSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
    const [banks, setBanks] = useState<{ id: string; name: string }[]>(bankCache ?? [])
    useEffect(() => {
        if (bankCache) { setBanks(bankCache); return }
        fetch('/api/insurance/banks')
            .then(r => r.json())
            .then(json => { bankCache = json.data ?? []; setBanks(bankCache!) })
            .catch(() => {})
    }, [])

    const toggle = (name: string) => {
        const set = new Set(value)
        if (set.has(name)) set.delete(name); else set.add(name)
        onChange([...set])
    }

    if (!banks.length) return <p className="text-[12px] text-slate-400">Loading banks…</p>
    return (
        <div className="flex flex-wrap gap-2">
            {banks.map(b => (
                <button key={b.id} type="button" onClick={() => toggle(b.name)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                        value.includes(b.name)
                            ? 'bg-[#052d4a] border-[#052d4a] text-white'
                            : 'bg-white border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7]'
                    }`}>
                    {b.name}
                </button>
            ))}
        </div>
    )
}
