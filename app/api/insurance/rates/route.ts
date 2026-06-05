import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance, canAccessProperty, isAdmin } from '@/lib/permissions'
import { getCurrentSora } from '@/lib/insurance/sora'

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
    const q = searchParams.get('q')?.trim()

    const admin = createAdminClient()
    let query = admin
        .from('mortgage_packages')
        .select('*')
        .order('bank', { ascending: true })
        .order('first_year_rate', { ascending: true, nullsFirst: false })

    if (!isAdmin(profile.role)) query = query.eq('status', 'published')
    if (bank) query = query.eq('bank', bank)
    if (propertyType) query = query.eq('property_type', propertyType)
    if (category) query = query.eq('category', category)
    if (q) query = query.ilike('package_name', `%${q}%`)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Current SORA travels with the packages so Step 4 can compute floating rates
    // in one round-trip. Cheap (single latest-row read); harmless for the browse page.
    const sora = await getCurrentSora()

    return NextResponse.json({ data: data ?? [], isAdmin: isAdmin(profile.role), sora })
}
