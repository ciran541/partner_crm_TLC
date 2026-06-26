// MAS SORA benchmark fetch + access.
// The MAS "Domestic Interest Rates – Daily" API returns the full history and
// (as of testing) ignores field/date filters, so we fetch all and take the
// latest row with a non-null compounded SORA. A daily cron calls refreshSora();
// the app reads the stored latest via getCurrentSora().

import { createAdminClient } from '@/lib/supabase/admin'

const MAS_URL =
    'https://eservices.mas.gov.sg/apimg-gw/server/monthly_statistical_bulletin_non610mssql/domestic_interest_rates_daily/views/domestic_interest_rates_daily'

export interface SoraRates {
    value_date: string
    sora: number | null
    sora_index: number | null
    comp_sora_1m: number | null
    comp_sora_3m: number | null
    comp_sora_6m: number | null
    published_date: string | null
    fetched_at?: string
    // Bank-set benchmarks from bank_benchmarks table (e.g. { FHR6: 0.8 })
    benchmarks?: Record<string, number>
}

export interface BankBenchmark {
    key: string
    label: string
    value: number
    updated_at: string
}

interface MasRow {
    end_of_day: string
    sora: number | null
    sora_index: number | null
    comp_sora_1m: number | null
    comp_sora_3m: number | null
    comp_sora_6m: number | null
    published_date: string | null
}

/** Fetch the latest non-null compounded SORA row from the MAS API. Returns null on failure. */
export async function fetchLatestSoraFromMas(): Promise<SoraRates | null> {
    const key = process.env.MAS_API_KEY
    if (!key) {
        console.error('[sora] MAS_API_KEY not set')
        return null
    }
    try {
        const res = await fetch(MAS_URL, {
            headers: { keyid: key, accept: 'application/json' },
            // server-side only; this is a large (~8MB) response
            cache: 'no-store',
        })
        if (!res.ok) {
            console.error('[sora] MAS fetch failed:', res.status)
            return null
        }
        const json = await res.json()
        const rows: MasRow[] = json?.elements ?? []
        // Don't assume the feed's row order — the gateway returns the full history
        // and (as seen live) NOT reliably oldest-first. Taking "the last non-null
        // row" therefore grabbed the OLDEST row (a 2006 date). Instead pick the row
        // with the MAX end_of_day that has a usable compounded SORA. end_of_day is
        // ISO "YYYY-MM-DD", so string comparison is chronological.
        let latest: MasRow | null = null
        for (const r of rows) {
            if (r.comp_sora_1m == null && r.comp_sora_3m == null) continue
            if (typeof r.end_of_day !== 'string') continue
            if (!latest || r.end_of_day > latest.end_of_day) latest = r
        }
        if (!latest) return null
        return {
            value_date: latest.end_of_day,
            sora: num(latest.sora),
            sora_index: num(latest.sora_index),
            comp_sora_1m: num(latest.comp_sora_1m),
            comp_sora_3m: num(latest.comp_sora_3m),
            comp_sora_6m: num(latest.comp_sora_6m),
            published_date: latest.published_date ? latest.published_date.slice(0, 10) : null,
        }
    } catch (e) {
        console.error('[sora] MAS fetch threw:', String(e))
        return null
    }
}

/** Fetch from MAS and upsert into sora_rates. Returns the stored row, or null on failure. */
export async function refreshSora(): Promise<SoraRates | null> {
    const latest = await fetchLatestSoraFromMas()
    if (!latest) return null
    const admin = createAdminClient()
    const { error } = await admin.from('sora_rates').upsert(
        { ...latest, fetched_at: new Date().toISOString() },
        { onConflict: 'value_date' }
    )
    if (error) {
        console.error('[sora] upsert failed:', error.message)
        return null
    }
    return latest
}

/**
 * Single-fetch refresh: pulls the MAS endpoint once and updates both sora_rates
 * (SORA fields) and domestic_rates (full row). Use this in the daily cron instead
 * of refreshSora() to avoid a second 8MB round-trip for domestic rates.
 */
