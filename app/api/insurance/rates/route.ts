import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance, canAccessProperty, isAdmin } from '@/lib/permissions'
import { getCurrentSora } from '@/lib/insurance/sora'
import { loadPackages } from '@/lib/insurance/ratesCache'
import { loadPromotions } from '@/lib/insurance/promotionsCache'
import { todaySgt } from '@/lib/insurance/promotions'
import type { MortgagePackage } from '@/lib/types/rates'
import type { BankPromotion } from '@/lib/types/promotions'

// GET /api/insurance/rates
// Shared resource: any authenticated insurance OR property user can read.
// Agents see published packages only; admins also see drafts.
// Optional filters: ?bank= &property_type= &category= &q=
//
// Promotions travel with this response (like `sora`) so Step 4, the dashboard
// banner and the rates page all get packages + SORA + promos in one call
// instead of three.
export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url)
    const bank = searchParams.get('bank')
    const propertyType = searchParams.get('property_type')
    const category = searchParams.get('category')
    const q = searchParams.get('q')?.trim().toLowerCase()

    let data: MortgagePackage[]
    let sora
    let allPromotions: BankPromotion[]
    try {
        [data, sora, allPromotions] = await Promise.all([
            loadPackages(),
            getCurrentSora(),
            // Promotions are an enhancement; packages are the product. A failure
            // here must never take Step 4 down with it, so it degrades to "no
            // promotions" rather than propagating.
            loadPromotions().catch(err => {
                console.error('[rates] promotions load failed:', String(err))
                return [] as BankPromotion[]
            }),
        ])
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load rates' }, { status: 500 })
    }

    const admin_ = isAdmin(profile.role)

    // Drop what has already closed — every consumer wants live or upcoming
    // promotions, and matchPromotions() applies the window rules from here.
    // Drafts follow the same rule as packages: admins see them, agents don't.
    const today = todaySgt()
    const promotions = allPromotions.filter(p =>
        (admin_ || p.status === 'published') &&
        (!p.ends_on || p.ends_on >= today),
    )
    data = data.filter(p =>
        (admin_ || p.status === 'published') &&
        (!bank || p.bank === bank) &&
        (!propertyType || p.property_type === propertyType) &&
        (!category || p.category === category) &&
        (!q || p.package_name.toLowerCase().includes(q)),
    )

    return NextResponse.json({ data, isAdmin: admin_, sora, promotions })
}
