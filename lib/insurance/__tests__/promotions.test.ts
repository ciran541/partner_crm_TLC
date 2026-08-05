/**
 * Tests for bank promotion matching.
 *
 * A promotion is money an agent tells a client they will receive, so the two
 * things pinned hardest here are the tier boundary (bank wording is ambiguous
 * at the edges) and the client/agent audience split (an agent's referral fee
 * must never be reachable from a client-facing filter).
 *
 * Fixtures are the real SCB National Day blast that prompted the feature, so
 * the boundary cases are the actual ones rather than invented round numbers.
 */

import { describe, it, expect } from 'vitest'
import {
    todaySgt,
    isActive,
    isUpcoming,
    daysRemaining,
    endingSoon,
    resolveTier,
    tierValue,
    formatBenefit,
    appliesToCase,
    matchesBank,
    visibleTo,
    matchPromotions,
} from '@/lib/insurance/promotions'
import { normalize } from '@/lib/insurance/extractPromotion'
import type { BankPromotion } from '@/lib/types/promotions'

const base: BankPromotion = {
    id: 'p0',
    bank: 'Standard Chartered',
    title: 'Promo',
    audience: 'client',
    benefit_type: 'cash_rebate',
    benefit_tiers: [],
    applies_to: [],
    window_basis: 'submission',
    starts_on: null,
    ends_on: null,
    conditions: [],
    clawback_years: null,
    affects_ltv: false,
    source_text: null,
    notes: null,
    status: 'published',
}

const promo = (over: Partial<BankPromotion>): BankPromotion => ({ ...base, ...over })

/** SCB National Day cash rebate — client-facing, tiered, 3–16 Aug. */
const rebate = promo({
    id: 'rebate',
    title: 'National Day Cash Rebate',
    benefit_tiers: [
        { min_loan: 1_000_000, max_loan: 1_500_000, amount: 800 },
        { min_loan: 1_500_000, max_loan: null, amount: 1_200 },
    ],
    applies_to: ['Purchase', 'Refinancing'],
    starts_on: '2026-08-03',
    ends_on: '2026-08-16',
    conditions: ['No resubmission of loan over last 1 month', 'Credited within 1 week of disbursement'],
    clawback_years: 3,
    affects_ltv: true,
})

/** The agent-only half of the same message — 0.2% referral, extended to 31 Aug. */
const referral = promo({
    id: 'referral',
    title: '0.2% Agent Referral Extension',
    audience: 'agent',
    benefit_type: 'referral_bonus',
    benefit_tiers: [{ min_loan: 0, max_loan: null, percent: 0.2 }],
    ends_on: '2026-08-31',
})

// ── Date handling ─────────────────────────────────────────────────────────────

describe('todaySgt', () => {
    it('reports the Singapore date, not the UTC one', () => {
        // 16 Aug 17:00 UTC is already 17 Aug 01:00 in Singapore. Plain
        // toISOString() would say the 16th and keep a closed promo alive.
        const t = new Date('2026-08-16T17:00:00Z')
        expect(t.toISOString().slice(0, 10)).toBe('2026-08-16')
        expect(todaySgt(t)).toBe('2026-08-17')
    })

    it('agrees with UTC during Singapore working hours', () => {
        // 09:00 SGT on the 17th = 01:00 UTC on the 17th.
        expect(todaySgt(new Date('2026-08-17T01:00:00Z'))).toBe('2026-08-17')
    })
})

describe('isActive', () => {
    it.each([
        ['2026-08-02', false, 'day before opening'],
        ['2026-08-03', true, 'opening day is inclusive'],
        ['2026-08-10', true, 'mid-window'],
        ['2026-08-16', true, 'closing day is inclusive'],
        ['2026-08-17', false, 'day after closing'],
    ])('%s → %s (%s)', (today, expected) => {
        expect(isActive(rebate, today as string)).toBe(expected)
    })

    it('treats a promotion with no dates as always open', () => {
        expect(isActive(promo({}), '2030-01-01')).toBe(true)
    })
})

