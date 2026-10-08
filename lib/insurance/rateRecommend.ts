// Step 4 decision support: turn structured packages + live SORA into computed
// effective rates, per-year installments, and a ranked recommendation for a
// specific client. Pure functions — reusable on client and server.

import type { MortgagePackage, RateScheduleEntry } from '@/lib/types/rates'
import type { SoraRates } from '@/lib/insurance/sora'
import { monthlyInstallment, computeRefiSavings, tdsrRatioForLoan, TDSR_LIMIT, type RefiSavings } from '@/lib/insurance/loanCalc'
import { applyLoanSizeFilter, matchesPropType, matchesRateType, matchesFeature, type PropTypeFilter } from '@/lib/insurance/rateFilters'

// ── Effective rate of a single schedule entry, given live SORA ──
// Returns { rate, note } where rate is null when it can't be computed (e.g. FD Rate).
export function effectiveRate(entry: RateScheduleEntry, sora: SoraRates | null): { rate: number | null; note?: string } {
    if (entry.type === 'fixed') return { rate: entry.rate ?? null }

    if (entry.spread == null) return { rate: null }
    const ref = (entry.reference || '').toLowerCase()
    const sign = entry.spreadSign === '-' ? -1 : 1

    // Bank-set benchmarks (FHR / FDR / FD / board rates) are NOT published by MAS —
    // each bank sets them. Resolve from admin-maintained bank_benchmarks table if available.
    if (/fhr|fdr|\bfd\b|board|fixed deposit/.test(ref)) {
        if (sora?.benchmarks) {
            const match = Object.keys(sora.benchmarks).find(k => ref.includes(k.toLowerCase()))
            if (match != null) {
                const base = sora.benchmarks[match]
                return { rate: base + sign * entry.spread, note: `${match} ${base.toFixed(4)}%` }
            }
        }
        return { rate: null, note: `${entry.reference} — rate not set (update in Rates page)` }
    }
    if (!sora) return { rate: null }

    const has1m = ref.includes('1m')
    const has3m = ref.includes('3m')
    const has6m = ref.includes('6m')

    let base: number | null = null
    let note: string | undefined
    if (has1m && has3m) {
        // "1M/3M SORA" → use the lower benchmark (better for the client estimate)
        const opts = [sora.comp_sora_1m, sora.comp_sora_3m].filter((v): v is number => v != null)
        if (opts.length) { base = Math.min(...opts); note = `1M/3M — used lower (${base === sora.comp_sora_1m ? '1M' : '3M'})` }
    } else if (has1m) base = sora.comp_sora_1m
    else if (has3m) base = sora.comp_sora_3m
    else if (has6m) base = sora.comp_sora_6m
    else if (ref.includes('sora')) base = sora.comp_sora_3m   // bare "SORA" → 3M compounded (common peg)
    else return { rate: null, note: `${entry.reference || 'reference'} — not a SORA benchmark, not auto-priced` }

    if (base == null) return { rate: null }
    return { rate: base + sign * entry.spread, note }
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
    propType?: PropTypeFilter             // Rates-page vocab — preferred; matches the browse page exactly
    priorityBanks?: string[]              // banks where the client holds priority status (lowers min-loan tier)
    currentBank?: string                  // client's existing bank — excluded (refinancing moves away)
    preference?: 'fixed' | 'floating' | 'either'
    rateTypes?: Set<string>               // granular rate-type pills (1Y/2Y/3Y/5Y Fixed, Floating) — Rates-page parity
    features?: Set<string>                // feature pills (waiver_sale, partial_repayment, free_conversion)
    includeBuc?: boolean                  // refinancing = completed property, so default false
    grossMonthlyIncome?: number
    existingMonthlyDebts?: number
    // Step-3 suitability signals (sharpen the ranking beyond price alone)
    holdingPeriod?: 'short' | 'medium' | 'long'
    paymentSensitivity?: 'low' | 'medium' | 'high'
    sellingPlan?: 'no' | 'yes' | 'unsure'
}

export interface FitReason { kind: 'good' | 'warn'; text: string }

export interface Fit {
    score: number              // higher = better suitability for this client
    reasons: FitReason[]
    hardConflict: boolean      // strong mismatch (e.g. long lock-in but selling soon) → demoted
}

export interface RecommendedPackage {
    pkg: MortgagePackage
    projection: PackageProjection
    savings: RefiSavings | null
    tdsrRatioPct: number | null
    eligible: boolean | null
    fit: Fit                              // suitability vs the client's profile
    reasons: string[]                     // technical notes / caveats
    appeal: boolean                       // min-loan up to 10% above the client's loan — bank may approve on appeal
    priority: boolean                     // only qualifies because of the client's priority-banking status
}

