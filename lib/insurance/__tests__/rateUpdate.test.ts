import { describe, expect, it } from 'vitest'
import type { MortgagePackage, RateScheduleEntry } from '@/lib/types/rates'
import {
    applyProposals, bankChanges, inventedRates, matchRead, compareFeatures, applyFeatureChoice, setFeatures, mergeSchedule, newWarnings,
    normalizeRead, packageErrors, parseMinSize, phraseOf, unreadRateLines, type MatchContext,
} from '../rateUpdate'

// Messages are real banker updates (Sep 2026); reads are what the AI should return for them.

const f = (rate: number, ...years: number[]): RateScheduleEntry[] => years.map(year => ({ year, type: 'fixed', rate }))
const fl = (reference: string, spread: number, ...years: number[]): RateScheduleEntry[] => years.map(year => ({ year, type: 'floating', reference, spread }))
const ta = (reference: string, spread: number): RateScheduleEntry => ({ thereafter: true, type: 'floating', reference, spread })
let n = 0
const pkg = (o: Partial<MortgagePackage>): MortgagePackage => ({
    id: `p${++n}`, bank: 'B', property_type: 'HDB / Private', category: 'Fixed', min_loan_size: 500000, package_name: 'B Fixed Rates 3 Years Lock-In',
    lockin_years: 3, rate_schedule: [...f(1.9, 1, 2, 3), ta('3M SORA', 1)], first_year_rate: 1.9, features: ['One free conversion after 12 months'],
    subsidies: null, remarks: null, min_loan_note: null, status: 'published', last_updated: '2026-09-01', confirmed_on: '2026-09-01',
    priority_min_loan: null, restricted_to: null, valid_until: null, product: null, ...o,
})
const raw = (o: object) => ({ action: 'offer', name: '', category: 'Fixed', fixed_years: 3, lockin_years: null, reference: null, mins: [{ property_type: null, min: '500k' }], priority_min: null, restricted_to: null, rates: [], features: [], lines: [], ...o })
const yr = (rate: number, ...years: number[]) => years.map(year => ({ year, thereafter: false, rate, reference: null, spread: null }))
const read = (items: object[], o: object = {}) => normalizeRead({ scope: 'partial', categories: [], valid_until: null, notes: [], ignored: [], items, ...o })!
const match = (packages: MortgagePackage[], items: object[], o: Partial<MatchContext> = {}, r: object = {}) =>
    matchRead({ bank: 'B', packages, read: read(items, r), text: null, banker: 'A', today: '2026-11-25', fullList: false, newId: () => `new${++n}`, ...o })

const flexi = () => [pkg({ id: 'f500', rate_schedule: [...f(1.95, 1, 2, 3), ta('3M SORA', 1)] }), pkg({ id: 'f1m', min_loan_size: 1e6, rate_schedule: [...f(1.93, 1, 2, 3), ta('3M SORA', 1)] })]
const standard = () => flexi().map(p => ({ ...p, id: `s${p.id}`, features: ['One free conversion after 36 months'] }))

