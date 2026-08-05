/**
 * Bank promotion matching — the one place that decides whether a promotion
 * applies to a given case, and what it is worth.
 *
 * Pure functions only (no Supabase, no React) so the boundary behaviour is
 * unit-testable: bank messages are habitually ambiguous at tier edges ("1m to
 * 1.5m … above 1.5m" both lay claim to exactly $1.5m), and a promotion is money
 * a client is told they will receive, so the rule has to be explicit and pinned
 * by tests rather than re-derived at each call site.
 *
 * Two safety defaults worth knowing:
 *   • Drafts are excluded unless a caller opts in.
 *   • A promotion whose tiers exclude this loan does NOT match. Badging a
 *     package with a rebate the client can't actually claim is worse than
 *     showing nothing.
 */

import type { BankPromotion, PromotionTier } from '@/lib/types/promotions'
import type { CaseType } from '@/lib/types/insurance'

/**
 * Today in Singapore time as YYYY-MM-DD.
 *
 * Not `new Date().toISOString()`: that is UTC, and every hour between midnight
 * and 8am SGT it reports YESTERDAY. For a feature whose whole point is a
 * submission deadline, that means an agent opening the CRM at 9am on the 17th
 * would still be shown a promotion that closed on the 16th — and Vercel runs in
 * UTC, so this would never reproduce on a local SGT machine. Singapore has no
 * DST, so a fixed +8 is exact rather than an approximation.
 */
export function todaySgt(now: Date = new Date()): string {
    return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
}

