import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance, canAccessProperty, isAdmin } from '@/lib/permissions'
import { loadPromotions } from '@/lib/insurance/promotionsCache'
import { todaySgt } from '@/lib/insurance/promotions'
import type { BankPromotion } from '@/lib/types/promotions'

// GET /api/insurance/promotions
// Live + upcoming bank promotions on their own, for surfaces that need them
// without the rest of the rates payload (the dashboard banner). Step 4 and the
// Rates page get the same rows bundled into GET /api/insurance/rates instead of
// making a second call — both read the same cache, so this adds no DB load.
//
// Shared resource: any authenticated insurance OR property user can read.
export async function GET() {
    const { user, profile } = await getServerUser()
    if (!user || !profile) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const allowed =
        canAccessInsurance(profile.role, profile.app_type) ||
        canAccessProperty(profile.role, profile.app_type)
    if (!allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let all: BankPromotion[]
    try {
        all = await loadPromotions()
    } catch (error) {
        console.error('[promotions] load failed:', String(error))
        // A banner is an enhancement — an empty list is a better outcome than a
        // failed dashboard load.
        return NextResponse.json({ data: [] })
    }

    const admin_ = isAdmin(profile.role)
    const today = todaySgt()
    const data = all.filter(p =>
        (admin_ || p.status === 'published') &&
        (!p.ends_on || p.ends_on >= today),
    )

    return NextResponse.json({ data })
}
