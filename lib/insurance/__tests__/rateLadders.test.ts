import { describe, expect, it } from 'vitest'
import type { MortgagePackage, RateScheduleEntry } from '@/lib/types/rates'
import { buildLadders, conversionMonths, namedFixedYears } from '../rateLadders'
import { applyLoanSizeFilter, parsePriorityMin, restrictedTo } from '../rateFilters'

let n = 0
const fixed = (rate: number, years: number): RateScheduleEntry[] => [
    ...Array.from({ length: years }, (_, i) => ({ year: i + 1, type: 'fixed' as const, rate })),
    { thereafter: true, type: 'floating', reference: '3M SORA', spread: 1 },
]
const conv = (m: number) => [`One free conversion after ${m} months`]
const pkg = (o: Partial<MortgagePackage>): MortgagePackage => ({
    id: String(++n), bank: 'B', property_type: 'HDB / Private', category: 'Fixed', min_loan_size: 500000,
    package_name: 'B Fixed Rates 3 Years Lock-In', lockin_years: 3, rate_schedule: fixed(1.9, 3), first_year_rate: 1.9,
    features: conv(12), subsidies: null, remarks: null, min_loan_note: null,
    status: 'published', last_updated: '2026-11-20', ...o,
})
const build = (...ps: MortgagePackage[]) => buildLadders(ps, '2026-11-25')
const texts = (ls: ReturnType<typeof build>) => ls.flatMap(l => l.issues.filter(i => i.level === 'check').map(i => i.text))

describe('rate ladders', () => {
    it('splits two products sharing a step (DBS 3Y: 12 vs 36 months)', () => {
        const top = { min_loan_size: 1e6, rate_schedule: fixed(1.8, 3) }
        const ls = build(pkg({}), pkg(top), pkg({ features: conv(36) }), pkg({ ...top, features: conv(36) }))
        expect(ls).toHaveLength(2)
        expect(texts(ls)).toEqual([])
    })
    it('keeps one ladder when only the top step converts earlier (SCB)', () => {
        const ls = build(pkg({ features: conv(24) }), pkg({ min_loan_size: 1.2e6 }))
        expect(ls).toHaveLength(1)
        expect(ls[0].sharedFeatures).toEqual([])
    })
    it('flags a smaller loan that is cheaper, only within one ladder and buyer type', () => {
        const cheap = { rate_schedule: fixed(1.5, 3) }
        expect(texts(build(pkg(cheap), pkg({ min_loan_size: 1e6 })))).toEqual(['500k (1.5) is cheaper than 1m (1.9)'])
        expect(texts(build(pkg(cheap), pkg({ min_loan_size: 1e6, package_name: 'B 3 Years Fixed Flex' })))).toEqual([])
        expect(texts(build(pkg({ ...cheap, min_loan_note: 'Premier' }), pkg({ min_loan_size: 1e6 })))).toEqual([])
    })
    it('keeps a 3Y package with a lost year in the 3Y ladder and flags it (OCBC)', () => {
        const ls = build(
            pkg({ package_name: 'B 3Y Fixed', rate_schedule: fixed(2.55, 2) }),
            pkg({ package_name: 'B 3Y Fixed', min_loan_size: 1e6 }))
        expect(ls).toHaveLength(1)
        expect(texts(ls)).toContain('500k: the name says 3Y fixed, but fixed years saved = 2')
    })
    it('treats HDB and Private steps separately, but HDB / Private overlaps both', () => {
        expect(texts(build(pkg({ property_type: 'HDB' }), pkg({ property_type: 'Private' })))).toEqual([])
        expect(texts(build(pkg({ property_type: 'HDB' }), pkg({})))).toEqual(['500k: two packages on the same step'])
    })
    it('flags a benchmark change and old rates', () => {
        const ls = build(pkg({
            category: 'BUC', last_updated: '2026-06-12',
            rate_schedule: [
                { year: 1, type: 'floating', reference: '1M SORA', spread: 0.3 },
                { thereafter: true, type: 'floating', reference: '3M SORA', spread: 1 },
            ],
        }))
        expect(texts(ls)[0]).toContain('benchmark changes')
        expect(ls[0].issues.some(i => i.text.includes('166 days'))).toBe(true)
    })
    it('reads names, conversions and restrictions', () => {
        expect(namedFixedYears('OCBC 3Y Fixed Rates - 3 Years Lock-In')).toBe(3)
        expect(namedFixedYears('HSBC - 1 Years Fixed Rates - 2 Years Lock-in')).toBe(1)
        expect(namedFixedYears('DBS - Fixed Rates 2 Years Lock-In')).toBeNull()
        expect(conversionMonths({ features: ['One time free conversion after lock in'], lockin_years: 2 })).toBe(24)
        expect(conversionMonths({ features: ['One free conversion anytime'], lockin_years: 2 })).toBe(0)
        expect(restrictedTo({ min_loan_note: 'Priority Banking: min $300K' })).toBeNull()
        expect(restrictedTo({ min_loan_note: 'CITIGOLD (AUM>=$250,000)' })).not.toBeNull()
        expect(restrictedTo({ min_loan_note: 'Premier', restricted_to: null })).toBeNull()
        expect(parsePriorityMin('Priority with $350k AUM')).toBeNull()
    })
    it('uses an admin product name instead of the automatic grouping', () => {
        expect(build(pkg({}), pkg({ min_loan_size: 200000, product: '3Y Special' })).map(l => l.label)).toEqual(['3Y Fixed', '3Y Special'])
    })
})

describe('who can take a package', () => {
    const normal = pkg({ id: 'normal', min_loan_size: 700000 })
    const premier = pkg({ id: 'premier', min_loan_size: 1e6, restricted_to: 'Premier' })
    const show = (loan: number, banks: string[] = []) => applyLoanSizeFilter([normal, premier], loan, new Set(banks)).map(x => x.pkg.id + (x.priority ? '*' : ''))
    it('never shows a restricted package to other clients, nor lets it hide theirs', () => {
        expect(show(1e6)).toEqual(['normal'])
    })
    it('shows both to a Priority client', () => {
        expect(show(1e6, ['B'])).toEqual(['normal', 'premier*'])
    })
    it('uses the Priority minimum only for that bank\'s Priority clients', () => {
        const p = pkg({ min_loan_size: 800000, priority_min_loan: 600000 })
        expect(applyLoanSizeFilter([p], 650000)).toHaveLength(0)
        expect(applyLoanSizeFilter([p], 650000, new Set(['B']))[0].priority).toBe(true)
    })
})

describe('order', () => {
    it('lists Fixed, then Floating, then BUC', () => {
        const ls = buildLadders([
            pkg({ category: 'BUC', package_name: 'B BUC', rate_schedule: [{ year: 1, type: 'floating', reference: '1M SORA', spread: 0.3 }] }),
            pkg({ category: 'Floating (Completed)', package_name: 'B Float', rate_schedule: [{ year: 1, type: 'floating', reference: '3M SORA', spread: 0.3 }] }),
            pkg({}),
        ], '2026-11-26')
        expect(ls.map(l => l.category)).toEqual(['Fixed', 'Floating (Completed)', 'BUC'])
    })
})