/** Whole days from `today` until the promotion closes. Null = open-ended. */
export function daysRemaining(promo: BankPromotion, today: string = todaySgt()): number | null {
    if (!promo.ends_on) return null
    const ms = Date.parse(`${promo.ends_on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)
    return Math.round(ms / 86_400_000)
}

/**
 * Is the promotion open today? Both bounds are INCLUSIVE — a promotion running
 * "3 to 16 August" is still claimable on the 16th, which is exactly the day an
 * agent most needs to see it.
 */
export function isActive(promo: BankPromotion, today: string = todaySgt()): boolean {
    if (promo.starts_on && today < promo.starts_on) return false
    if (promo.ends_on && today > promo.ends_on) return false
    return true
}

/** Closing within `withinDays` — drives the urgency treatment in the UI. */
export function endingSoon(promo: BankPromotion, today: string = todaySgt(), withinDays = 3): boolean {
    const left = daysRemaining(promo, today)
    return left != null && left >= 0 && left <= withinDays
}

/** Not yet open, but announced. Worth showing an agent so they can time a submission. */
export function isUpcoming(promo: BankPromotion, today: string = todaySgt()): boolean {
    return !!promo.starts_on && today < promo.starts_on
}

/**
 * Which tier a loan falls in, or null if none does.
 *
 * Tiers are walked IN ORDER and the first match wins. That is what settles the
 * ambiguous boundary: with "$1m–$1.5m → $800" listed before "above $1.5m →
 * $1,200", a loan of exactly $1.5m resolves to $800. A loan can therefore never
 * resolve to two different benefits, whatever the bank's wording did.
 */
export function resolveTier(promo: BankPromotion, loanAmount: number): PromotionTier | null {
    for (const tier of promo.benefit_tiers ?? []) {
        const aboveMin = loanAmount >= (tier.min_loan ?? 0)
        const belowMax = tier.max_loan == null || loanAmount <= tier.max_loan
        if (aboveMin && belowMax) return tier
    }
    return null
}

/** What a tier is worth in dollars. `percent` is percentage points (0.2 = 0.2%). */
export function tierValue(tier: PromotionTier, loanAmount?: number): number | null {
    if (tier.amount != null) return tier.amount
    if (tier.percent != null && loanAmount != null) return Math.round((loanAmount * tier.percent) / 100)
    return null
}

const BENEFIT_LABELS: Record<string, string> = {
    cash_rebate:    'cash rebate',
    referral_bonus: 'referral',
    fee_waiver:     'fee waiver',
    rate_discount:  'rate discount',
    other:          '',
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`

/**
 * Human label for a promotion's benefit.
 *
 * With a loan amount it is exact ("$1,200 cash rebate"); without one it spans
 * the tiers ("$800–$1,200 cash rebate"), which is the honest thing to show on a
 * dashboard or rates page where no case is in context.
 */
export function formatBenefit(promo: BankPromotion, loanAmount?: number): string {
    const suffix = BENEFIT_LABELS[promo.benefit_type] ?? ''
    const withSuffix = (head: string) => (suffix ? `${head} ${suffix}` : head)
    const tiers = promo.benefit_tiers ?? []
    if (!tiers.length) return withSuffix('Promotion').trim()

    if (loanAmount != null) {
        const tier = resolveTier(promo, loanAmount)
        // matchPromotions drops these before they reach a card; this only fires
        // for a direct caller, so keep it a plain statement of fact.
        if (!tier) return 'Not eligible at this loan size'
        const value = tierValue(tier, loanAmount)
        if (tier.percent != null) {
            return withSuffix(value != null ? `${tier.percent}% (${money(value)})` : `${tier.percent}%`)
        }
        return value != null ? withSuffix(money(value)) : withSuffix('Promotion')
    }

    // No case in context — describe the range across all tiers.
    if (tiers.every(t => t.percent != null && t.amount == null)) {
        const pcts = [...new Set(tiers.map(t => t.percent!))].sort((a, b) => a - b)
        return withSuffix(pcts.length > 1 ? `${pcts[0]}–${pcts[pcts.length - 1]}%` : `${pcts[0]}%`)
    }
    const amounts = tiers.map(t => t.amount).filter((a): a is number => a != null)
    if (!amounts.length) return withSuffix('Promotion').trim()
    const lo = Math.min(...amounts)
    const hi = Math.max(...amounts)
    return withSuffix(lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`)
}

/** Empty applies_to means "every case type". */
export function appliesToCase(promo: BankPromotion, caseType?: CaseType): boolean {
    if (!caseType) return true
    const list = promo.applies_to ?? []
    return list.length === 0 || list.includes(caseType)
}

/** Bank names are typed by admins and extracted by an LLM, so compare loosely
 *  rather than trusting both sides to agree on spacing and case. */
const normalizeBank = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

export function matchesBank(promo: BankPromotion, bank?: string): boolean {
    if (!bank) return true
    return normalizeBank(promo.bank) === normalizeBank(bank)
}

/** Is this promotion allowed in front of the given audience? `client` viewers
 *  see only client-facing rows; agents see everything they're entitled to. */
export function visibleTo(promo: BankPromotion, viewer: 'client' | 'agent'): boolean {
    if (viewer === 'client') return promo.audience === 'client' || promo.audience === 'both'
    return true   // agents see everything, agent-only incentives included
}

export interface MatchCriteria {
    bank?: string
    caseType?: CaseType
    /** Omit when no case is in context (dashboard, rates browse) — the promotion
     *  then matches on bank/type alone and is labelled with its full range. */
    loanAmount?: number
    /** 'client' filters out agent-only incentives. Defaults to 'agent'. */
    viewer?: 'client' | 'agent'
    today?: string
    includeDrafts?: boolean
    /** Include promotions that haven't opened yet, flagged as upcoming. */
    includeUpcoming?: boolean
}

export interface MatchedPromotion {
    promo: BankPromotion
    /** The tier this loan falls in — null when no loan was supplied, or the
     *  promotion has no tiers at all. */
    tier: PromotionTier | null
    /** Dollar value for this case, when it can be determined. */
    benefitAmount: number | null
    label: string
    daysLeft: number | null
    endingSoon: boolean
    upcoming: boolean
}

/**
 * Every promotion that applies, best-known-urgency first.
 *
 * A promotion with tiers that exclude this loan is dropped rather than shown
 * greyed out: the agent is looking at a package card mid-conversation, and a
 * benefit the client cannot claim is noise at best and a misquote at worst.
 */
export function matchPromotions(promos: BankPromotion[], criteria: MatchCriteria = {}): MatchedPromotion[] {
    const today = criteria.today ?? todaySgt()
    const viewer = criteria.viewer ?? 'agent'

    const out: MatchedPromotion[] = []
    for (const promo of promos ?? []) {
        if (!criteria.includeDrafts && promo.status !== 'published') continue
        if (!visibleTo(promo, viewer)) continue
        if (!matchesBank(promo, criteria.bank)) continue
        if (!appliesToCase(promo, criteria.caseType)) continue

        const upcoming = isUpcoming(promo, today)
        if (upcoming && !criteria.includeUpcoming) continue
        if (!upcoming && !isActive(promo, today)) continue

        const hasTiers = (promo.benefit_tiers ?? []).length > 0
        let tier: PromotionTier | null = null
        if (hasTiers && criteria.loanAmount != null) {
            tier = resolveTier(promo, criteria.loanAmount)
            if (!tier) continue          // this loan doesn't qualify
        }

        out.push({
            promo,
            tier,
            benefitAmount: tier ? tierValue(tier, criteria.loanAmount) : null,
            label: formatBenefit(promo, criteria.loanAmount),
            daysLeft: daysRemaining(promo, today),
            endingSoon: endingSoon(promo, today),
            upcoming,
        })
    }

    // Soonest deadline first — the whole value of surfacing these is that they
    // expire. Open-ended promotions sort last; ties break on larger benefit.
    return out.sort((a, b) => {
        const ad = a.daysLeft ?? Number.MAX_SAFE_INTEGER
        const bd = b.daysLeft ?? Number.MAX_SAFE_INTEGER
        if (ad !== bd) return ad - bd
        return (b.benefitAmount ?? 0) - (a.benefitAmount ?? 0)
    })
}

/**
 * Freeze the promotions that applied when a package was picked, for storing in
 * workflow_data alongside selected_package_snapshot.
 *
 * Same reasoning as the package snapshot: a promotion is perishable by design,
 * so re-deriving it whenever a case is reopened would let an expired or
 * admin-edited promotion silently change a figure the client was already quoted.
 * The resolved dollar amount is stored, not just the promotion id.
 */
export function promoSnapshot(promos: MatchedPromotion[]): Record<string, unknown>[] {
    const frozen_at = new Date().toISOString()
    return promos.map(m => ({
        id: m.promo.id,
        bank: m.promo.bank,
        title: m.promo.title,
        audience: m.promo.audience,
        benefit_type: m.promo.benefit_type,
        label: m.label,
        benefit_amount: m.benefitAmount,
        window_basis: m.promo.window_basis,
        starts_on: m.promo.starts_on,
        ends_on: m.promo.ends_on,
        conditions: m.promo.conditions,
        clawback_years: m.promo.clawback_years,
        affects_ltv: m.promo.affects_ltv,
        frozen_at,
    }))
}

/** Convenience for the dashboard banner / rates strip: what's live right now. */
export function activePromotions(
    promos: BankPromotion[],
    opts: Omit<MatchCriteria, 'bank' | 'caseType' | 'loanAmount'> = {},
): MatchedPromotion[] {
    return matchPromotions(promos, opts)
}
