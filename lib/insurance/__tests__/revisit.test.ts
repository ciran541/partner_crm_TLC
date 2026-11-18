import { describe, it, expect } from 'vitest'
import { revisitGate, buildRevisitCase, closingBank, yearsBetween } from '@/lib/insurance/revisit'
import { computeAmortization } from '@/lib/insurance/amortCalc'
import { commissionBucket } from '@/lib/insurance/commission'
import type { Case } from '@/lib/types'
import type { RateScheduleEntry } from '@/lib/types/rates'

const FIXED: RateScheduleEntry[] = [
    { year: 1, type: 'fixed', rate: 2 },
    { year: 2, type: 'fixed', rate: 2 },
    { thereafter: true, type: 'fixed', rate: 3 },
]

// Dexter: refinanced with us, closed 12 Dec 2025 on a 2-yr lock-in, follow-up 12 Dec 2027.
const dexter = (over: Partial<Case> = {}): Case => ({
    id: 'parent-1', created_at: '2025-11-01T00:00:00Z', updated_at: '2025-12-12T00:00:00Z', created_by: 'agent-1',
    stage: 'Closed Won', case_type: 'Refinancing',
    client_name: 'Dexter Tan', client_mobile: '91234567', client_email: 'dexter@x.com',
    property_type: 'HDB', property_address: 'Blk 1 Test Ave',
    current_bank: 'OCBC',                       // the OLD bank, before this refinance
    follow_up_date: '2027-12-12',
    referred_bankers: [{ bank: 'DBS', name: 'A Banker' }],
    closed_won_data: {
        loans: [{ kind: 'home', amount: 750_000, tenure: 25 }],
        package: { lockin_years: 2, schedule: FIXED },
        original_loan_total: 750_000,
        combined_outstanding: 700_000,
        bank: 'DBS',
        closed_at: '2025-12-12',
    },
    workflow_data: {
        property_type: 'hdb', year_of_purchase: 2015, selected_package_snapshot: { id: 'old' }, agent_notes: 'private',
        borrowers: [{ age: 40, basic_salary: 8000 }],
    },
    ...over,
} as Case)

describe('revisitGate — Revisit opens on the follow-up date, not before', () => {
    it('is locked before the follow-up date and says when it opens', () => {
        expect(revisitGate(dexter(), '2027-12-11')).toEqual({
            ok: false, reason: 'too_early', message: 'Revisit opens on the follow-up date.', unlocksOn: '2027-12-12',
        })
    })
    it('opens on the follow-up date and after', () => {
        expect(revisitGate(dexter(), '2027-12-12').ok).toBe(true)
        expect(revisitGate(dexter(), '2028-03-01').ok).toBe(true)
    })
    it('needs a follow-up date, a Closed Won case, and only once', () => {
        expect(revisitGate(dexter({ follow_up_date: undefined }), '2027-12-12')).toMatchObject({ reason: 'no_follow_up' })
        expect(revisitGate(dexter({ stage: 'Pending Docs' }), '2027-12-12')).toMatchObject({ reason: 'not_closed_won' })
        expect(revisitGate(dexter(), '2027-12-12', 'child-1')).toMatchObject({ reason: 'already_revisited' })
    })
})

describe('buildRevisitCase', () => {
    const { row, estimate } = buildRevisitCase(dexter(), '2027-12-12', null)
    const expectedBalance = Math.round(computeAmortization(750_000, 25, FIXED, null).find(r => r.year === 2)!.balance!)

    it('starts an ACTIVE Refinancing case — so it counts in potential revenue', () => {
        expect(row.case_type).toBe('Refinancing')
        expect(row.stage).toBe('Touched Base')
        expect(commissionBucket({ ...row, client_name: 'Dexter Tan' } as unknown as Case)).toBe('open')
    })

    it('uses the loan balance amortised on the closed package, the new bank and the lock-in end', () => {
        expect(row.existing_loan_amount).toBe(expectedBalance)
        expect(row.current_bank).toBe('DBS')              // not the old OCBC
        expect(row.lock_in_end_date).toBe('2027-12-12')
        expect(estimate).toMatchObject({ outstanding: expectedBalance, years: 2, bank: 'DBS' })
    })

    it('pre-fills the workflow and carries forward only what is still true', () => {
        expect(row.workflow_data).toMatchObject({
            current_bank: 'DBS', outstanding_disbursed: expectedBalance, lockin_end_date: '2027-12-12',
            current_tenure: 23, current_rate: 3, property_type: 'hdb', year_of_purchase: 2015,
            borrowers: [{ age: 42, basic_salary: 8000 }],   // two years older
        })
        // the old package choice and private notes don't leak into the new cycle
        expect(row.workflow_data).not.toHaveProperty('selected_package_snapshot')
        expect(row.workflow_data).not.toHaveProperty('agent_notes')
        expect(row.remarks).toBe('Revisit of the Refinancing case closed on 12 Dec 2025 with DBS ($750,000).')
    })

    it('splits home and equity loans', () => {
        const c = dexter({
            closed_won_data: { ...dexter().closed_won_data, loans: [{ kind: 'home', amount: 750_000, tenure: 25 }, { kind: 'equity', amount: 100_000, tenure: 10 }] },
        })
        const wf = buildRevisitCase(c, '2027-12-12', null).row.workflow_data
        expect(wf.outstanding_equity_loan).toBeGreaterThan(0)
        expect(wf.current_equity_loan_tenure).toBe(8)
    })

    it('falls back to the projection saved at closing when the package can\'t be priced (floating, no SORA)', () => {
        const c = dexter({ closed_won_data: { ...dexter().closed_won_data, package: { lockin_years: 2, schedule: [{ year: 1, type: 'floating', reference: '3M SORA', spread: 0.5 }] } } })
        expect(buildRevisitCase(c, '2027-12-12', null).row.existing_loan_amount).toBe(700_000)
    })

    it('handles older closures with no closing date or bank recorded', () => {
        const c = dexter({ closed_won_data: { ...dexter().closed_won_data, closed_at: undefined, bank: undefined } })
        const { row: r, estimate: e } = buildRevisitCase(c, '2027-12-12', null)
        expect(e.years).toBe(2)                       // lock-in length stands in for time elapsed
        expect(r.current_bank).toBe('DBS')            // the single referred banker's bank
        expect(r.lock_in_end_date).toBeNull()         // unknown — agent fills it in
    })
})

describe('helpers', () => {
    it('only trusts a referral bank when it is unambiguous', () => {
        expect(closingBank({ closed_won_data: {}, referred_bankers: [{ bank: 'DBS', name: 'a' }, { bank: 'UOB', name: 'b' }] })).toBeUndefined()
        expect(closingBank({ closed_won_data: {}, referred_bankers: [{ bank: 'DBS', name: 'a' }, { bank: 'DBS', name: 'b' }] })).toBe('DBS')
    })
    it('counts whole years', () => {
        expect(yearsBetween('2025-12-12', '2027-12-11')).toBe(1)
        expect(yearsBetween('2025-12-12', '2027-12-12')).toBe(2)
    })
})
