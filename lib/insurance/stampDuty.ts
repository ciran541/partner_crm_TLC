/**
 * Stamp duty — the ONE place BSD tiers and ABSD rates live.
 *
 * These numbers are set by IRAS and change by government decree. They used to
 * be copied into purchaseCalc.ts, decoupleCalc.ts AND the stamp-duty calculator
 * page — three files to update in lockstep with no test to catch a miss. Every
 * consumer (workflow engines, calculators, presentations) now derives from
 * here. Current tiers include the Feb-2023 >$1.5M residential bands.
 *
 * Pure functions, no framework deps.
 */

export type Residency = 'singaporean' | 'pr' | 'foreigner'

// ── Buyer's Stamp Duty (BSD) — residential ────────────────────────────────────

export interface BsdTier {
    label: string
    floor: number
    ceiling: number | null   // null = uncapped top tier
    rate: number
}

export const BSD_TIERS: BsdTier[] = [
    { label: 'First $180,000',   floor: 0,         ceiling: 180_000,   rate: 0.01 },
    { label: 'Next $180,000',    floor: 180_000,   ceiling: 360_000,   rate: 0.02 },
    { label: 'Next $640,000',    floor: 360_000,   ceiling: 1_000_000, rate: 0.03 },
    { label: 'Next $500,000',    floor: 1_000_000, ceiling: 1_500_000, rate: 0.04 },
    { label: 'Next $1,500,000',  floor: 1_500_000, ceiling: 3_000_000, rate: 0.05 },
    { label: 'Above $3,000,000', floor: 3_000_000, ceiling: null,      rate: 0.06 },
]

export interface BsdTierRow {
    label: string
    rate: number
    taxable: number
    amount: number
}

/** BSD with the per-tier breakdown (for calculator display). */
export function computeBsdBreakdown(price: number): { total: number; tiers: BsdTierRow[] } {
    const tiers: BsdTierRow[] = []
    let total = 0
    if (price <= 0) return { total, tiers }
    for (const t of BSD_TIERS) {
        if (price <= t.floor) break
        const taxable = Math.min(price, t.ceiling ?? Infinity) - t.floor
        const amount = taxable * t.rate
        total += amount
        tiers.push({ label: t.label, rate: t.rate, taxable, amount })
    }
    return { total, tiers }
}

/** Buyer's Stamp Duty (BSD) — total only. */
export function calculateBSD(price: number): number {
    return computeBsdBreakdown(price).total
}

// ── Additional Buyer's Stamp Duty (ABSD) ──────────────────────────────────────

/**
 * ABSD rate by buyer profile and the property count being purchased.
 * propertyCount = existing housing loans + 1 (the property being bought).
 * NOTE: ABSD rates change — verify against current IRAS rates before relying on these.
 */
export function absdRate(residency: Residency, propertyCount: 1 | 2 | 3): number {
    if (residency === 'foreigner') return 0.60
    if (residency === 'pr') return propertyCount === 1 ? 0.05 : propertyCount === 2 ? 0.30 : 0.35
    /* singaporean */              return propertyCount === 1 ? 0.00 : propertyCount === 2 ? 0.20 : 0.30
}

/** Worst-case residency across all buyers (foreigner > PR > citizen). */
export function worstResidency(residencies: (Residency | undefined)[]): Residency {
    if (residencies.includes('foreigner')) return 'foreigner'
    if (residencies.includes('pr')) return 'pr'
    return 'singaporean'
}
