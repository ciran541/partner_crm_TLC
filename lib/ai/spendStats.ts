/** Maths behind Admin > AI Spend. Pure. */

export interface SpendRow {
    day: string; feature: string; model: string; environment: string
    calls: number; failed: number; input: number; output: number; cost: number; unpriced: number
}

const FEATURES: Record<string, string> = {
    'news-classify': 'Mortgage News: relevance check',
    'news-summary': 'Mortgage News: summaries',
    normalizeQuery: 'Knowledge: question tidy-up (removed)',
    askKnowledge: 'Knowledge: answers',
    extractPackages: 'Rate import',
    extractPromotions: 'Bank promotion import',
    extractLoanOffer: 'Letter of Offer (Premium)',
    extractLetterOfOffer: 'Letter of Offer (Basic & Starter)',
    bankIntelligence: "Banks' Insights",
    'bankIntelligence-pdf': "Banks' Insights (PDF read)",
}
export const featureLabel = (f: string) => FEATURES[f] ?? f

/** 'claude-haiku-5-5' → 'Haiku 5.5' */
export function modelLabel(m: string): string {
    if (m.startsWith('gemini-')) return `${m.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')} (free)`
    const x = m.match(/^claude-([a-z])([a-z]*)-(\d+)-(\d+)$/)
    return x ? `${x[1].toUpperCase()}${x[2]} ${x[3]}.${x[4]}` : m
}

/** Small sums need more decimals: $12.40, $0.043, under $0.001. */
export function usd(n: number): string {
    if (n === 0) return '$0.00'
    if (n < 0.001) return 'under $0.001'
    return `$${n.toFixed(n < 0.1 ? 3 : 2)}`
}

export interface SpendTotals { calls: number; failed: number; input: number; output: number; cost: number; unpriced: number }
export function totals(rows: SpendRow[]): SpendTotals {
    const t = { calls: 0, failed: 0, input: 0, output: 0, cost: 0, unpriced: 0 }
    for (const r of rows) for (const k of Object.keys(t) as (keyof SpendTotals)[]) t[k] += Number(r[k])
    return t
}

/** Totals per key, most expensive first. */
export function groupBy(rows: SpendRow[], key: (r: SpendRow) => string): (SpendTotals & { key: string })[] {
    const m = new Map<string, SpendRow[]>()
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r])
    return [...m].map(([k, rs]) => ({ key: k, ...totals(rs) })).sort((a, b) => b.cost - a.cost || b.calls - a.calls)
}

/** scope: 'YYYY-MM' | 'YYYY' | 'all' */
export const inScope = (day: string, scope: string) => scope === 'all' || day.startsWith(scope)

/**
 * This month's cost at the current daily pace. Counts from the first recorded
 * day, so tracking that starts mid-month isn't under-projected. Null before 3
 * days of data: too little to say anything.
 */
export function projectMonth(rows: SpendRow[], today: string): number | null {
    const month = rows.filter(r => r.day.startsWith(today.slice(0, 7)) && r.day <= today)
    if (!month.length) return null
    const first = Number(month.map(r => r.day).sort()[0].slice(8))
    const days = Number(today.slice(8)) - first + 1
    if (days < 3) return null
    const [y, m] = today.split('-').map(Number)
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return totals(month).cost / days * (lastDay - first + 1)
}
