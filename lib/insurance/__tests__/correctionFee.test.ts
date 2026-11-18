import { describe, expect, it } from 'vitest'
import { caseCommission, commissionWithFee, commissionTotals } from '../commission'
import type { Case } from '@/lib/types'

describe('correction fee payout', () => {
    const closed = { id: 'case', stage: 'Closed Won', case_type: 'Refinancing', commission_status: 'unpaid', client_name: 'Client', closed_won_data: { original_loan_total: 1_000_000 }, correction_fee: 50 } as Case
    it('deducts $50 from agent share and preserves gross', () => {
        expect(caseCommission(closed)).toEqual({ gross: 1500, agent: 1300, tlc: 200, correctionFee: 50 })
    })
    it('shows unchanged commission for a waived fee', () => {
        expect(commissionWithFee(1_000_000, 0).agent).toBe(1350)
    })
    it('retains the correction in totals after payout and resubmission', () => {
        expect(commissionTotals([closed]).closedUnpaid).toBe(1300)
        expect(commissionTotals([{ ...closed, commission_status: 'paid' }]).closedPaid).toBe(1300)
        expect(caseCommission({ ...closed, correction_fee: 100 }).agent).toBe(1250)
    })
    it('does not hide a balance owed when the fee exceeds commission', () => {
        expect(commissionWithFee(1000, 50).agent).toBe(-48.65)
    })
})
