'use client'

import { useEffect, useState } from 'react'
import PromoBanner from '@/components/insurance/promotions/PromoBanner'
import { matchPromotions, type MatchedPromotion } from '@/lib/insurance/promotions'
import type { BankPromotion } from '@/lib/types/promotions'

/**
 * Self-loading promotions strip for the dashboard.
 *
 * Uses the slim /api/insurance/promotions endpoint rather than the rates
 * payload — the dashboard has no other reason to download the whole package
 * table. Failure is silent: a promotions outage must not put an error on the
 * first screen an agent sees every morning.
 */
export default function DashboardPromoBanner() {
    const [matched, setMatched] = useState<MatchedPromotion[]>([])

    useEffect(() => {
        let active = true
        ;(async () => {
            try {
                const res = await fetch('/api/insurance/promotions')
                if (!res.ok) return
                const json = await res.json()
                if (!active) return
                const promos = (json.data ?? []) as BankPromotion[]
                // No case in context, so no loan amount — each promotion is
                // labelled with its full range rather than a resolved figure.
                setMatched(matchPromotions(promos, { includeUpcoming: true }))
            } catch { /* silent — this is an enhancement, not the page */ }
        })()
        return () => { active = false }
    }, [])

    return <PromoBanner promotions={matched} />
}