describe('one-line update', () => {
    const line = raw({ rates: yr(1.85, 1, 2, 3) })
    it('updates the one matching package and keeps everything not stated', () => {
        const ps = flexi(), [p] = match(ps, [line])
        expect(p).toMatchObject({ kind: 'change', level: 'green', accepted: true })
        expect(p.proposed).toMatchObject({ id: 'f500', lockin_years: 3, features: ps[0].features })
        expect(p.proposed!.rate_schedule).toEqual([...f(1.85, 1, 2, 3), ta('3M SORA', 1)])
        expect(p.diffs.find(d => d.field === 'Thereafter')!.state).toBe('kept')
    })
    it('asks when it could be two products, and never guesses', () => {
        const [p] = match([...flexi(), ...standard()], [line])
        expect(p).toMatchObject({ kind: 'ask', accepted: false })
        expect(p.candidates).toHaveLength(2)
        expect(applyProposals(flexi(), [{ ...p, accepted: true }])).toHaveLength(2)
    })
    it('uses a stated conversion, or a remembered answer, to choose', () => {
        const all = [...flexi(), ...standard()]
        expect(match(all, [raw({ lockin_years: 3, rates: yr(1.85, 1, 2, 3), features: ['Free conversion after 36 months'] })])[0].current!.id).toBe('sf500')
        const key = match(all, [line])[0].candidates[1].key
        const alias = { banker: 'A', phrase: phraseOf(read([line]).items[0]), ladder_key: key }
        expect(match(all, [line], { aliases: [alias] })[0].kind).toBe('change')
        expect(match(all, [line], { aliases: [{ ...alias, banker: 'Other' }] })[0].kind).toBe('ask')
    })
    it('adds a middle step, copying from the nearest loan size', () => {
        const ps = flexi()
        ps[1].features = [...ps[1].features, 'Only on the 1m step']
        const [p] = match(ps, [raw({ mins: [{ property_type: null, min: '800k' }], rates: yr(1.94, 1, 2, 3) })])
        expect(p).toMatchObject({ kind: 'new', level: 'amber', accepted: false })
        expect(p.proposed).toMatchObject({ min_loan_size: 800000, lockin_years: 3, features: ['One free conversion after 12 months', 'Only on the 1m step'] })
        expect(applyProposals(ps, [{ ...p, accepted: true }])).toHaveLength(3)
    })
    it('warns, but does not block, when a smaller loan becomes cheaper', () => {
        const ps = flexi(), after = applyProposals(ps, match(ps, [line]))
        expect(newWarnings(ps, after, '2026-11-25')).toEqual(['3Y Fixed: 500k (1.85) is cheaper than 1m (1.93)'])
    })
    it('an unchanged package is only confirmed', () => {
        const ps = flexi(), [p] = match(ps, [raw({ rates: yr(1.95, 1, 2, 3) })])
        expect(p.kind).toBe('same')
        expect(bankChanges(ps, applyProposals(ps, [p])).map(c => c.type)).toEqual(['confirmed'])
    })
})

describe('nothing is deleted by itself', () => {
    const one = [raw({ rates: yr(1.85, 1, 2, 3) })]
    it('a partial update leaves the rest alone', () => {
        const ps = [...flexi(), pkg({ id: 'buc', category: 'BUC', lockin_years: 0, rate_schedule: [...fl('3M SORA', 0.3, 1), ta('3M SORA', 1)] })]
        expect(applyProposals(ps, match(ps, one)).map(p => p.id)).toEqual(['f500', 'f1m', 'buc'])
    })
    it('a full list suggests removals, unticked, only in the categories it covers', () => {
        const ps = [...flexi(), pkg({ id: 'buc', category: 'BUC', lockin_years: 0 })]
        const gone = match(ps, one, { fullList: true }, { categories: ['Fixed'] }).filter(p => p.kind === 'remove')
        expect(gone.map(p => [p.current!.id, p.accepted])).toEqual([['f1m', false]])
    })
    it('does not suggest removing a product that is still an open question', () => {
        expect(match([...flexi(), ...standard()], one, { fullList: true }).filter(p => p.kind === 'remove')).toEqual([])
    })
    it('handles "5Y removed" and says when there is nothing to remove (OCBC)', () => {
        const five = pkg({ id: 'five', package_name: 'OCBC 5Y Fixed (HDB Only)', lockin_years: 5, rate_schedule: [...f(2.5, 1, 2, 3, 4, 5), ta('3M SORA', 1)] })
        const item = raw({ action: 'remove', name: 'OCBC 5Y Fixed Rate (HDB Only)', fixed_years: 5, lockin_years: 5, mins: [] })
        expect(match([five], [item])[0]).toMatchObject({ kind: 'remove', accepted: true })
        expect(match(flexi(), [item])[0]).toMatchObject({ kind: 'ask', accepted: false })
    })
})

