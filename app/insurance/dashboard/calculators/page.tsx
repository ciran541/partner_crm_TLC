'use client'

import type React from 'react'
import Link from 'next/link'
import { Calculator, TrendingDown, Users, Receipt, Building2, BarChart3, Coins, ArrowLeftRight } from 'lucide-react'

const CALCULATORS: { name: string; description: string; href?: string; icon?: React.ElementType; available: boolean }[] = [
    {
        name: 'Amortization',
        description: 'Year-by-year loan breakdown with variable rates per period',
        href: '/insurance/dashboard/calculators/amortization',
        icon: TrendingDown,
        available: true,
    },
    {
        name: 'Affordability',
        description: 'Loan eligibility under 75% and 55% LTV with pledge fund guidance',
        href: '/insurance/dashboard/calculators/tdsr',
        icon: BarChart3,
        available: true,
    },
    {
        name: 'Technical TDSR',
        description: 'Convert a loan amount to the TDSR it needs, or a TDSR figure back to a loan amount',
        href: '/insurance/dashboard/calculators/technical-tdsr',
        icon: ArrowLeftRight,
        available: true,
    },
    {
        name: 'Reverse Affordability',
        description: 'Find the minimum income needed to qualify for a given loan',
        href: '/insurance/dashboard/calculators/affordability',
        icon: Users,
        available: true,
    },
    {
        name: 'BUC',
        description: 'Progressive payment schedule for Building Under Construction properties',
        href: '/insurance/dashboard/calculators/buc',
        icon: Building2,
        available: true,
    },
    {
        name: 'Partial Repayment',
        description: 'Model lump-sum repayments and see the interest saved and lower instalment',
        href: '/insurance/dashboard/calculators/partial-repayment',
        icon: Coins,
        available: true,
    },
    {
        name: 'Stamp Duty',
        description: 'Calculate BSD and ABSD for any Singapore property purchase',
        href: '/insurance/dashboard/calculators/stamp-duty',
        icon: Receipt,
        available: true,
    },
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

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {CALCULATORS.map(c => {
                    const Icon = c.icon ?? Calculator
                    if (!c.available) {
                        return (
                            <div key={c.name} className="card p-5 flex flex-col items-start gap-3 opacity-60">
                                <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center">
                                    <Calculator size={20} className="text-slate-400" />
                                </div>
                                <div>
                                    <p className="font-semibold text-slate-700">{c.name}</p>
                                    <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                                        Coming soon
                                    </span>
                                </div>
                            </div>
                        )
                    }
                    return (
                        <Link
                            key={c.name}
                            href={c.href!}
                            className="card p-5 flex flex-col items-start gap-3 hover:shadow-md transition-shadow pressable"
                        >
                            <div className="w-11 h-11 rounded-xl bg-sky-50 flex items-center justify-center">
                                <Icon size={20} className="text-[#03a9e7]" />
                            </div>
                            <div>
                                <p className="font-semibold text-slate-700">{c.name}</p>
                                <p className="text-xs text-slate-500 mt-1">{c.description}</p>
                            </div>
                        </Link>
                    )
                })}
            </div>
        </div>
    )
}
