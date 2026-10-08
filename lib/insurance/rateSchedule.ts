// Structured rate-schedule helpers.
// - parseLegacyRates: convert the legacy "<br>"-joined free-text rates string
//   into a structured RateScheduleEntry[] (used by the migration seed and the
//   editor's "paste legacy text" convenience).
// - formatRateSchedule: render a structured schedule back to readable lines.
// - deriveFirstYearRate: rough numeric sort key from the first period.

import type { RateScheduleEntry } from '@/lib/types/rates'

// ── SORA freshness ────────────────────────────────────────────────────────────
// MAS publishes SORA every business day and our cron stores it daily; if the
// stored row is older than this many days the pipeline has been failing and
// floating-rate computations are silently running on stale data. Client-safe
// (unlike sora.ts, which pulls in the service-role client).

export const SORA_STALE_AFTER_DAYS = 5   // > weekend + public holiday span

/** Whole days since an ISO date (YYYY-MM-DD); null when absent/unparseable. */
export function soraAgeDays(valueDate?: string | null): number | null {
    if (!valueDate) return null
    const t = Date.parse(valueDate)
    if (Number.isNaN(t)) return null
    return Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
}

/** True when the stored SORA is old enough that agents should be warned. */
export function isSoraStale(valueDate?: string | null): boolean {
    const days = soraAgeDays(valueDate)
    return days != null && days > SORA_STALE_AFTER_DAYS
}

/** Normalize a floating benchmark string: "3MSORA" → "3M SORA", collapse spaces. */
export function cleanReference(raw: string): string {
    return raw
        .replace(/(\d)\s*M\s*SORA/gi, '$1M SORA')   // 3MSORA / 3M  SORA → 3M SORA
        .replace(/\s+/g, ' ')
        .trim()
}

/** Parse one "Year N: …" / "Thereafter: …" value (the part after the colon). */
function parseSpec(spec: string): Omit<RateScheduleEntry, 'year' | 'thereafter'> {
    const s = spec.replace(/\s+/g, ' ').trim()

    // Fixed: "2.00% Fixed" / "Fixed 2.00%"
    if (/fixed/i.test(s)) {
        const m = s.match(/([\d.]+)\s*%/)
        return { type: 'fixed', rate: m ? parseFloat(m[1]) : undefined }
    }

    // Floating: "<reference> + 0.35%"
    const m = s.match(/^(.*?)\s*\+\s*([\d.]+)\s*%/)
    if (m) {
        return { type: 'floating', reference: cleanReference(m[1]), spread: parseFloat(m[2]) }
    }

    // Fallback: keep whatever was written as the reference, no spread.
    return { type: 'floating', reference: cleanReference(s) }
}

/** Convert a legacy rates string into a structured, ordered schedule. */
export function parseLegacyRates(rates: string): RateScheduleEntry[] {
    if (!rates) return []
    const lines = rates
        .split(/<br>/i)
        .flatMap(l => l.split(/\r?\n/))
        .map(l => l.trim())
        .filter(Boolean)

    const out: RateScheduleEntry[] = []
    for (const line of lines) {
        const m = line.match(/^(thereafter|year\s*(\d+))\s*:\s*(.+)$/i)
        if (!m) continue
        const spec = parseSpec(m[3])
        if (/thereafter/i.test(m[1])) {
            out.push({ thereafter: true, ...spec })
        } else {
            out.push({ year: parseInt(m[2], 10), ...spec })
        }
    }
    return out
}

/** Render one schedule entry to a readable string. */
export function formatRateEntry(e: RateScheduleEntry): string {
    const label = e.thereafter ? 'Thereafter' : `Year ${e.year}`
    let rate: string
    if (e.type === 'fixed') {
        rate = e.rate != null ? `${e.rate.toFixed(2)}% Fixed` : 'Fixed'
    } else {
        const ref = e.reference || 'SORA'
        const sign = e.spreadSign === '-' ? '−' : '+'
        rate = e.spread != null ? `${ref} ${sign} ${e.spread.toFixed(2)}%` : ref
    }
    return `${label}: ${rate}`
}

/** Render a schedule to display lines. */
export function formatRateSchedule(schedule: RateScheduleEntry[]): string[] {
    return (schedule ?? []).map(formatRateEntry)
}

/** Rough numeric sort key: fixed → rate, floating → spread. */
export function deriveFirstYearRate(schedule: RateScheduleEntry[]): number | null {
    const first = schedule?.[0]
    if (!first) return null
    if (first.type === 'fixed') return first.rate ?? null
    return first.spread ?? null
}

/** "2 Years" / "No Lock-in" → integer years. */
export function lockinYearsFromLegacy(text: string): number {
    if (!text || /no\s*lock/i.test(text)) return 0
    const m = text.match(/(\d+)/)
    return m ? parseInt(m[1], 10) : 0
}
