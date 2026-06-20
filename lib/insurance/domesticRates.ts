// MAS Domestic Interest Rates — full field fetch for the Domestic Rates data table.
// Same endpoint as SORA; we just pass through all fields instead of mapping only SORA ones.

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
