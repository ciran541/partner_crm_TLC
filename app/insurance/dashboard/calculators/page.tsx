'use client'

import { Calculator } from 'lucide-react'

const CALCULATORS = [
    { name: 'Calculator 1', description: 'Coming soon' },
    { name: 'Calculator 2', description: 'Coming soon' },
    { name: 'Calculator 3', description: 'Coming soon' },
]

export default function CalculatorsPage() {
    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div>
                <h1 className="ios-page-title flex items-center gap-2">
                    <Calculator size={22} className="text-[#03a9e7]" /> Calculators
                </h1>
                <p className="page-subtitle">Quick tools to run the numbers with your client.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {CALCULATORS.map(c => (
                    <div key={c.name} className="card p-5 flex flex-col items-start gap-3 opacity-70">
                        <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center">
                            <Calculator size={20} className="text-slate-400" />
                        </div>
                        <div>
                            <p className="font-semibold text-slate-700">{c.name}</p>
                            <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                                {c.description}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
