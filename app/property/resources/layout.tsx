'use client'

import { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart2 } from 'lucide-react'
import PropertyPremiumGate from '@/components/property/PropertyPremiumGate'

// Premium-tier feature — property-branded subset of
// app/insurance/dashboard/resources/layout.tsx (News + Calendar only, per the
// agreed premium scope — "SORA/FFR Trend" and "Domestic Rates" sub-tabs are
// not part of this pass).
const TABS = [
    { label: 'Mortgage News',      href: '/property/resources/news' },
    { label: 'Economic Calendar',  href: '/property/resources/calendar' },
]

export default function PropertyResourcesLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname()

    return (
        <PropertyPremiumGate>
            <div>
                {/* Header */}
                <div className="mb-5">
                    <div className="flex items-center gap-2.5 mb-1">
                        <BarChart2 size={22} className="text-[#059669]" />
                        <h1 className="text-2xl font-bold text-[#052d4a]">Resources</h1>
                    </div>
                    <p className="text-sm text-slate-500 ml-[30px]">
                        Market data and mortgage-relevant reference tools
                    </p>
                </div>

                {/* Tab nav */}
                <div className="flex gap-1 border-b border-slate-200 mb-6">
                    {TABS.map(t => {
                        const active = pathname === t.href || pathname?.startsWith(t.href + '/')
                        return (
                            <Link
                                key={t.href}
                                href={t.href}
                                className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
                                    active
                                        ? 'border-[#059669] text-[#052d4a]'
                                        : 'border-transparent text-slate-400 hover:text-slate-600'
                                }`}
                            >
                                {t.label}
                            </Link>
                        )
                    })}
                </div>

                {children}
            </div>
        </PropertyPremiumGate>
    )
}
