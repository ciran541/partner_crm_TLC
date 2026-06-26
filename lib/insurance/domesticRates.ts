// MAS Domestic Interest Rates — full field fetch for the Domestic Rates data table.
// Same endpoint as SORA; we just pass through all fields instead of mapping only SORA ones.
// DB cache: domestic_rates table stores one row per date; populated by cron + lazy on first use.

import { createAdminClient } from '@/lib/supabase/admin'

const MAS_URL =
    'https://eservices.mas.gov.sg/apimg-gw/server/monthly_statistical_bulletin_non610mssql/domestic_interest_rates_daily/views/domestic_interest_rates_daily'

export type DomesticRateRow = Record<string, number | string | null>

export interface FieldConfig {
    key: string
    label: string
    unit: 'pct' | 'index' | 'bil' | 'text'
}

// Display config for known MAS fields — key is the API field name as returned by MAS.
// Only fields present in the actual API response will appear; mismatched names are silently skipped.
export const FIELD_CONFIG: FieldConfig[] = [
    { key: 'interbank_overnight',            label: 'Interbank Overnight',                          unit: 'pct' },
    { key: 'interbank_1w',                   label: 'Interbank 1-week',                             unit: 'pct' },
    { key: 'interbank_1m',                   label: 'Interbank 1-month',                            unit: 'pct' },
    { key: 'interbank_2m',                   label: 'Interbank 2-month',                            unit: 'pct' },
    { key: 'interbank_3m',                   label: 'Interbank 3-month',                            unit: 'pct' },
    { key: 'interbank_6m',                   label: 'Interbank 6-month',                            unit: 'pct' },
    { key: 'interbank_12m',                  label: 'Interbank 12-month',                           unit: 'pct' },
    { key: 'commercial_bills_3m',            label: '3-month Commercial Bills',                     unit: 'pct' },
    { key: 'usd_sibor_3m',                   label: '3-month US$ SIBOR',                            unit: 'pct' },
    { key: 'sgs_repo_overnight_rate',        label: 'SGS Repo Overnight Rate',                      unit: 'pct' },
    { key: 'standing_facility_deposit_rate', label: 'Standing Facility Deposit Rate',               unit: 'pct' },
    { key: 'standing_facility_borrowing_rate', label: 'Standing Facility Borrowing Rate',           unit: 'pct' },
    { key: 'rmb_overnight_rate',             label: 'RMB Overnight Rate',                           unit: 'pct' },
    { key: 'sora',                           label: 'SORA',                                         unit: 'pct' },
    { key: 'sora_index',                     label: 'SORA Index',                                   unit: 'index' },
    { key: 'comp_sora_1m',                   label: '1-month Compounded SORA',                      unit: 'pct' },
    { key: 'comp_sora_3m',                   label: '3-month Compounded SORA',                      unit: 'pct' },
    { key: 'comp_sora_6m',                   label: '6-month Compounded SORA',                      unit: 'pct' },
    { key: 'aggregate_volume',               label: 'Aggregate Volume of SORA Transactions (S$B)',  unit: 'bil' },
    { key: 'highest_transacted_rate',        label: 'Highest Transacted Rate (SORA)',               unit: 'pct' },
    { key: 'lowest_transacted_rate',         label: 'Lowest Transacted Rate (SORA)',                unit: 'pct' },
    { key: 'sora_calculation_method',        label: 'SORA Calculation Method',                      unit: 'text' },
]

// ── DB-backed cache ───────────────────────────────────────────────────────────