// Weighting kept as named deltas so it's easy to tune.
function assessSuitability(
    pkg: MortgagePackage,
    sora: SoraRates | null,
    criteria: RecommendCriteria,
): Fit {
    let score = 0
    const reasons: FitReason[] = []
    let hardConflict = false

    const lockin = pkg.lockin_years || 0
    const shortHolder = criteria.holdingPeriod === 'short' || criteria.sellingPlan === 'yes'
    const longHolder = criteria.holdingPeriod === 'long'

    // 1. Lock-in length vs how long they'll hold / whether they may sell.
    if (shortHolder) {
        if (lockin === 0) { score += 15; reasons.push({ kind: 'good', text: 'No lock-in — flexible if selling or refinancing early' }) }
        else if (lockin >= 3) { score -= 30; hardConflict = true; reasons.push({ kind: 'warn', text: `${lockin}Y lock-in — penalty risk if they sell soon` }) }
        else { score -= 8; reasons.push({ kind: 'warn', text: `${lockin}Y lock-in to consider` }) }
    }

    // 2. Payment sensitivity vs rate stability during the lock-in.
    if (criteria.paymentSensitivity === 'high' && lockin > 0) {
        const lockinFixed = pkg.rate_schedule
            .filter(e => !e.thereafter && typeof e.year === 'number' && e.year <= lockin)
            .every(e => e.type === 'fixed')
        if (lockinFixed) { score += 12; reasons.push({ kind: 'good', text: 'Fixed during lock-in — predictable payments' }) }
        else { score -= 15; reasons.push({ kind: 'warn', text: 'Payments vary during lock-in (client is rate-sensitive)' }) }
    }

    // 3. Reversion (thereafter) rate quality — matters most for long holders.
    const ta = pkg.rate_schedule.find(e => e.thereafter)
    if (ta && longHolder && ta.spread != null) {
        const taRate = effectiveRate(ta, sora).rate
        const shown = taRate != null ? ` (~${taRate.toFixed(2)}%)` : ''
        if (ta.spread <= 0.6) { score += 10; reasons.push({ kind: 'good', text: `Low reversion rate${shown} — good for a long hold` }) }
        else if (ta.spread >= 0.9) { score -= 12; reasons.push({ kind: 'warn', text: `High reversion rate${shown} after lock-in` }) }
    }

    // 4. Subsidy / rebate (text-only in our data, so a soft plus, not dollar-precise).
    if (pkg.subsidies && !/^\s*(no\b|none|nil)/i.test(pkg.subsidies)) {
        score += 6; reasons.push({ kind: 'good', text: 'Subsidy / rebate available' })
    }

    return { score, reasons, hardConflict }
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

    // Same filtering as the Rates page: loan-size tiering (+ priority thresholds
    // + ≤10% appeal), exclude the current bank, property type, preference (BUC
    // boundary), then the granular rate-type and feature pills.
    const candidates = applyLoanSizeFilter(packages, outstandingLoan, new Set(criteria.priorityBanks ?? []))
        .filter(({ pkg }) =>
            (!criteria.currentBank || pkg.bank !== criteria.currentBank) &&
            matchesPropType(pkg, criteria.propType ?? '') &&
            matchesPreference(pkg.category, criteria.preference, criteria.includeBuc) &&
            matchesRateType(pkg, criteria.rateTypes ?? new Set()) &&
            matchesFeature(pkg, criteria.features ?? new Set())
        )

    const scored: RecommendedPackage[] = candidates.map(({ pkg, appeal, priority }) => {
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

        const fit = assessSuitability(pkg, sora, criteria)

        return { pkg, projection, savings, tdsrRatioPct, eligible, fit, reasons, appeal, priority }
    })

    // Rank, in order of precedence:
    //  1. the displayed (year-1) rate, lowest first — agents read the list as a
    //     low→high rate ladder, so price on the card always leads (appeal packages
    //     are mixed in at their true rate position, not demoted below pricier ones)
    //  2. packages we can actually price sit above "not auto-priced" ones
    //  3-6. tie-breakers among equal year-1 rates: avoid hard fit conflicts, then
    //     highest monthly saving, then suitability score, then lowest lock-in avg rate
    return scored.sort((a, b) => {
        const ya = a.projection.perYear[0]?.ratePct
        const yb = b.projection.perYear[0]?.ratePct
        if ((ya == null) !== (yb == null)) return ya == null ? 1 : -1
        if (ya != null && yb != null && ya !== yb) return ya - yb
        if (a.fit.hardConflict !== b.fit.hardConflict) return a.fit.hardConflict ? 1 : -1
        const sa = a.savings?.monthlySaving ?? -Infinity
        const sb = b.savings?.monthlySaving ?? -Infinity
        if (sb !== sa) return sb - sa
        if (b.fit.score !== a.fit.score) return b.fit.score - a.fit.score
        const ra = a.projection.avgRateLockinPct ?? Infinity
        const rb = b.projection.avgRateLockinPct ?? Infinity
        return ra - rb
    })
}
