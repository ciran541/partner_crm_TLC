// Shared package-filtering logic — the SINGLE source of truth used by both the
// Rates browse page (app/insurance/dashboard/rates/page.tsx) and the workflow
// Step-4 recommenders (rateRecommend.ts / purchaseRecommend.ts). Keeping these
// here means a client seen inside a workflow is filtered identically to what an
// agent would see browsing the Rates page for the same loan / property / priority.

import type { MortgagePackage } from '@/lib/types/rates'

export type PropTypeFilter = '' | 'hdb' | 'bto' | 'private_completed' | 'private_uc'

/** Number of fixed-rate years in the schedule (excludes thereafter). A package is
 *  "1 Year Fixed" when it has exactly 1 fixed entry, regardless of its lock-in. */
export function fixedRateYears(pkg: MortgagePackage): number {
    return pkg.rate_schedule.filter(e => e.type === 'fixed' && !e.thereafter).length
}

/** Parse a priority-customer minimum loan size from min_loan_note.
 *  Looks for patterns like "Priority Banking: min $300K" or "Privilege: min $500K". */
export function parsePriorityMin(note: string | null | undefined): number | null {
    if (!note) return null
    const lower = note.toLowerCase()
    if (!lower.includes('priority') && !lower.includes('privilege') && !lower.includes('premier')) return null
    const m = note.match(/\$?([\d.]+)\s*([KkMm])?/)
    if (!m) return null
    let n = parseFloat(m[1])
    if (!Number.isFinite(n)) return null
    const suffix = (m[2] || '').toLowerCase()
    if (suffix === 'k') n *= 1_000
    else if (suffix === 'm') n *= 1_000_000
    return n
}

/**
 * Loan-size tiering. Groups packages by bank+category+property+lock-in and, within
 * each group, keeps only the HIGHEST qualifying min-loan tier (better rate) for the
 * given loan. Packages whose minimum is up to 10% above the loan are returned as
 * `appeal: true` — the bank may still approve on appeal. Priority-banking clients
 * unlock a lower threshold from min_loan_note for the banks they hold status with;
 * a package the client only reaches because of that lowered threshold (its standard
 * min-loan exceeds the loan) is flagged `priority: true`.
 */
