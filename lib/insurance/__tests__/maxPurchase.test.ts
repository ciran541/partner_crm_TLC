import { describe, it, expect } from 'vitest'
import { OPTION_MATRIX, maxPurchaseFromLoan } from '@/lib/insurance/purchaseCalc'
import { calculateBSD } from '@/lib/insurance/stampDuty'

const [o1, o2] = OPTION_MATRIX['0']

describe('maxPurchaseFromLoan (Affordability, reverse purchase)', () => {
    it('Option 1: loan ÷ 75% LTV, 5% cash + 20% cash/CPF', () => {
        const b = maxPurchaseFromLoan({ loan: 668_530, option: o1, propertyType: 'resale_condo', residency: 'singaporean', propertyCount: 1 })!
        expect(Math.round(b.price)).toBe(891_373)
        expect(b.minCash).toBeCloseTo(b.price * 0.05, 6)
        expect(b.cashCpf).toBeCloseTo(b.price * 0.20, 6)
        expect(b.minCash + b.cashCpf + b.loan).toBeCloseTo(b.price, 6)
        expect(b.bsd).toBe(calculateBSD(b.price))
        expect(b.absd).toBe(0)
        expect(b.totalUpfront).toBeCloseTo(b.minCash + b.cashCpf + b.bsd + b.legalFee + b.valuationFee, 6)
    })

    it('Option 2: loan ÷ 55% LTV, 10% cash + 35% cash/CPF', () => {
        const b = maxPurchaseFromLoan({ loan: 720_833, option: o2, propertyType: 'resale_condo', residency: 'singaporean', propertyCount: 1 })!
        expect(Math.round(b.price)).toBe(1_310_605)
        expect(b.minCash).toBeCloseTo(b.price * 0.10, 6)
        expect(b.cashCpf).toBeCloseTo(b.price * 0.35, 6)
    })

    it('applies ABSD by residency / property count', () => {
        const b = maxPurchaseFromLoan({ loan: 750_000, option: o1, propertyType: 'resale_condo', residency: 'pr', propertyCount: 1 })!
        expect(b.absdRatePct).toBeCloseTo(5, 6)
        expect(b.absd).toBeCloseTo(b.price * 0.05, 6)
    })

    it('returns null with no loan', () => {
        expect(maxPurchaseFromLoan({ loan: 0, option: o1, propertyType: 'resale_condo', residency: 'singaporean', propertyCount: 1 })).toBeNull()
    })
})
