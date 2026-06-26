/**
 * New Purchase package recommendation — deliberately SEPARATE from the
 * refinancing engine (rateRecommend.ts).
 *
 * A new purchase is a different product from a refinance: there is no "current
 * rate" to save against, no clawback, and no refinance-suitability concerns
 * (selling/holding plans, lock-in expiry). So this does NOT reuse the refinance
 * ranker — it only borrows the pure *pricing* helpers (projectPackage /
 * effectiveRate), which are just arithmetic.
 *
 * The basis is intentionally narrow, per the product owner:
 *   1. Loan size      — filters out packages whose minimum loan is too high, and prices each one
 *   2. Property type  — matches the package universe (incl. completed-vs-BUC)
 *   3. Rate preference — fixed / floating / either
 * Ranking is simply the cheapest computed rate first. No income/TDSR.
 */

import type { MortgagePackage } from '@/lib/types/rates'
import type { SoraRates } from '@/lib/insurance/sora'
import { projectPackage, type PackageProjection } from '@/lib/insurance/rateRecommend'
import { applyLoanSizeFilter, matchesPropType, matchesRateType, matchesFeature, type PropTypeFilter } from '@/lib/insurance/rateFilters'

export interface PurchaseRecommendCriteria {
    loan: number
    tenureYears: number
    propertyType?: string                          // 'hdb' | 'private_condo' | 'landed' | 'ec'
    propType?: PropTypeFilter                      // Rates-page vocab — matches the browse page exactly
    bucOnly?: boolean                              // uncompleted property → only BUC/floating packages
    preference?: 'fixed' | 'floating' | 'either'
    rateTypes?: Set<string>                        // granular rate-type pills — Rates-page parity
    features?: Set<string>                         // feature pills
    priorityBanks?: string[]                       // banks where the client holds priority status
    excludeBank?: string                           // omit packages from this bank (e.g. IPA bank)
}

export interface PurchaseRecommendation {
    pkg: MortgagePackage
    projection: PackageProjection
    appeal: boolean                                // min-loan up to 10% above the loan — bank may approve on appeal
}

/**
 * Category match for a *purchase*. Note this differs from the refinance rule:
 * a completed purchase can never take a BUC package, and an uncompleted purchase
 * can ONLY take a BUC package — regardless of fixed/floating preference.
 */
function matchesPurchasePreference(
    category: string,
    preference: PurchaseRecommendCriteria['preference'],
    bucOnly?: boolean,
): boolean {
    if (bucOnly) return category === 'BUC'             // uncompleted property: only BUC packages apply
    if (category === 'BUC') return false               // completed property: BUC never applies
    if (!preference || preference === 'either') return true
    if (preference === 'fixed') return category === 'Fixed'
    return category === 'Floating (Completed)'         // floating
}

export function recommendPurchasePackages(
    packages: MortgagePackage[],
    sora: SoraRates | null,
    criteria: PurchaseRecommendCriteria,
): PurchaseRecommendation[] {
    const { loan, tenureYears } = criteria

    // Same filtering as the Rates page: loan-size tiering (+ priority thresholds
    // + ≤10% appeal), exclude the IPA bank, property type, purchase preference.
    const candidates = applyLoanSizeFilter(packages, loan, new Set(criteria.priorityBanks ?? []))
        .filter(({ pkg }) =>
            (!criteria.excludeBank || pkg.bank !== criteria.excludeBank) &&
            matchesPropType(pkg, criteria.propType ?? '') &&
            matchesPurchasePreference(pkg.category, criteria.preference, criteria.bucOnly) &&
            matchesRateType(pkg, criteria.rateTypes ?? new Set()) &&
            matchesFeature(pkg, criteria.features ?? new Set()),
        )

    const scored: PurchaseRecommendation[] = candidates.map(({ pkg, appeal }) => ({
        pkg,
        projection: projectPackage(pkg, loan, tenureYears, sora),
        appeal,
    }))

    // Rank: priceable first → strict qualifiers above appeal-eligible → cheapest
    // lock-in average rate → lowest year-1 rate → shorter lock-in as a final tiebreak.
    return scored.sort((a, b) => {
        if (a.projection.computable !== b.projection.computable) return a.projection.computable ? -1 : 1
        if (a.appeal !== b.appeal) return a.appeal ? 1 : -1
        const ra = a.projection.avgRateLockinPct ?? Infinity
        const rb = b.projection.avgRateLockinPct ?? Infinity
        if (ra !== rb) return ra - rb
        const ya = a.projection.perYear[0]?.ratePct ?? Infinity
        const yb = b.projection.perYear[0]?.ratePct ?? Infinity
        if (ya !== yb) return ya - yb
        return (a.pkg.lockin_years || 0) - (b.pkg.lockin_years || 0)
    })
}