describe('daysRemaining / endingSoon / isUpcoming', () => {
    it('counts whole days to the closing date', () => {
        expect(daysRemaining(rebate, '2026-08-10')).toBe(6)
        expect(daysRemaining(rebate, '2026-08-16')).toBe(0)
        expect(daysRemaining(rebate, '2026-08-20')).toBe(-4)
    })

    it('returns null for an open-ended promotion', () => {
        expect(daysRemaining(promo({}), '2026-08-10')).toBeNull()
    })

    it('flags the last three days but not an expired promotion', () => {
        expect(endingSoon(rebate, '2026-08-10')).toBe(false)
        expect(endingSoon(rebate, '2026-08-14')).toBe(true)
        expect(endingSoon(rebate, '2026-08-16')).toBe(true)
        expect(endingSoon(rebate, '2026-08-17')).toBe(false)
    })

    it('recognises an announced-but-not-yet-open promotion', () => {
        expect(isUpcoming(rebate, '2026-08-01')).toBe(true)
        expect(isUpcoming(rebate, '2026-08-05')).toBe(false)
    })
})

// ── Tier resolution ───────────────────────────────────────────────────────────

describe('resolveTier', () => {
    it.each([
        [999_999, null],
        [1_000_000, 800],       // min is inclusive
        [1_200_000, 800],
        [1_499_999, 800],
        [1_500_000, 800],       // contested boundary — first matching tier wins
        [1_500_001, 1_200],
        [5_000_000, 1_200],     // open-ended top tier
    ])('loan %s resolves to %s', (loan, expected) => {
        const tier = resolveTier(rebate, loan as number)
        expect(tier ? tier.amount : null).toBe(expected)
    })

    it('returns null when the promotion has no tiers', () => {
        expect(resolveTier(promo({}), 1_000_000)).toBeNull()
    })
})

describe('tierValue', () => {
    it('returns a flat amount as-is', () => {
        expect(tierValue({ min_loan: 0, max_loan: null, amount: 800 })).toBe(800)
    })

    it('reads percent as percentage points against the loan', () => {
        expect(tierValue({ min_loan: 0, max_loan: null, percent: 0.2 }, 1_800_000)).toBe(3_600)
    })

    it('cannot value a percentage tier without a loan amount', () => {
        expect(tierValue({ min_loan: 0, max_loan: null, percent: 0.2 })).toBeNull()
    })
})

// ── Labels ────────────────────────────────────────────────────────────────────

describe('formatBenefit', () => {
    it('is exact when a loan amount is known', () => {
        expect(formatBenefit(rebate, 1_200_000)).toBe('$800 cash rebate')
        expect(formatBenefit(rebate, 1_800_000)).toBe('$1,200 cash rebate')
    })

    it('spans the tiers when no case is in context', () => {
        expect(formatBenefit(rebate)).toBe('$800–$1,200 cash rebate')
    })

    it('says so plainly when the loan is below every tier', () => {
        expect(formatBenefit(rebate, 500_000)).toBe('Not eligible at this loan size')
    })

    it('shows a percentage benefit with its cash equivalent', () => {
        expect(formatBenefit(referral, 1_800_000)).toBe('0.2% ($3,600) referral')
        expect(formatBenefit(referral)).toBe('0.2% referral')
    })
})

// ── Filters ───────────────────────────────────────────────────────────────────

describe('appliesToCase', () => {
    it('matches a listed case type', () => {
        expect(appliesToCase(rebate, 'Refinancing')).toBe(true)
        expect(appliesToCase(rebate, 'Decouple')).toBe(false)
    })

    it('treats an empty list as every case type', () => {
        expect(appliesToCase(referral, 'Decouple')).toBe(true)
    })
})

describe('matchesBank', () => {
    it('ignores case and spacing differences', () => {
        expect(matchesBank(rebate, 'standard chartered')).toBe(true)
        expect(matchesBank(rebate, '  Standard   Chartered ')).toBe(true)
        expect(matchesBank(rebate, 'DBS')).toBe(false)
    })
})

