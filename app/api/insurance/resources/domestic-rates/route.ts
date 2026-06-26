import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance, canAccessProperty } from '@/lib/permissions'
import { getDomesticRates, FIELD_CONFIG } from '@/lib/insurance/domesticRates'

// GET /api/insurance/resources/domestic-rates?start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns daily MAS domestic interest rate rows filtered by date range.
// Served from domestic_rates DB table (fast); first call auto-populates from MAS.

export async function GET(req: Request) {
    const { user, profile } = await getServerUser()
    if (!user || !profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const allowed =
        canAccessInsurance(profile.role, profile.app_type) ||
        canAccessProperty(profile.role, profile.app_type)
    if (!allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const start = searchParams.get('start') ?? '2005-01-01'
    const end   = searchParams.get('end')   ?? new Date().toISOString().slice(0, 10)

    const { rows, sampleRow } = await getDomesticRates(start, end)

    // Discover which FIELD_CONFIG keys exist in the data (using sample row for field names)
    const firstRow = sampleRow ?? {}
    const availableKeys = FIELD_CONFIG.filter(f => f.key in firstRow).map(f => f.key)

    return NextResponse.json({ rows, availableKeys, total: rows.length })
}
