import { expect, it } from 'vitest'
import { propertyAnalytics, type PropertyAnalyticsCase } from '../adminAnalytics'

const c = (p: Partial<PropertyAnalyticsCase>): PropertyAnalyticsCase => ({
    id: '1', status: 'submitted', case_type: 'refinance', agent_id: 'a', created_at: '2026-11-01T00:00:00Z', is_duplicate: false,
    gross_commission_amount: 1000, agent_commission_amount: 900, tlc_commission_amount: 100, commission_status: 'pending', follow_up_date: null, followup_completed_at: null, ...p,
})

it('leaves drafts and duplicates out of every figure', () => {
    const r = propertyAnalytics([c({}), c({ status: 'draft' }), c({ is_duplicate: true })], { a: 'A' }, '2026-11-23')
    expect(r.totalCases).toBe(1)
    expect(r.totalAgentCommission).toBe(900)
    expect(r.commissionByPaymentStatus.pending).toBe(900)
})
it('counts only unfinished cases as active', () => {
    const r = propertyAnalytics([c({}), c({ status: 'opportunity_due' }), c({ status: 'paid' }), c({ status: 'rejected' })], {}, '2026-11-23')
    expect(r.activeCases).toBe(2)
})
it('today is not overdue, and months are Singapore months', () => {
    const r = propertyAnalytics([c({ follow_up_date: '2026-11-23', created_at: '2026-10-31T17:00:00Z' }), c({ follow_up_date: '2026-11-22' })], {}, '2026-11-23')
    expect(r.followUps.overdue).toBe(1)
    expect(r.monthlyVolume.at(-1)).toEqual({ month: '2026-11', count: 2 })
    expect(r.monthlyVolume).toHaveLength(6)
})