describe('visibleTo', () => {
    it('hides agent-only incentives from client-facing output', () => {
        expect(visibleTo(referral, 'client')).toBe(false)
        expect(visibleTo(referral, 'agent')).toBe(true)
    })

    it('shows client rebates to both', () => {
        expect(visibleTo(rebate, 'client')).toBe(true)
        expect(visibleTo(rebate, 'agent')).toBe(true)
    })

    it('shows a dual-audience promotion to clients', () => {
        expect(visibleTo(promo({ audience: 'both' }), 'client')).toBe(true)
    })
})

// ── matchPromotions ───────────────────────────────────────────────────────────

describe('matchPromotions', () => {
    const all = [rebate, referral]
    const today = '2026-08-10'

    it('returns both halves of the bank message to an agent', () => {
        const out = matchPromotions(all, { bank: 'Standard Chartered', today })
        expect(out.map(m => m.promo.id)).toEqual(['rebate', 'referral'])
    })

    it('never leaks the agent referral into a client-facing filter', () => {
        const out = matchPromotions(all, { viewer: 'client', today })
        expect(out.map(m => m.promo.id)).toEqual(['rebate'])
    })

    it('drops a promotion whose tiers exclude this loan', () => {
        // $800k is under SCB's $1m floor — the client cannot claim it, so the
        // package card must not be badged with it.
        const out = matchPromotions([rebate], { loanAmount: 800_000, today })
        expect(out).toEqual([])
    })

    it('resolves the tier against the case loan', () => {
        const out = matchPromotions([rebate], { loanAmount: 1_800_000, today })
        expect(out[0].benefitAmount).toBe(1_200)
        expect(out[0].label).toBe('$1,200 cash rebate')
    })

    it('matches on bank alone when no loan is in context', () => {
        const out = matchPromotions([rebate], { today })
        expect(out[0].tier).toBeNull()
        expect(out[0].label).toBe('$800–$1,200 cash rebate')
    })

    it('excludes drafts unless asked', () => {
        const draft = promo({ id: 'draft', status: 'draft' })
        expect(matchPromotions([draft], { today })).toEqual([])
        expect(matchPromotions([draft], { today, includeDrafts: true })).toHaveLength(1)
    })

    it('excludes an expired promotion', () => {
        expect(matchPromotions(all, { today: '2026-09-01' })).toEqual([])
    })

    it('excludes an upcoming promotion unless asked', () => {
        const early = '2026-08-01'
        expect(matchPromotions([rebate], { today: early })).toEqual([])
        const out = matchPromotions([rebate], { today: early, includeUpcoming: true })
        expect(out[0].upcoming).toBe(true)
    })

    it('filters by case type', () => {
        const out = matchPromotions(all, { caseType: 'Decouple', today })
        expect(out.map(m => m.promo.id)).toEqual(['referral'])
    })

    it('sorts the soonest deadline first', () => {
        const later = promo({ id: 'later', ends_on: '2026-12-31' })
        const openEnded = promo({ id: 'open' })
        const out = matchPromotions([openEnded, later, rebate], { today })
        expect(out.map(m => m.promo.id)).toEqual(['rebate', 'later', 'open'])
    })

    it('carries the urgency flag through', () => {
        const out = matchPromotions([rebate], { today: '2026-08-15' })
        expect(out[0].daysLeft).toBe(1)
        expect(out[0].endingSoon).toBe(true)
    })
})

// ── Extractor normalisation ───────────────────────────────────────────────────
// DeepSeek's JSON mode guarantees only that the response parses, so normalize()
// re-derives every field. These pin what happens when the model gets it wrong.

