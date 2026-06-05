// Step 4 decision support: turn structured packages + live SORA into computed
// effective rates, per-year installments, and a ranked recommendation for a
// specific client. Pure functions — reusable on client and server.

import type { MortgagePackage, RateScheduleEntry } from '@/lib/types/rates'
import type { SoraRates } from '@/lib/insurance/sora'
import { monthlyInstallment, computeRefiSavings, tdsrRatioForLoan, TDSR_LIMIT, type RefiSavings } from '@/lib/insurance/loanCalc'

// ── Effective rate of a single schedule entry, given live SORA ──
// Returns { rate, note } where rate is null when it can't be computed (e.g. FD Rate).
export function effectiveRate(entry: RateScheduleEntry, sora: SoraRates | null): { rate: number | null; note?: string } {
    if (entry.type === 'fixed') return { rate: entry.rate ?? null }

    if (entry.spread == null) return { rate: null }
    const ref = (entry.reference || '').toLowerCase()
    const has1m = ref.includes('1m')
    const has3m = ref.includes('3m')
    const has6m = ref.includes('6m')

    if (ref.includes('fd')) return { rate: null, note: 'FD-pegged — not auto-computed' }
    if (!sora) return { rate: null }

    let base: number | null = null
    let note: string | undefined
    if (has1m && has3m) {
        // "1M/3M SORA" → use the lower benchmark (better for the client estimate)
        const opts = [sora.comp_sora_1m, sora.comp_sora_3m].filter((v): v is number => v != null)
        if (opts.length) { base = Math.min(...opts); note = `1M/3M — used lower (${base === sora.comp_sora_1m ? '1M' : '3M'})` }
    } else if (has1m) base = sora.comp_sora_1m
    else if (has3m) base = sora.comp_sora_3m
    else if (has6m) base = sora.comp_sora_6m
    else base = sora.comp_sora_3m   // bare "SORA" → 3M compounded (most common bank peg)

    if (base == null) return { rate: null }
    return { rate: base + entry.spread, note }
}

export interface YearProjection {
    year: number
    ratePct: number | null
    installment: number | null
}

export interface PackageProjection {
    computable: boolean              // false if any lock-in year couldn't be computed
    lockinYears: number
    perYear: YearProjection[]
    avgRateLockinPct: number | null  // mean effective rate over the lock-in (or year 1 if no lock-in)
    newMonthly: number | null        // representative monthly at the lock-in average rate
    notes: string[]
}

/**
 * Project per-year installments by re-amortising at each year's effective rate
 * (how banks recompute the instalment at every rate step).
 */
export function projectPackage(pkg: MortgagePackage, loan: number, tenureYears: number, sora: SoraRates | null): PackageProjection {
    const notes = new Set<string>()
    const years = (pkg.rate_schedule ?? [])
        .filter(e => !e.thereafter && typeof e.year === 'number')
        .sort((a, b) => (a.year! - b.year!))

    const perYear: YearProjection[] = []
    let balance = loan
    let remaining = tenureYears
    let computable = true

    for (const e of years) {
        const { rate, note } = effectiveRate(e, sora)
        if (note) notes.add(note)
        if (rate == null) {
            perYear.push({ year: e.year!, ratePct: null, installment: null })
            // can't amortise further without a rate
            computable = false
            remaining = Math.max(remaining - 1, 0)
            continue
        }
        const inst = monthlyInstallment(balance, rate, remaining)
        perYear.push({ year: e.year!, ratePct: rate, installment: inst })
        balance = balanceAfter(balance, rate, inst, 12)
        remaining = Math.max(remaining - 1, 0)
    }

    const lockinYears = pkg.lockin_years || 0
    const span = lockinYears > 0 ? lockinYears : 1
    const lockinRates = perYear.slice(0, span).map(p => p.ratePct).filter((r): r is number => r != null)
    const avgRateLockinPct = lockinRates.length ? lockinRates.reduce((a, b) => a + b, 0) / lockinRates.length : null
    const lockinComputable = perYear.slice(0, span).every(p => p.ratePct != null) && perYear.length > 0
    const newMonthly = avgRateLockinPct != null ? monthlyInstallment(loan, avgRateLockinPct, tenureYears) : null

    return {
        computable: computable && lockinComputable,
        lockinYears,
        perYear,
        avgRateLockinPct,
        newMonthly,
        notes: [...notes],
    }
}

