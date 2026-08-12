'use client'

import type React from 'react'
import Link from 'next/link'
import { Calculator, TrendingDown, Users, Receipt, Building2, BarChart3 } from 'lucide-react'
import PropertyPremiumGate from '@/components/property/PropertyPremiumGate'

// Premium-tier feature — property-branded subset of app/insurance/dashboard/calculators/page.tsx.
// Only the four calculators agreed for the premium tier (Affordability covers
// both the forward and reverse tools, matching the insurance app's own split).
const CALCULATORS: { name: string; description: string; href: string; icon: React.ElementType }[] = [
    {
        name: 'Amortization',
        description: 'Year-by-year loan breakdown with variable rates per period',
        href: '/property/calculators/amortization',
        icon: TrendingDown,
    },
    {
        name: 'Affordability',
        description: 'Loan eligibility under 75% and 55% LTV with pledge fund guidance',
        href: '/property/calculators/tdsr',
        icon: BarChart3,
    },
    {
        name: 'Reverse Affordability',
        description: 'Find the minimum income needed to qualify for a given loan',
        href: '/property/calculators/affordability',
        icon: Users,
    },
    {
        name: 'BUC',
        description: 'Progressive payment schedule for Building Under Construction properties',
        href: '/property/calculators/buc',
        icon: Building2,
    },
    {
        name: 'Stamp Duty',
        description: 'Calculate BSD and ABSD for any Singapore property purchase',
        href: '/property/calculators/stamp-duty',
        icon: Receipt,
    },
]

export default function PropertyCalculatorsPage() {
    return (
        <PropertyPremiumGate>
            <div className="max-w-4xl mx-auto space-y-6">
                <div>
                    <h1 className="ios-page-title flex items-center gap-2">
                        <Calculator size={22} className="text-[#059669]" /> Calculators
                    </h1>
                    <p className="page-subtitle">Quick tools to run the numbers with your client.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {CALCULATORS.map(c => {
                        const Icon = c.icon
                        return (
                            <Link
                                key={c.name}
                                href={c.href}
                                className="card p-5 flex flex-col items-start gap-3 hover:shadow-md transition-shadow pressable"
                            >
                                <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center">
                                    <Icon size={20} className="text-[#059669]" />
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
        </PropertyPremiumGate>
    )
}
