'use client'

import { Home, RefreshCw, Users, TrendingUp } from 'lucide-react'
import type { PropertyCaseType } from '@/lib/types/property'

const CASE_TYPES: {
    type: PropertyCaseType
    icon: React.ElementType
    label: string
    description: string
}[] = [
    { type: 'new_purchase', icon: Home, label: 'New Purchase', description: 'Buy a new property' },
    { type: 'refinance', icon: RefreshCw, label: 'Refinance', description: 'Switch to a better rate' },
    { type: 'decoupling', icon: Users, label: 'Decoupling', description: 'Transfer ownership between owners' },
    { type: 'equity', icon: TrendingUp, label: 'Equity', description: 'Release equity from your home' },
]

interface Props {
    value: PropertyCaseType | null
    onChange: (v: PropertyCaseType) => void
    error?: string
}

export default function CaseTypeSelector({ value, onChange, error }: Props) {
    return (
        <div>
            <div className="grid grid-cols-2 gap-3">
                {CASE_TYPES.map(({ type, icon: Icon, label, description }) => {
                    const selected = value === type
                    return (
                        <button
                            key={type}
                            type="button"
                            onClick={() => onChange(type)}
                            className={`p-4 rounded-xl border-2 text-left transition-all ${
                                selected
                                    ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/20'
                                    : 'border-slate-200 bg-white hover:border-slate-300'
                            }`}
                        >
                            <Icon size={20} color={selected ? '#059669' : '#94a3b8'} />
                            <p className={`text-sm font-semibold mt-2 ${selected ? 'text-emerald-800' : 'text-slate-700'}`}>{label}</p>
                            <p className={`text-xs mt-0.5 ${selected ? 'text-emerald-600' : 'text-slate-400'}`}>{description}</p>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