export async function refreshAll(): Promise<SoraRates | null> {
    const key = process.env.MAS_API_KEY
    if (!key) { console.error('[sora] MAS_API_KEY not set'); return null }

    let json: { elements?: unknown[] }
    try {
        const res = await fetch(MAS_URL, {
            headers: { keyid: key, accept: 'application/json' },
            cache: 'no-store',
        })
        if (!res.ok) { console.error('[sora] MAS fetch failed:', res.status); return null }
        json = await res.json()
    } catch (e) {
        console.error('[sora] refreshAll fetch threw:', String(e))
        return null
    }

    const rows = (json?.elements ?? []) as unknown as Record<string, unknown>[]

    // Find the latest row that has usable compounded SORA values
    let latest: Record<string, unknown> | null = null
    for (const r of rows) {
        if (r.comp_sora_1m == null && r.comp_sora_3m == null) continue
        if (typeof r.end_of_day !== 'string') continue
        if (!latest || (r.end_of_day as string) > (latest.end_of_day as string)) latest = r
    }
    if (!latest) return null

    const soraRow: SoraRates = {
        value_date:    latest.end_of_day as string,
        sora:          num(latest.sora),
        sora_index:    num(latest.sora_index),
        comp_sora_1m:  num(latest.comp_sora_1m),
        comp_sora_3m:  num(latest.comp_sora_3m),
        comp_sora_6m:  num(latest.comp_sora_6m),
        published_date: latest.published_date
            ? (latest.published_date as string).slice(0, 10)
            : null,
    }

    const admin = createAdminClient()
    const now = new Date().toISOString()
    const { end_of_day, ...domRest } = latest

    const [soraResult] = await Promise.all([
        admin.from('sora_rates').upsert(
            { ...soraRow, fetched_at: now },
            { onConflict: 'value_date' }
        ),
        admin.from('domestic_rates').upsert(
            { value_date: end_of_day as string, data: domRest, fetched_at: now },
            { onConflict: 'value_date' }
        ),
    ])

    if (soraResult.error) {
        console.error('[sora] sora_rates upsert failed:', soraResult.error.message)
        return null
    }
    return soraRow
}

/** Fetch ALL rows from MAS (same endpoint, different mapping). Used for one-time historical backfill. */
export async function fetchAllSoraFromMas(): Promise<SoraRates[]> {
    const key = process.env.MAS_API_KEY
    if (!key) {
        console.error('[sora] MAS_API_KEY not set')
        return []
    }
    try {
        const res = await fetch(MAS_URL, {
            headers: { keyid: key, accept: 'application/json' },
            cache: 'no-store',
        })
        if (!res.ok) {
            console.error('[sora] MAS fetch failed:', res.status)
            return []
        }
        const json = await res.json()
        const rows: MasRow[] = json?.elements ?? []
        return rows
            .filter(r => typeof r.end_of_day === 'string' && r.end_of_day >= '2005-01-01')
            .filter(r => r.sora != null || r.comp_sora_1m != null || r.comp_sora_3m != null)
            .map(r => ({
                value_date: r.end_of_day,
                sora: num(r.sora),
                sora_index: num(r.sora_index),
                comp_sora_1m: num(r.comp_sora_1m),
                comp_sora_3m: num(r.comp_sora_3m),
                comp_sora_6m: num(r.comp_sora_6m),
                published_date: r.published_date ? r.published_date.slice(0, 10) : null,
            }))
    } catch (e) {
        console.error('[sora] fetchAllSoraFromMas threw:', String(e))
        return []
    }
}

/**
 * Fetch ALL SORA history from MAS for chart display — cached 24h server-side.
 * Use this as a fallback when the DB hasn't been backfilled yet.
 * The MAS endpoint returns ~8MB; the Next.js data cache keeps subsequent
 * page loads instant without hitting MAS again.
 */