/** Outstanding balance after `months` of payments at monthly-equivalent of annualRatePct. */
function balanceAfter(principal: number, annualRatePct: number, monthlyPayment: number, months: number): number {
    const r = (annualRatePct / 100) / 12
    if (r === 0) return Math.max(principal - monthlyPayment * months, 0)
    const f = Math.pow(1 + r, months)
    return Math.max(principal * f - monthlyPayment * (f - 1) / r, 0)
}

// ── Recommendation ──

export interface RecommendCriteria {
    outstandingLoan: number
    remainingTenureYears: number
    currentRatePct?: number
    clawbackAmount?: number
    propertyType?: string                 // workflow ('hdb'|'private_condo'|'landed'|'ec') or display
    preference?: 'fixed' | 'floating' | 'either'
    includeBuc?: boolean                  // refinancing = completed property, so default false
    grossMonthlyIncome?: number
    existingMonthlyDebts?: number
}

export interface RecommendedPackage {
    pkg: MortgagePackage
    projection: PackageProjection
    savings: RefiSavings | null
    tdsrRatioPct: number | null
    eligible: boolean | null
    reasons: string[]                     // why it ranked / caveats
}

export function matchesPropertyType(pkgType: string, clientType?: string): boolean {
    if (!clientType) return true
    const p = pkgType.toLowerCase()
    if (p.includes('hdb / private')) return true
    const c = clientType.toLowerCase()
    if (c === 'hdb' || c.includes('hdb')) return p.includes('hdb')
    if (c === 'ec' || c.includes('executive')) return p.includes('executive')
    return p.includes('private')          // private_condo / landed / private
}

export function matchesPreference(category: string, preference?: string, includeBuc = false): boolean {
    if (category === 'BUC' && !includeBuc) return false
    if (!preference || preference === 'either') return true
    if (preference === 'fixed') return category === 'Fixed'
    return category === 'Floating (Completed)' || category === 'BUC'   // floating
}

/** Filter to packages the client qualifies for, compute savings, rank best-first. */
export function recommendPackages(
    packages: MortgagePackage[],
    sora: SoraRates | null,
    criteria: RecommendCriteria,
): RecommendedPackage[] {
    const { outstandingLoan, remainingTenureYears } = criteria
    const eligibleByCapacity = criteria.grossMonthlyIncome != null

    const candidates = packages.filter(pkg =>
        pkg.min_loan_size <= outstandingLoan &&
        matchesPropertyType(pkg.property_type, criteria.propertyType) &&
        matchesPreference(pkg.category, criteria.preference, criteria.includeBuc)
    )

    const scored: RecommendedPackage[] = candidates.map(pkg => {
        const projection = projectPackage(pkg, outstandingLoan, remainingTenureYears, sora)
        const reasons: string[] = [...projection.notes]

        let savings: RefiSavings | null = null
        if (criteria.currentRatePct != null && projection.avgRateLockinPct != null) {
            savings = computeRefiSavings({
                outstandingLoan,
                remainingTenureYears,
                currentRatePct: criteria.currentRatePct,
                newRatePct: projection.avgRateLockinPct,
                clawbackAmount: criteria.clawbackAmount,
            })
        }

        let tdsrRatioPct: number | null = null
        let eligible: boolean | null = null
        if (eligibleByCapacity) {
            tdsrRatioPct = tdsrRatioForLoan({
                loanAmount: outstandingLoan,
                tenureYears: remainingTenureYears,
                grossMonthlyIncome: criteria.grossMonthlyIncome!,
                existingMonthlyDebts: criteria.existingMonthlyDebts ?? 0,
            })
            eligible = tdsrRatioPct <= TDSR_LIMIT * 100
            if (eligible === false) reasons.push(`TDSR ${tdsrRatioPct.toFixed(0)}% exceeds 55%`)
        }

        return { pkg, projection, savings, tdsrRatioPct, eligible, reasons }
    })

    // Rank: computable first, then highest monthly saving, then lowest lock-in avg rate.
    return scored.sort((a, b) => {
        if (a.projection.computable !== b.projection.computable) return a.projection.computable ? -1 : 1
        const sa = a.savings?.monthlySaving ?? -Infinity
        const sb = b.savings?.monthlySaving ?? -Infinity
        if (sb !== sa) return sb - sa
        const ra = a.projection.avgRateLockinPct ?? Infinity
        const rb = b.projection.avgRateLockinPct ?? Infinity
        return ra - rb
    })
}
