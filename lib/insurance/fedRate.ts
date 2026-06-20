// US Federal Funds Rate (FEDFUNDS) via FRED — St. Louis Federal Reserve.
// Monthly data, cached 24h server-side. Never call from the client — key lives server-only.

export interface FedRateEntry {
    date: string  // YYYY-MM-DD (first of month)
    rate: number  // percent
}

export async function fetchFedRateHistory(startDate = '2005-01-01'): Promise<FedRateEntry[]> {
    const key = process.env.FRED_API_KEY
    if (!key) {
        console.error('[fredRate] FRED_API_KEY not set')
        return []
    }
    try {
        const url =
            `https://api.stlouisfed.org/fred/series/observations` +
            `?series_id=FEDFUNDS&api_key=${key}&observation_start=${startDate}&file_type=json`
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) {
            console.error('[fredRate] FRED fetch failed:', res.status)
            return []
        }
        const json = await res.json()
        return (json.observations ?? [])
            .filter((o: { value: string }) => o.value !== '.')
            .map((o: { date: string; value: string }) => ({
                date: o.date,
                rate: parseFloat(o.value),
            }))
    } catch (e) {
        console.error('[fredRate] fetch threw:', String(e))
        return []
    }
}
