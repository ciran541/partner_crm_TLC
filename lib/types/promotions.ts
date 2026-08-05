// Time-boxed bank promotions — the campaigns banks blast to partners
// ("National Day cash rebate, submit 3–16 Aug, $800 / $1,200 by loan size").
//
// Stored structured rather than as free text so a tier can be resolved against a
// case's actual loan amount at Step 4, the same reasoning behind rate_schedule
// in ./rates.ts.

import type { CaseType } from './insurance'

/** Who may see a promotion. Agent rows are internal-only — a referral-fee bump
 *  must never surface in a client-facing proposal. */
export const PROMO_AUDIENCES = ['client', 'agent', 'both'] as const
export type PromotionAudience = (typeof PROMO_AUDIENCES)[number]

export const BENEFIT_TYPES = ['cash_rebate', 'referral_bonus', 'fee_waiver', 'rate_discount', 'other'] as const
export type BenefitType = (typeof BENEFIT_TYPES)[number]

/** Which date the eligibility window is measured against. Banks mean different
 *  things by the same date range, and the difference is what an agent acts on. */
export const WINDOW_BASES = ['submission', 'disbursement', 'acceptance'] as const
export type WindowBasis = (typeof WINDOW_BASES)[number]

export const WINDOW_BASIS_LABELS: Record<WindowBasis, string> = {
    submission:   'Submit by',
    disbursement: 'Disburse by',
    acceptance:   'Accept by',
}

/**
 * One loan-size band of a promotion's benefit.
 *
 * Boundaries are min-INCLUSIVE and max-INCLUSIVE. Bank messages are habitually
 * ambiguous here — "1m to 1.5m … above 1.5m" leaves a loan of exactly $1.5m
 * claimed by both bands in plain reading. resolveTier() walks tiers in order and
 * takes the first match, so an earlier tier wins a contested boundary and a loan
 * can never resolve to two benefits.
 */
export interface PromotionTier {
    min_loan: number
    max_loan: number | null       // null = open-ended top tier
    amount?: number               // flat cash, e.g. 800
    percent?: number              // % of loan, e.g. 0.2 for a referral bonus
}

export interface BankPromotion {
    id: string
    bank: string
    title: string
    audience: PromotionAudience
    benefit_type: BenefitType
    benefit_tiers: PromotionTier[]
    applies_to: CaseType[]        // empty = every case type
    window_basis: WindowBasis
    starts_on: string | null      // YYYY-MM-DD
    ends_on: string | null        // null = open-ended
    conditions: string[]
    clawback_years: number | null
    affects_ltv: boolean
    source_text: string | null
    notes: string | null
    status: 'published' | 'draft'
    created_at?: string
    updated_at?: string
}

export type BankPromotionInput = Omit<BankPromotion, 'id' | 'created_at' | 'updated_at'>

/** What the extractor produces per detected promo, before an admin reviews it.
 *  Same shape as the input minus the fields only an admin sets. */
export type ExtractedPromotion = Omit<BankPromotionInput, 'status' | 'source_text' | 'notes'>
