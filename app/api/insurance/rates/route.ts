import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance, canAccessProperty, isAdmin } from '@/lib/permissions'
import { getCurrentSora } from '@/lib/insurance/sora'
import { loadPackages } from '@/lib/insurance/ratesCache'
import type { MortgagePackage } from '@/lib/types/rates'

// GET /api/insurance/rates
// Shared resource: any authenticated insurance OR property user can read.
// Agents see published packages only; admins also see drafts.
// Optional filters: ?bank= &property_type= &category= &q=
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
    try {
        [data, sora] = await Promise.all([loadPackages(), getCurrentSora()])
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load rates' }, { status: 500 })
    }

    const admin_ = isAdmin(profile.role)
    data = data.filter(p =>
        (admin_ || p.status === 'published') &&
        (!bank || p.bank === bank) &&
        (!propertyType || p.property_type === propertyType) &&
        (!category || p.category === category) &&
        (!q || p.package_name.toLowerCase().includes(q)),
    )

    return NextResponse.json({ data, isAdmin: admin_, sora })
}