export async function fetchSoraHistoryForChart(): Promise<Pick<SoraRates, 'value_date' | 'sora' | 'comp_sora_1m' | 'comp_sora_3m'>[]> {
    const key = process.env.MAS_API_KEY
    if (!key) { console.error('[sora] MAS_API_KEY not set'); return [] }
    try {
        const res = await fetch(MAS_URL, {
            headers: { keyid: key, accept: 'application/json' },
            next: { revalidate: 86400 },   // 24h — large payload, safe to cache
        })
        if (!res.ok) { console.error('[sora] MAS chart fetch failed:', res.status); return [] }
        const json = await res.json()
        const rows: MasRow[] = json?.elements ?? []
        return rows
            .filter(r => typeof r.end_of_day === 'string' && r.end_of_day >= '2005-01-01')
            .filter(r => r.sora != null || r.comp_sora_1m != null || r.comp_sora_3m != null)
            .map(r => ({
                value_date: r.end_of_day,
                sora: num(r.sora),
                comp_sora_1m: num(r.comp_sora_1m),
                comp_sora_3m: num(r.comp_sora_3m),
            }))
    } catch (e) { console.error('[sora] fetchSoraHistoryForChart threw:', String(e)); return [] }
}

/** Read all stored SORA rows (chart columns only), oldest first.
 *  PostgREST hard-caps each response at 1000 rows regardless of `.limit()`, so we
 *  page through with `.range()` until a short page signals the end. Without this the
 *  chart only ever saw the first 1000 rows (2005–mid-2009) and "latest" was wrong. */
export async function getAllSoraFromDb(): Promise<Pick<SoraRates, 'value_date' | 'sora' | 'comp_sora_1m' | 'comp_sora_3m'>[]> {
    const admin = createAdminClient()
    const PAGE = 1000
    const all: Pick<SoraRates, 'value_date' | 'sora' | 'comp_sora_1m' | 'comp_sora_3m'>[] = []
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
            .from('sora_rates')
            .select('value_date, sora, comp_sora_1m, comp_sora_3m')
            .gte('value_date', '2005-01-01')
            .order('value_date', { ascending: true })
            .range(from, from + PAGE - 1)
        if (error || !data) break
        all.push(...data)
        if (data.length < PAGE) break
    }
    return all
}

/** Read all stored bank benchmarks (FHR6, FHR8, etc.) as a key→value map. */
export async function getCurrentBenchmarks(): Promise<Record<string, number>> {
    const admin = createAdminClient()
    const { data } = await admin.from('bank_benchmarks').select('key, value')
    if (!data) return {}
    return Object.fromEntries(data.map(r => [r.key as string, Number(r.value)]))
}

/** Read all benchmark rows (for admin display). */
export async function getAllBenchmarks(): Promise<BankBenchmark[]> {
    const admin = createAdminClient()
    const { data } = await admin.from('bank_benchmarks').select('*').order('key')
    return (data ?? []) as BankBenchmark[]
}

/** Upsert a single benchmark value. Returns true on success. */
export async function setBenchmark(key: string, value: number): Promise<boolean> {
    const admin = createAdminClient()
    const { error } = await admin.from('bank_benchmarks')
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    return !error
}

/** Read the most recent stored SORA values (no network). Returns null if none stored yet. */
export async function getCurrentSora(): Promise<SoraRates | null> {
    const admin = createAdminClient()
    const [{ data, error }, benchmarks] = await Promise.all([
        admin.from('sora_rates').select('*').order('value_date', { ascending: false }).limit(1).maybeSingle(),
        getCurrentBenchmarks(),
    ])
    if (error || !data) return null
    return { ...(data as SoraRates), benchmarks }
}

function num(v: unknown): number | null {
    if (v == null) return null
    const n = typeof v === 'number' ? v : parseFloat(String(v))
    return Number.isFinite(n) ? n : null
}
