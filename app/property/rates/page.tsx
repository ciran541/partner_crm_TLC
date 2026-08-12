'use client'

import RatesView from '@/components/insurance/rates/RatesView'
import PropertyPremiumGate from '@/components/property/PropertyPremiumGate'

// Premium-tier feature — mirrors app/insurance/dashboard/rates/page.tsx.
// RatesView is app-agnostic (its own API call already permits property
// agents) so it's reused directly rather than rebuilt.
export default function PropertyRatesPage() {
    return (
        <PropertyPremiumGate>
            <RatesView forceReadOnly />
        </PropertyPremiumGate>
    )
}