describe('gaps and wrong reads', () => {
    it('a new product with no lock-in, minimum or rate is red and can never be applied', () => {
        const [p] = match([], [raw({ mins: [], rates: [] })])
        expect(p.level).toBe('red')
        expect(p.warnings.join()).toMatch(/No rate.*No minimum loan.*Lock-in not stated/)
        expect(applyProposals([], [{ ...p, accepted: true }])).toEqual([])
    })
    it('catches a lost year: 3Y fixed with two fixed years (OCBC)', () => {
        expect(match([], [raw({ lockin_years: 3, rates: yr(2.55, 1, 2) })])[0].warnings.join()).toContain('3Y fixed was stated, but there are 2 fixed years')
    })
    it('catches a rate that is not in its own lines', () => {
        const text = '2Y Fixed 500k 1.95%\n3Y Fixed 500k 1.85%'
        const item = read([raw({ rates: yr(1.95, 1, 2, 3), lines: [2] })]).items[0]
        expect(inventedRates(text, item)).toEqual([1.95])
        expect(match(flexi(), [raw({ rates: yr(1.95, 1, 2, 3), lines: [2] })], { text })[0].level).toBe('red')
    })
    it('catches a tier that was missed (Maybank 1M SORA 800k)', () => {
        const text = '<$200k to $799k>\nFirst 2 Years - 1M SORA + 0.30%\n<$800k & Above>\nFirst 2 Years - 1M SORA + 0.20%'
        const r = read([raw({ category: 'Floating (Completed)', fixed_years: null, lines: [1, 2] })])
        expect(unreadRateLines(text, r)).toEqual([{ line: 4, text: 'First 2 Years - 1M SORA + 0.20%' }])
    })
    it('flags a benchmark change (Maybank thereafter 1M vs 3M) and a large jump', () => {
        const ps = [pkg({ category: 'Floating (Completed)', lockin_years: 2, rate_schedule: [...fl('3M SORA', 0.3, 1, 2), ta('1M SORA', 1)] })]
        const [p] = match(ps, [raw({ category: 'Floating (Completed)', fixed_years: null, reference: '3M SORA', rates: [{ year: 1, reference: '3M SORA', spread: 0.3 }, { year: 2, reference: '3M SORA', spread: 0.3 }, { thereafter: true, reference: '3M SORA', spread: 1 }] })])
        expect(p.level).toBe('amber')
        expect(p.warnings.join()).toContain('Benchmark changes: 1M SORA + 1.00% to 3M SORA + 1.00%')
        expect(match(flexi(), [raw({ rates: yr(1.15, 1, 2, 3) })])[0].warnings.join()).toContain('Large change')
    })
    it('warns when another banker changed it recently, not when it is old', () => {
        const recent = (on: string) => ({ recent: [{ package_id: 'f500', banker: 'C', on }] })
        const line = [raw({ rates: yr(1.85, 1, 2, 3) })]
        expect(match(flexi(), line, recent('2026-11-20'))[0].level).toBe('amber')
        expect(match(flexi(), line, recent('2026-09-20'))[0].level).toBe('green')
    })
    it('asks when only the lock-in differs, instead of adding a second product (SCB 1Y)', () => {
        const [p] = match(flexi(), [raw({ lockin_years: 2, rates: yr(1.85, 1, 2, 3) })])
        expect(p.kind).toBe('ask')
        expect(p.warnings.join()).toContain('HUB has a different lock-in')
    })
    it('unticks two parts of a message that land on one package', () => {
        const ps = match(flexi(), [raw({ rates: yr(1.85, 1, 2, 3) }), raw({ rates: yr(1.8, 1, 2, 3) })])
        expect(ps.map(p => p.accepted)).toEqual([false, false])
    })
})

describe('Priority packages (HSBC, SCB)', () => {
    const ps = () => [
        pkg({ id: 'n', min_loan_size: 1e6 }),
        pkg({ id: 'prem', min_loan_size: 1e6, restricted_to: 'Premier', rate_schedule: [...f(1.8, 1, 2, 3), ta('3M SORA', 1)] }),
    ]
    it('a Premier line changes only the Premier package', () => {
        const [p] = match(ps(), [raw({ mins: [], restricted_to: 'Premier', rates: yr(1.75, 1, 2, 3) })])
        expect(p.current!.id).toBe('prem')
        expect(match(ps(), [raw({ mins: [{ property_type: null, min: '1m' }], rates: yr(1.75, 1, 2, 3) })])[0].current!.id).toBe('n')
    })
    it('keeps both minimums', () => {
        const [p] = match(flexi(), [raw({ priority_min: '$300,000', rates: yr(1.95, 1, 2, 3) })])
        expect(p.proposed).toMatchObject({ min_loan_size: 500000, priority_min_loan: 300000 })
    })
})

describe('carry-forward', () => {
    it('a stated thereafter ends the schedule; without one, later years are kept', () => {
        const cur = [...f(1.9, 1, 2), ...fl('3M SORA', 0.5, 3), ta('3M SORA', 1)]
        expect(mergeSchedule(cur, [...f(1.8, 1, 2), ta('1M SORA', 1)]).schedule).toEqual([...f(1.8, 1, 2), ta('1M SORA', 1)])
        expect(mergeSchedule(cur, f(1.8, 1, 2))).toEqual({ schedule: [...f(1.8, 1, 2), ...fl('3M SORA', 0.5, 3), ta('3M SORA', 1)], keptYears: [3], keptThereafter: true })
    })
})

