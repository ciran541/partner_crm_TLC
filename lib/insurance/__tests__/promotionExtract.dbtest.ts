/**
 * Live extraction check — runs the REAL SCB partner blast through DeepSeek and
 * asserts the structured result, rather than trusting the prompt to work.
 *
 * This message is the canonical hard case: one blast carrying a client cash
 * rebate AND an agent referral fee, with different end dates, an ambiguous tier
 * boundary, and an LTV note. If the prompt ever regresses on the audience split,
 * this catches it.
 *
 * Costs one DeepSeek call. Named `.dbtest.ts` so `npm test` never collects it —
 * that run stays pure and offline.
 *
 *   npm run test:db
 *
 * Needs DEEPSEEK_API_KEY, read from .env.local.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { extractPromotions } from '@/lib/insurance/extractPromotion'
import { matchPromotions } from '@/lib/insurance/promotions'
import type { BankPromotion, ExtractedPromotion } from '@/lib/types/promotions'

function loadEnv() {
    try {
        const raw = readFileSync(new URL('../../../.env.local', import.meta.url), 'utf8')
        for (const line of raw.split('\n')) {
            const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
            if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
        }
    } catch { /* fall back to the real environment */ }
}
loadEnv()

const SCB_BLAST = `Dear Partners, SCB National Day Promotion Cash Rebate For Client (3 to 16 August) & Extension Of 0.2% Referral

Loan Size $1m to $1.5m
Cash Rebate $800

Loan size above $1.5m
Cash Rebate $1200

Conditions:
*Only applicable for loan submit 3 Aug or after to 16 Aug
*No resubmission of loan over last 1 month if not no referral fee payable
*Strictly for loan submitted from 3 Aug. no deviation from this
*Cash rebate to be credited within 1 week of loan disbursement to client SCB account
*Applicable for both purchase and refinancing (on top of normal subsidy)
*Rebate will be nett off purchase price for LTV computation
*All cash rebate subjected to 3 years clawback

0.2% agent referral will be extended to 31 August

Happy selling!`

describe('extractPromotions — live SCB blast', () => {
    let result: ExtractedPromotion[] | null

    beforeAll(async () => {
        expect(process.env.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY missing from .env.local').toBeTruthy()
        result = await extractPromotions(SCB_BLAST, 'Standard Chartered')
        console.log(JSON.stringify(result, null, 2))
    }, 90_000)

    it('splits the message into a client rebate and an agent referral', () => {
        expect(result).not.toBeNull()
        expect(result!.length).toBe(2)
        const audiences = result!.map(p => p.audience).sort()
        expect(audiences).toEqual(['agent', 'client'])
    })

    it('reads the cash rebate tiers correctly', () => {
        const rebate = result!.find(p => p.audience === 'client')!
        expect(rebate.benefit_type).toBe('cash_rebate')
        expect(rebate.benefit_tiers).toHaveLength(2)
        expect(rebate.benefit_tiers[0]).toMatchObject({ min_loan: 1_000_000, max_loan: 1_500_000, amount: 800 })
        expect(rebate.benefit_tiers[1]).toMatchObject({ min_loan: 1_500_000, max_loan: null, amount: 1_200 })
    })

    it('reads the submission window and its basis', () => {
        const rebate = result!.find(p => p.audience === 'client')!
        expect(rebate.window_basis).toBe('submission')
        expect(rebate.starts_on).toMatch(/-08-03$/)
        expect(rebate.ends_on).toMatch(/-08-16$/)
    })

    it('picks up clawback, LTV treatment and case types', () => {
        const rebate = result!.find(p => p.audience === 'client')!
        expect(rebate.clawback_years).toBe(3)
        expect(rebate.affects_ltv).toBe(true)
        expect(rebate.applies_to.sort()).toEqual(['Purchase', 'Refinancing'])
        expect(rebate.conditions.length).toBeGreaterThanOrEqual(3)
    })

    it('gives the agent referral its own later end date', () => {
        const referral = result!.find(p => p.audience === 'agent')!
        expect(referral.benefit_type).toBe('referral_bonus')
        expect(referral.ends_on).toMatch(/-08-31$/)
        expect(referral.benefit_tiers[0].percent).toBe(0.2)
    })

    it('resolves to the right money end-to-end through the matcher', () => {
        const rows = result!.map((p, i) => ({ ...p, id: `x${i}`, status: 'published', source_text: null, notes: null })) as BankPromotion[]
        const today = rows.find(r => r.audience === 'client')!.starts_on!

        // A client-facing view of a $1.8m refinance: the $1,200 tier, and
        // absolutely no sign of the agent's referral fee.
        const client = matchPromotions(rows, { viewer: 'client', caseType: 'Refinancing', loanAmount: 1_800_000, today })
        expect(client).toHaveLength(1)
        expect(client[0].benefitAmount).toBe(1_200)

        // The same case seen by the agent shows both.
        const agent = matchPromotions(rows, { viewer: 'agent', caseType: 'Refinancing', loanAmount: 1_800_000, today })
        expect(agent).toHaveLength(2)
    })
})
