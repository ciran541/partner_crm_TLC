import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance, canAccessProperty, isAdmin } from '@/lib/permissions'
import { getAllSoraFromDb, fetchSoraHistoryForChart } from '@/lib/insurance/sora'
import { fetchFedRateHistory, FedRateEntry } from '@/lib/insurance/fedRate'

// GET /api/insurance/resources/chart-data
// Returns one data point per calendar month (avg SORA + Fed Rate), server-merged.
// If the sora_rates DB is not backfilled, falls back to MAS live fetch (24h cached).

interface SoraRow {
    value_date: string
    sora: number | null
    comp_sora_1m: number | null
    comp_sora_3m: number | null
}

function monthlyAvg(rows: SoraRow[]) {
    const groups = new Map<string, { soras: number[]; c1: number[]; c3: number[] }>()
    for (const r of rows) {
        const ym = r.value_date.substring(0, 7)   // "YYYY-MM"
        if (!groups.has(ym)) groups.set(ym, { soras: [], c1: [], c3: [] })
        const g = groups.get(ym)!
        if (r.sora         != null) g.soras.push(Number(r.sora))
        if (r.comp_sora_1m != null) g.c1.push(Number(r.comp_sora_1m))
        if (r.comp_sora_3m != null) g.c3.push(Number(r.comp_sora_3m))
    }
    return [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([ym, g]) => ({
            ym,
            sora:    avg(g.soras),
            comp_1m: avg(g.c1),
            comp_3m: avg(g.c3),
        }))
}

function avg(arr: number[]): number | null {
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
}

export async function GET() {
    const { user, profile } = await getServerUser()
    if (!user || !profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const allowed =
        canAccessInsurance(profile.role, profile.app_type) ||
        canAccessProperty(profile.role, profile.app_type)
    if (!allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Run SORA DB query and Fed Rate in parallel
    const [dbSora, fedRate] = await Promise.all([
        getAllSoraFromDb(),
        fetchFedRateHistory(),
    ])

    // Fall back to live MAS fetch (24h cached) if DB isn't populated
    const soraRows: SoraRow[] = dbSora.length >= 100
        ? (dbSora as SoraRow[])
        : (await fetchSoraHistoryForChart() as SoraRow[])

    // Fed Rate map: "YYYY-MM" → rate  (FRED dates are always "YYYY-MM-01")
    const fedMap = new Map(
        (fedRate as FedRateEntry[]).map(f => [f.date.substring(0, 7), f.rate])
    )

    // Monthly SORA averages merged with Fed Rate — one row per month (~260 total)
    const chartData = monthlyAvg(soraRows).map(s => ({
        date:    s.ym,
        sora:    s.sora,
        comp_1m: s.comp_1m,
        comp_3m: s.comp_3m,
        fedRate: fedMap.get(s.ym) ?? null,
    }))

    const latestSora = soraRows.length ? soraRows[soraRows.length - 1] : null
    const latestFed  = fedRate.length  ? (fedRate as FedRateEntry[])[fedRate.length - 1] : null

    return NextResponse.json({
        chartData,
        latestSora,
        latestFed,
        isAdmin: isAdmin(profile.role),
    })
}