describe('features', () => {
    const differs = (a: string, b: string, lock = 2) => compareFeatures([a], [b], lock).differ.length > 0
    it('reworded lines are not changes', () => {
        expect(differs('1 Free conversion after 12 months', 'Free conversion after 12 months')).toBe(false)
        expect(differs('One free conversion after 24 months', 'One free conversion after lock in period')).toBe(false)
        expect(differs('Full waiver of penalty due to sale anytime', 'Waiver due to sale at any point of time')).toBe(false)
        expect(differs('Mandatory to sign up new credit card (not a must to activate the card)', 'New credit card sign up mandatory for all cases')).toBe(false)
        expect(differs('Waiver due to sale (no part purchase)', 'Waiver due to sale of property (after 12 months) only for loan sizes > $400k')).toBe(false)
    })
    it('a different timing, percentage or availability is reported', () => {
        expect(differs('One free conversion after 24 months', 'One free conversion after lock in period', 3)).toBe(true)
        expect(differs('Waiver due to sale after 12 months', 'Waiver due to sale anytime')).toBe(true)
        expect(differs('Partial prepayment up to 50%', '20% prepayment allowance within LIP')).toBe(true)
        expect(differs('Waiver due to sale', 'Waiver due to sale not applicable')).toBe(true)
    })
    it('accepts HUB when one of several stated lines agrees (HSBC 50% / 100% waiver)', () => {
        expect(compareFeatures(['50% waiver if sold (waiver due to sale)'], ['100% waiver due to sale > $800k', '50% waiver due to sale < $800k'], 2).differ).toEqual([])
    })
    it('never adds cash gifts, and keeps HUB features on a real Maybank message', () => {
        const ps = [pkg({ id: 'm', lockin_years: 2, package_name: 'MayBank - Fixed Rates - 2 Years Lock-In', rate_schedule: [...f(2.3, 1, 2), ta('1M SORA', 1.5)], features: ['One free conversion after 24 months', 'Mandatory to sign up new credit card (not a must to activate the card)', 'Waiver due to sale (no part purchase; solely straightforward sale within lock in period)', '20% prepayment within Lock in period'] })]
        const [p] = match(ps, [raw({ fixed_years: 2, lockin_years: 2, rates: [...yr(1.95, 1, 2), { thereafter: true, reference: '1M SORA', spread: 1.5 }], features: ['Free conversion after 24 months (loan sizes > $400k)', 'Waiver due to sale of property (after 12 months) only for loan sizes > $400k', '20% prepayment allowance within LIP', 'Option for Cash Gift of 0.40% capped at S$2,800 for loan sizes > $1.5M', 'Cash Gift for refinancing 0.40% capped at S$2,500', 'Privilege onboarding on best effort basis with min $30K initial deposit in Save Up account for all cases', 'New credit card sign up mandatory for all cases'] })])
        expect(p).toMatchObject({ level: 'green', accepted: true, featureDiffs: [], warnings: [] })
        expect(p.proposed!.features).toEqual(ps[0].features)
        expect(p.mentions).toEqual(['Privilege onboarding on best effort basis with min $30K initial deposit in Save Up account for all cases'])
        expect(p.diffs.filter(d => d.state === 'changed').map(d => d.field)).toEqual(['Year 1', 'Year 2'])
    })
    it('one answer switches every package with that difference, and can be switched back', () => {
        const ps = flexi().map(p => ({ ...p, features: [...p.features, 'Partial prepayment up to 50%'] }))
        const said = { features: ['20% prepayment'] }
        const all = match(ps, [raw({ rates: yr(1.95, 1, 2, 3), ...said }), raw({ mins: [{ property_type: null, min: '1m' }], rates: yr(1.93, 1, 2, 3), ...said })])
        expect(all.map(p => p.kind)).toEqual(['same', 'same'])
        const d = all[0].featureDiffs[0], used = applyFeatureChoice(all, d, true)
        expect(used.every(p => p.kind === 'change' && p.proposed!.features.includes('20% prepayment') && !p.proposed!.features.includes('Partial prepayment up to 50%'))).toBe(true)
        expect(applyFeatureChoice(used, d, false).map(p => p.kind)).toEqual(['same', 'same'])
    })
    it('a brand new product takes the stated features, without cash', () => {
        const [p] = match([], [raw({ lockin_years: 3, rates: yr(1.9, 1, 2, 3), features: ['Free conversion after 12 months', 'Cash rebate $2,000'] })])
        expect(p.proposed!.features).toEqual(['Free conversion after 12 months'])
    })
})

