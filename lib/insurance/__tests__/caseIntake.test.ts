import { describe, it, expect } from 'vitest'
import {
    validateIntake, parseMoney, parseDate, normaliseMobile, mobileKey,
    intakeToCaseRow, workflowPrefill, type CaseIntake,
} from '@/lib/insurance/caseIntake'
import { commissionBucket } from '@/lib/insurance/commission'
import type { Case } from '@/lib/types'

const BANKS = ['DBS', 'OCBC', 'UOB', 'Standard Chartered']

describe('normalisers', () => {
    it('parses money in the forms agents type', () => {
        expect(parseMoney('$1,200,000')).toBe(1_200_000)
        expect(parseMoney('1.2m')).toBe(1_200_000)
        expect(parseMoney('800k')).toBe(800_000)
        expect(parseMoney(750000)).toBe(750_000)
        expect(parseMoney('')).toBeUndefined()
        expect(parseMoney('abc')).toBeNaN()
    })

    it('parses dates day-first (Singapore), ISO, Excel Dates and serials', () => {
        expect(parseDate('15/03/2027')).toBe('2027-03-15')
        expect(parseDate('5-1-27')).toBe('2027-01-05')
        expect(parseDate('2027-03-15')).toBe('2027-03-15')
        expect(parseDate(new Date(Date.UTC(2027, 2, 15)))).toBe('2027-03-15')
        expect(parseDate(46461)).toBe('2027-03-15')       // Excel serial
        expect(parseDate('31/02/2027')).toBeNull()         // no such day
        expect(parseDate('next week')).toBeNull()
        expect(parseDate('')).toBeUndefined()
    })

    it('treats +65 / spaced / bare Singapore mobiles as the same client', () => {
        expect(normaliseMobile('+65 9123 4567')).toBe('+6591234567')
        expect(normaliseMobile('9123-4567')).toBe('91234567')
        expect(mobileKey('+65 9123 4567')).toBe(mobileKey('91234567'))
        expect(mobileKey('6591234567')).toBe('91234567')
    })
})

describe('validateIntake', () => {
    it('needs a name and a mobile, defaults to Refinancing + Inactive', () => {
        const r = validateIntake({ client_name: 'Tan', client_mobile: '91234567' }, BANKS)
        expect(r.ok).toBe(true)
        if (r.ok) {
            expect(r.value.case_type).toBe('Refinancing')
            expect(r.value.stage).toBe('Inactive')
        }
        const bad = validateIntake({ client_name: '', client_mobile: '' }, BANKS)
        expect(bad.ok).toBe(false)
        if (!bad.ok) expect(bad.errors).toEqual(['Client name is required', 'Mobile is required'])
    })

    it('maps friendly labels: "Decoupling", "active", bank spelling', () => {
        const r = validateIntake({ client_name: 'A', client_mobile: '91234567', case_type: 'decoupling', stage: 'Active', current_bank: 'standard  chartered' }, BANKS)
        expect(r.ok && r.value.case_type).toBe('Decouple')
        expect(r.ok && r.value.stage).toBe('Touched Base')
        expect(r.ok && r.value.current_bank).toBe('Standard Chartered')
    })

    it('keeps an unlisted bank as typed (the client may bank elsewhere)', () => {
        const r = validateIntake({ client_name: 'A', client_mobile: '91234567', current_bank: 'Bank of China' }, BANKS)
        expect(r.ok && r.value.current_bank).toBe('Bank of China')
    })

    it('never allows a case to be created as Closed Won — that is what pays out', () => {
        const r = validateIntake({ client_name: 'A', client_mobile: '91234567', stage: 'Closed Won' }, BANKS)
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.errors[0]).toMatch(/close a case from its page/)
    })

    it('reports every problem in a row at once', () => {
        const r = validateIntake({ client_name: 'A', client_mobile: '12', client_email: 'x@', loan_amount: 'lots', follow_up_date: '2027/99/99', property_type: 'Castle' }, BANKS)
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.errors).toHaveLength(5)
    })
})

describe('row mapping', () => {
    const base: CaseIntake = { client_name: 'A', client_mobile: '91234567', case_type: 'Refinancing', stage: 'Inactive', loan_amount: 750_000, current_bank: 'DBS', remaining_tenure: 22, lock_in_end_date: '2027-03-15', property_type: 'HDB', subsidy: 2000 }

    it('puts the loan where commission reads it for the case type', () => {
        expect(intakeToCaseRow(base, 'u').existing_loan_amount).toBe(750_000)
        expect(intakeToCaseRow(base, 'u').loan_size).toBeNull()
        const purchase = intakeToCaseRow({ ...base, case_type: 'Purchase' }, 'u')
        expect(purchase.loan_size).toBe(750_000)
        expect(purchase.existing_loan_amount).toBeNull()
    })

    it('pre-fills the workflow so nothing is typed twice', () => {
        expect(workflowPrefill(base)).toEqual({
            current_bank: 'DBS', outstanding_disbursed: 750_000, lockin_end_date: '2027-03-15', current_tenure: 22, property_type: 'hdb',
        })
        // Ambiguous "Private Condo" is left for the agent to pick in the workflow
        expect(workflowPrefill({ ...base, property_type: 'Private Condo' }).property_type).toBeUndefined()
        expect(intakeToCaseRow(base, 'u').subsidy_provided).toBe('$2,000')
    })
})

describe('Inactive stage', () => {
    it('has no commission bucket — not potential revenue', () => {
        expect(commissionBucket({ stage: 'Inactive', client_name: 'A' } as Case)).toBeNull()
        expect(commissionBucket({ stage: 'Touched Base', client_name: 'A' } as Case)).toBe('open')
    })
})

describe('lead source', () => {
    const base = { client_name: 'A', client_mobile: '91234567' }
    it('New Case requires one; mass upload may leave it blank', () => {
        expect(validateIntake(base, [], { requireLeadSource: true }).ok).toBe(false)
        const r = validateIntake(base, [])
        expect(r.ok && r.value.lead_source).toBeUndefined()
    })
    it('maps what agents type', () => {
        const pick = (v: string) => { const r = validateIntake({ ...base, lead_source: v }, []); return r.ok ? r.value.lead_source : 'ERR' }
        expect(pick('Facebook')).toBe('social_media')
        expect(pick('property agent')).toBe('professional_referral')
        expect(pick('Existing Client')).toBe('existing_client')
        expect(pick('google')).toBe('website_search')
    })
    it('keeps an unknown upload value as Others + detail instead of failing the row', () => {
        const r = validateIntake({ ...base, lead_source: 'Nov Roadshow promo XYZ' }, [])
        expect(r.ok).toBe(true)
        // "roadshow" is recognised as an event
        expect(r.ok && r.value.lead_source).toBe('networking_events')
        const u = validateIntake({ ...base, lead_source: 'Campaign 42' }, [])
        expect(u.ok && u.value.lead_source).toBe('others')
        expect(u.ok && u.value.lead_source_other).toBe('Campaign 42')
    })
})
