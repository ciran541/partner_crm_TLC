import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance, canAccessProperty } from '@/lib/permissions'
import { fetchDomesticRatesFromMas, FIELD_CONFIG } from '@/lib/insurance/domesticRates'

// GET /api/insurance/resources/domestic-rates?start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns daily MAS domestic interest rate rows filtered by date range.
// The underlying MAS fetch is 24h cached; filtering is per-request.

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

    const allRows = await fetchDomesticRatesFromMas()

    // Filter by date range and sort ascending
    const rows = allRows
        .filter(r => {
            const d = String(r.end_of_day ?? '')
            return d >= start && d <= end
        })
        .sort((a, b) => String(b.end_of_day ?? '').localeCompare(String(a.end_of_day ?? '')))

    // Discover which FIELD_CONFIG keys actually exist in the data (from first row)
    const firstRow = allRows[0] ?? {}
    const availableKeys = FIELD_CONFIG.filter(f => f.key in firstRow).map(f => f.key)

    return NextResponse.json({ rows, availableKeys, total: rows.length })
}