/** Upsert an array of raw MAS rows into domestic_rates (batched to stay under payload limits). */
export async function upsertDomesticRates(rows: DomesticRateRow[]): Promise<void> {
    const admin = createAdminClient()
    // MAS returns duplicate end_of_day rows; dedupe (last wins) so a single upsert
    // batch never contains two rows with the same value_date (Postgres rejects that).
    const byDate = new Map<string, { value_date: string; data: DomesticRateRow; fetched_at: string }>()
    for (const r of rows) {
        if (typeof r.end_of_day !== 'string') continue
        const { end_of_day, ...rest } = r
        byDate.set(end_of_day, { value_date: end_of_day, data: rest, fetched_at: new Date().toISOString() })
    }
    const inserts = [...byDate.values()]
    const BATCH = 500
    for (let i = 0; i < inserts.length; i += BATCH) {
        await admin
            .from('domestic_rates')
            .upsert(inserts.slice(i, i + BATCH), { onConflict: 'value_date' })
    }
}

/**
 * Return domestic rate rows for a date range — a pure, fast Postgres read.
 *
 * IMPORTANT: this NEVER calls the MAS endpoint. The MAS "Domestic Interest Rates"
 * feed takes minutes to respond (~8MB, ignores date filters), which is far longer
 * than a serverless function's timeout — calling it inside a user request meant the
 * page hung and the DB never got seeded. Instead, domestic_rates is kept populated
 * out-of-band: the daily cron upserts the latest row (refreshAll), and a one-time
 * backfill loads the full history. Reads here are milliseconds.
 *
 * Returns a `sampleRow` (the most recent row overall, fields intact) so the API can
 * discover which columns exist even when the requested range is empty.
 */
export async function getDomesticRates(
    start: string,
    end: string,
): Promise<{ rows: DomesticRateRow[]; sampleRow: DomesticRateRow | null }> {
    const admin = createAdminClient()

    // PostgREST hard-caps each response at 1000 rows; page through the range so wide
    // selections (e.g. 2005→today) aren't silently truncated.
    const PAGE = 1000
    const raw: { value_date: string; data: Record<string, unknown> }[] = []
    for (let from = 0; ; from += PAGE) {
        const { data } = await admin
            .from('domestic_rates')
            .select('value_date, data')
            .gte('value_date', start)
            .lte('value_date', end)
            .order('value_date', { ascending: false })
            .range(from, from + PAGE - 1)
        if (!data) break
        raw.push(...(data as typeof raw))
        if (data.length < PAGE) break
    }

    // Drop unpublished placeholder rows: MAS seeds today's value_date before the rate
    // is published (published_date null, all values null), which showed as an empty
    // "today" row. A row is real once MAS has published it.
    const rows = raw
        .filter(r => r.data?.published_date != null)
        .map(r => ({ end_of_day: r.value_date, ...r.data })) as DomesticRateRow[]

    // sampleRow only needs the FIELD KEYS for column discovery, so the latest row
    // overall (even an unpublished one — its keys are present) is fine.
    const { data: latest } = await admin
        .from('domestic_rates')
        .select('value_date, data')
        .order('value_date', { ascending: false })
        .limit(1)
        .maybeSingle()

    const sampleRow = (rows[0]
        ?? (latest ? { end_of_day: latest.value_date as string, ...(latest.data as Record<string, unknown>) } : null)
    ) as DomesticRateRow | null

    return { rows, sampleRow }
}

// ── MAS live fetch ────────────────────────────────────────────────────────────

/** Fetch all domestic interest rate rows from MAS. Cached 24h — ~8MB response. */
export async function fetchDomesticRatesFromMas(): Promise<DomesticRateRow[]> {
    const key = process.env.MAS_API_KEY
    if (!key) { console.error('[domesticRates] MAS_API_KEY not set'); return [] }
    try {
        const res = await fetch(MAS_URL, {
            headers: { keyid: key, accept: 'application/json' },
            next: { revalidate: 86400 },
        })
        if (!res.ok) { console.error('[domesticRates] MAS fetch failed:', res.status); return [] }
        const json = await res.json()
        return (json?.elements ?? []) as DomesticRateRow[]
    } catch (e) {
        console.error('[domesticRates] fetch threw:', String(e))
        return []
    }
}
