'use client'

import { useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { usePropertyProfile } from '@/lib/property/propertyProfileContext'
import Spinner from '@/components/shared/Spinner'

// Wraps every premium-tier property page. Redirects non-premium agents back
// to the dashboard instead of rendering — mirrors the canAccessInsurance
// client-side guard pattern already used by app/insurance/dashboard/layout.tsx.
export default function PropertyPremiumGate({ children }: { children: ReactNode }) {
    const router = useRouter()
    const { loading, isPremium } = usePropertyProfile()

    useEffect(() => {
        if (!loading && !isPremium) router.replace('/property/dashboard')
    }, [loading, isPremium, router])

    if (loading || !isPremium) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
                <Spinner size="md" color="#059669" label="Loading…" />
            </div>
        )
    }

    return <>{children}</>
}