export function applyLoanSizeFilter(
    pkgs: MortgagePackage[],
    loan: number,
    priorityBanks: Set<string> = new Set(),
): { pkg: MortgagePackage; appeal: boolean; priority: boolean }[] {
    const groups = new Map<string, MortgagePackage[]>()
    for (const pkg of pkgs) {
        const key = `${pkg.bank}|${pkg.category}|${pkg.property_type}|${pkg.lockin_years}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(pkg)
    }
    const effectiveMin = (pkg: MortgagePackage): number => {
        if (priorityBanks.has(pkg.bank)) {
            const pm = parsePriorityMin(pkg.min_loan_note)
            if (pm != null && pm < pkg.min_loan_size) return pm
        }
        return pkg.min_loan_size
    }
    // True when the client only qualifies (strict or appeal) thanks to their priority
    // status — i.e. the standard min-loan alone would exclude this package for this loan.
    const usesPriority = (pkg: MortgagePackage): boolean =>
        priorityBanks.has(pkg.bank) && pkg.min_loan_size > loan && effectiveMin(pkg) < pkg.min_loan_size

    const result: { pkg: MortgagePackage; appeal: boolean; priority: boolean }[] = []
    for (const [, group] of groups) {
        const strict = group.filter(p => effectiveMin(p) <= loan)
        if (strict.length > 0) {
            const maxTier = Math.max(...strict.map(p => effectiveMin(p)))
            strict.filter(p => effectiveMin(p) === maxTier).forEach(p => result.push({ pkg: p, appeal: false, priority: usesPriority(p) }))
        }
        // Within 10% above the loan → bank may approve on appeal.
        const VARIANCE = 1 / 0.9
        group.filter(p => effectiveMin(p) > loan && effectiveMin(p) <= loan * VARIANCE)
            .forEach(p => result.push({ pkg: p, appeal: true, priority: usesPriority(p) }))
    }
    return result
}

/** Property-type match (HDB / BTO / Private-completed / Private-UC). EC is treated
 *  as private here, mirroring the Rates page (it has no separate EC filter). */
export function matchesPropType(pkg: MortgagePackage, propType: PropTypeFilter): boolean {
    if (!propType) return true
    const pt = pkg.property_type.toLowerCase()
    const isHdb = pt.includes('hdb')
    const isPrivate = pt.includes('private') || pt.includes('executive')
    const isBuc = pkg.category === 'BUC'
    if (propType === 'hdb')               return isHdb && !isBuc
    if (propType === 'bto')               return isHdb && isBuc
    if (propType === 'private_completed') return isPrivate && !isBuc
    if (propType === 'private_uc')        return isPrivate && isBuc
    return true
}

/** Map the workflow's property-type vocabulary (from ratesPropertyType) + a
 *  completion flag into the Rates-page PropTypeFilter, so the workflow filters
 *  packages exactly like the Rates page does. */
export function workflowPropType(
    rt: 'hdb' | 'private_condo' | 'landed' | 'ec' | undefined,
    underConstruction = false,
): PropTypeFilter {
    if (!rt) return ''
    if (rt === 'hdb') return underConstruction ? 'bto' : 'hdb'
    return underConstruction ? 'private_uc' : 'private_completed'
}

// ── Rate type & feature filters ─────────────────────────────────────────────

export interface RateTypeOption { key: string; label: string; category: string; lockin: number | null }
export const RATE_TYPE_OPTIONS: RateTypeOption[] = [
    { key: '1Y_FIXED',           label: '1 Year Fixed',         category: 'Fixed',                lockin: 1    },
    { key: '2Y_FIXED',           label: '2 Year Fixed',         category: 'Fixed',                lockin: 2    },
    { key: '3Y_FIXED',           label: '3 Year Fixed',         category: 'Fixed',                lockin: 3    },
    { key: '5Y_FIXED',           label: '5 Year Fixed',         category: 'Fixed',                lockin: 5    },
    { key: 'FLOATING_COMPLETED', label: 'Floating (Completed)', category: 'Floating (Completed)', lockin: null },
    { key: 'BUC',                label: 'BUC / BTO',            category: 'BUC',                  lockin: null },
]

export const FEATURE_OPTIONS = [
    { key: 'waiver_sale',       label: 'Waiver Due to Sale'          },
    { key: 'partial_repayment', label: 'Partial Repayment'           },
    { key: 'free_conversion',   label: 'Free Conversion (after 12M)' },
]

/** Match by rate type — a package matches if it satisfies ANY selected option
 *  (category + fixed-lock-in count). Empty selection = no filter. */
export function matchesRateType(pkg: MortgagePackage, rateTypes: Set<string>): boolean {
    if (rateTypes.size === 0) return true
    return RATE_TYPE_OPTIONS.some(o =>
        rateTypes.has(o.key) && pkg.category === o.category && (o.lockin === null || fixedRateYears(pkg) === o.lockin))
}

/** Match by feature — a package must satisfy ALL selected features. Empty = no filter. */
export function matchesFeature(pkg: MortgagePackage, features: Set<string>): boolean {
    if (features.size === 0) return true
    const fl = pkg.features.map(f => f.toLowerCase())
    for (const fk of features) {
        const ok = fk === 'waiver_sale'       ? fl.some(f => f.includes('waiver') && (f.includes('sale') || f.includes('sold')))
                 : fk === 'partial_repayment' ? fl.some(f => f.includes('partial'))
                 : fk === 'free_conversion'   ? fl.some(f => {
                       if (!f.includes('conversion') && !f.includes('convert')) return false
                       const m = f.match(/(\d+)\s*months?/i)
                       return !m || parseInt(m[1]) <= 12
                   })
                 : false
        if (!ok) return false
    }
    return true
}

/** Compact loan formatting — "$1.5M", "$800k", "$500". Shared by the Rates browse
 *  tab and the workflow package cards so min-loan figures read identically. */
export function shortLoan(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
    if (n >= 1_000)     return `$${Math.round(n / 1_000)}k`
    return `$${n}`
}

// ── Rate-type columns (workflow package showcase — mirrors the Rates browse tab) ──

export interface RateTypeColumn {
    key: string
    label: string
    accentHex: string
    match: (p: MortgagePackage) => boolean
}

/** Column buckets for grouping recommended packages by rate type, in display order.
 *  Mirrors the Rates page COLUMN_DEFS so a client seen inside a workflow is grouped
 *  identically to the browse tab. */
export const RATE_TYPE_COLUMNS: RateTypeColumn[] = [
    { key: '1Y',     label: '1 Year Fixed',         accentHex: '#052d4a', match: p => p.category === 'Fixed' && fixedRateYears(p) === 1 },
    { key: '2Y',     label: '2 Year Fixed',         accentHex: '#052d4a', match: p => p.category === 'Fixed' && fixedRateYears(p) === 2 },
    { key: '3Y',     label: '3 Year Fixed',         accentHex: '#052d4a', match: p => p.category === 'Fixed' && fixedRateYears(p) === 3 },
    { key: '5Y',     label: '5 Year Fixed',         accentHex: '#052d4a', match: p => p.category === 'Fixed' && fixedRateYears(p) === 5 },
    { key: 'OTHFIX', label: 'Other Fixed',          accentHex: '#64748b', match: p => p.category === 'Fixed' && ![1, 2, 3, 5].includes(fixedRateYears(p)) },
    { key: 'FLOAT',  label: 'Floating (Completed)', accentHex: '#03a9e7', match: p => p.category === 'Floating (Completed)' },
    { key: 'BUC',    label: 'BUC / BTO',            accentHex: '#f59e0b', match: p => p.category === 'BUC' },
]

/** Bucket already-ranked recommendations into rate-type columns, preserving rank
 *  order within each column and dropping empty columns. Generic over any item that
 *  carries a `pkg` (purchase + refi recommendations both do). */
export function groupByRateTypeColumn<T extends { pkg: MortgagePackage }>(
    items: T[],
): { col: RateTypeColumn; items: T[] }[] {
    return RATE_TYPE_COLUMNS
        .map(col => ({ col, items: items.filter(it => col.match(it.pkg)) }))
        .filter(g => g.items.length > 0)
}

/** Remove the bank-name prefix from a package name (the bank is already shown as
 *  the card title, so repeating it is noise). e.g. "OCBC 1Y Fixed Rates" → "1Y Fixed Rates". */
export function stripBankPrefix(name: string, bank: string): string {
    if (!name.toLowerCase().startsWith(bank.toLowerCase())) return name
    return name.slice(bank.length).replace(/^\s*[-–—:,*]\s*/, '').trim()
}

/** Flexi = free conversion available before lock-in ends; Traditional = no early
 *  conversion. Null when there's no lock-in (the distinction doesn't apply).
 *  Takes a structural subset so it works on both a full package and a stored snapshot. */
export function packageStyle(pkg: { lockin_years: number; features: string[] }): 'flexi' | 'traditional' | null {
    if (pkg.lockin_years === 0) return null
    const lockinMonths = pkg.lockin_years * 12
    const convEntry = pkg.features.map(f => f.toLowerCase())
        .find(f => f.includes('conversion') || f.includes('convert'))
    if (!convEntry) return 'traditional'
    const m = convEntry.match(/(\d+)\s*months?/i)
    if (!m) return 'flexi'  // conversion with no stated timeframe = anytime
    return parseInt(m[1]) < lockinMonths ? 'flexi' : 'traditional'
}

/** Seed the granular rate-type pills from the saved coarse preference, so the
 *  workflow panel starts aligned with what the client said. fixed → all fixed
 *  tiers; floating → floating; both/either → none (show everything). Mirrors the
 *  Rates page (which has no "other fixed" pill either). */
export function seedRateTypesFromPreference(preference?: 'fixed' | 'floating' | 'both' | 'either'): Set<string> {
    if (preference === 'fixed') return new Set(['1Y_FIXED', '2Y_FIXED', '3Y_FIXED', '5Y_FIXED'])
    if (preference === 'floating') return new Set(['FLOATING_COMPLETED'])
    return new Set()
}