describe('extractPromotion normalize', () => {
    it('keeps a client rebate and an agent referral as separate rows', () => {
        const out = normalize([
            {
                title: 'National Day Cash Rebate',
                audience: 'client',
                benefit_type: 'cash_rebate',
                benefit_tiers: [
                    { min_loan: 1000000, max_loan: 1500000, amount: 800 },
                    { min_loan: 1500000, max_loan: null, amount: 1200 },
                ],
                applies_to: ['Purchase', 'Refinancing'],
                window_basis: 'submission',
                starts_on: '2026-08-03',
                ends_on: '2026-08-16',
                conditions: ['All cash rebate subjected to 3 years clawback'],
                clawback_years: 3,
                affects_ltv: true,
            },
            {
                title: '0.2% Agent Referral Extension',
                audience: 'agent',
                benefit_type: 'referral_bonus',
                benefit_tiers: [{ min_loan: 0, max_loan: null, percent: 0.2 }],
                applies_to: [],
                ends_on: '2026-08-31',
            },
        ], 'Standard Chartered')

        expect(out).toHaveLength(2)
        expect(out[0].audience).toBe('client')
        expect(out[0].affects_ltv).toBe(true)
        expect(out[0].clawback_years).toBe(3)
        expect(out[1].audience).toBe('agent')
        expect(out[1].benefit_tiers[0].percent).toBe(0.2)
        expect(out.every(p => p.bank === 'Standard Chartered')).toBe(true)
    })

    it('parses shorthand loan-size tokens the model may echo back', () => {
        const out = normalize([{
            title: 'T', benefit_tiers: [{ min_loan: '1m', max_loan: '$1,500,000', amount: '800' }],
        }], 'SCB')
        expect(out[0].benefit_tiers[0]).toEqual({ min_loan: 1_000_000, max_loan: 1_500_000, amount: 800 })
    })

    it('sorts tiers ascending so the boundary rule stays predictable', () => {
        const out = normalize([{
            title: 'T',
            benefit_tiers: [
                { min_loan: 1500000, max_loan: null, amount: 1200 },
                { min_loan: 1000000, max_loan: 1500000, amount: 800 },
            ],
        }], 'SCB')
        expect(out[0].benefit_tiers.map(t => t.min_loan)).toEqual([1_000_000, 1_500_000])
    })

    it('defaults an unrecognised audience to agent-only', () => {
        // Failing toward "internal" keeps a mislabelled row out of client output.
        const out = normalize([{ title: 'T', audience: 'everyone', benefit_tiers: [{ min_loan: 0, max_loan: null, amount: 500 }] }], 'SCB')
        expect(out[0].audience).toBe('agent')
    })

    it('drops case types outside the known set', () => {
        const out = normalize([{ title: 'T', applies_to: ['Purchase', 'Renovation Loan'], benefit_tiers: [{ min_loan: 0, max_loan: null, amount: 1 }] }], 'SCB')
        expect(out[0].applies_to).toEqual(['Purchase'])
    })

    it('nulls a malformed date rather than guessing one', () => {
        const out = normalize([{ title: 'T', starts_on: '3 August', ends_on: '2026-08-16', benefit_tiers: [{ min_loan: 0, max_loan: null, amount: 1 }] }], 'SCB')
        expect(out[0].starts_on).toBeNull()
        expect(out[0].ends_on).toBe('2026-08-16')
    })

    it('drops a tier carrying no benefit', () => {
        const out = normalize([{ title: 'T', benefit_tiers: [{ min_loan: 0, max_loan: null }, { min_loan: 0, max_loan: null, amount: 800 }] }], 'SCB')
        expect(out[0].benefit_tiers).toHaveLength(1)
    })

    it('clears an inverted band instead of leaving an unmatchable tier', () => {
        const out = normalize([{ title: 'T', benefit_tiers: [{ min_loan: 1500000, max_loan: 1000000, amount: 800 }] }], 'SCB')
        expect(out[0].benefit_tiers[0].max_loan).toBeNull()
    })

    it('drops a shell row with no title and no benefit', () => {
        expect(normalize([{ conditions: [] }], 'SCB')).toEqual([])
    })

    it('survives junk in place of an array', () => {
        expect(normalize(null, 'SCB')).toEqual([])
        expect(normalize(['nonsense', 42], 'SCB')).toEqual([])
    })
})