describe('features limited to a loan size (Maybank "> $400k")', () => {
    const fc = 'One free conversion after 24 months'
    const said = ['Free conversion after 24 months (loan sizes > $400k)']
    it('a package starting above it is unchanged', () => {
        expect(compareFeatures([fc], said, 2, { min: 800000, max: null }).differ).toEqual([])
    })
    it('a package starting below it loses the feature, ready to be switched back', () => {
        expect(compareFeatures([fc], said, 2, { min: 200000, max: 800000 }).differ).toEqual([{ from: fc, to: '', removeByDefault: true, reason: 'The banker says this is only for loans above 400k, and this package starts at 200k' }])
    })
    it('works through matching: 200k loses it by default, 800k keeps it, Keep HUB puts it back', () => {
        const ps = [pkg({ id: 'a', min_loan_size: 200000, lockin_years: 2, rate_schedule: [...f(2.3, 1, 2), ta('1M SORA', 1.5)], features: [fc, 'Credit card needed'] }),
            pkg({ id: 'b', min_loan_size: 800000, lockin_years: 2, rate_schedule: [...f(2.15, 1, 2), ta('1M SORA', 1.5)], features: [fc] })]
        const two = (min: string, r: number) => raw({ fixed_years: 2, lockin_years: 2, mins: [{ property_type: null, min }], rates: yr(r, 1, 2), features: said })
        const out = match(ps, [two('200k', 1.95), two('800k', 1.85)])
        expect(out.map(p => p.proposed!.features)).toEqual([['Credit card needed'], [fc]])
        expect(out.map(p => p.accepted)).toEqual([true, true])
        expect(applyFeatureChoice(out, out[0].featureDiffs[0], false)[0].proposed!.features).toEqual([fc, 'Credit card needed'])
    })
})

describe('editing features on the compare card', () => {
    it('rewording, removing and adding update the change, and settle the question on that line', () => {
        const [p] = match(flexi(), [raw({ rates: yr(1.95, 1, 2, 3), features: ['Free conversion after 24 months'] })])
        expect(p.kind).toBe('same')
        expect(p.featureDiffs).toHaveLength(1)
        const edited = setFeatures(p, ['Free conversion after 18 months', '  ', 'Cash back on salary credit'])
        expect(edited.proposed!.features).toEqual(['Free conversion after 18 months', 'Cash back on salary credit'])
        expect(edited.kind).toBe('change')
        expect(edited.featureDiffs).toEqual([])
        expect(setFeatures(edited, flexi()[0].features).kind).toBe('same')
    })
})

describe('reading the AI reply', () => {
    it('splits HDB and Private into two, and keeps gaps as gaps', () => {
        const r = read([raw({ mins: [{ property_type: 'HDB', min: '200K' }, { property_type: 'Private', min: '300K' }] })])
        expect(r.items.map(i => [i.property_type, i.min_loan, i.lockin_years])).toEqual([['HDB', 200000, null], ['Private', 300000, null]])
        expect(read([raw({ mins: [] })]).items[0]).toMatchObject({ property_type: null, min_loan: null })
    })
    it('drops unknown categories (commercial) and bad shapes', () => {
        expect(read([raw({ category: 'Commercial' })]).items).toEqual([])
        expect(normalizeRead({ packages: [] })).toBeNull()
    })
    it('parses sizes as written', () => {
        expect(['200K', '$1,200,000', '1.5m', '>$1mil', '3M', '', 'No min'].map(parseMinSize)).toEqual([200000, 1200000, 1500000, 1000000, 3000000, null, null])
    })
})

describe('before saving', () => {
    it('rejects broken packages and passes good ones', () => {
        expect(packageErrors(pkg({}))).toEqual([])
        expect(packageErrors(pkg({ rate_schedule: [{ year: 1, type: 'floating', spread: 0.3 }] })).join()).toContain('no benchmark')
        expect(packageErrors(pkg({ rate_schedule: [...f(1.9, 1), ...f(1.9, 3)] })).join()).toContain('years are not')
        expect(packageErrors(pkg({ rate_schedule: [] })).join()).toContain('no yearly rate')
    })
    it('sees text and numeric minimums as equal, and names every change', () => {
        const a = pkg({}), b = { ...a, min_loan_size: '500000' as unknown as number, remarks: '' }
        expect(bankChanges([a], [b])).toEqual([])
        expect(bankChanges([a], []).map(c => c.type)).toEqual(['removed'])
        expect(bankChanges([a], [{ ...a, features: [] }])[0].diffs.map(d => d.field)).toEqual(['Features'])
    })
})
