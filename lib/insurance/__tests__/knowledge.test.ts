import { afterEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create } } }))
vi.mock('@/lib/ai/usage', () => ({ recordUsage: vi.fn() }))

import { callClaude, isClaudeConfigured } from '@/lib/ai/claude'
import { groupQuestions, type QuestionRow } from '@/lib/insurance/knowledgeQuestions'
import { figuresMatch } from '@/lib/insurance/composeAnswer'
import { clashes, exactMatch, oneEditApart, rankArticles, terms } from '@/lib/insurance/knowledgeRank'
import { detectCalc, money, runCalc } from '@/lib/insurance/knowledgeCalc'
import { detectLive, isRestricted, lowestRates, ratesReply } from '@/lib/insurance/knowledgeLive'
import type { MortgagePackage } from '@/lib/types/rates'

afterEach(() => { vi.unstubAllEnvs(); create.mockReset() })

describe('paid AI block', () => {
    it('never reaches Claude off the deployed site, even with a key', async () => {
        vi.stubEnv('VERCEL', ''); vi.stubEnv('VERCEL_ENV', ''); vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', ''); vi.stubEnv('ALLOW_PAID_AI_LOCALLY', '')
        vi.stubEnv('ANTHROPIC_API_KEY', 'fake')
        expect(isClaudeConfigured()).toBe(false)
        expect(await callClaude({ label: 't', system: 's', user: 'u' })).toEqual({ text: null, failure: 'not_configured' })
        expect(create).not.toHaveBeenCalled()
    })
    it('can allow one feature without the others', () => {
        vi.stubEnv('VERCEL', ''); vi.stubEnv('VERCEL_ENV', ''); vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', ''); vi.stubEnv('ALLOW_PAID_AI_LOCALLY', 'askKnowledge')
        vi.stubEnv('ANTHROPIC_API_KEY', 'fake')
        expect([isClaudeConfigured('askKnowledge'), isClaudeConfigured('extractPackages'), isClaudeConfigured()]).toEqual([true, false, false])
    })
    it('works on the deployed site', () => {
        vi.stubEnv('VERCEL', '1'); vi.stubEnv('ANTHROPIC_API_KEY', 'fake')
        expect(isClaudeConfigured()).toBe(true)
    })
})

const A = (id: string, title: string, content: string, tags: string[] = []) => ({ id, title, content, tags })
const KB = [
    A('tdsr', 'What is TDSR and what is the limit?', 'Total debt cannot exceed 55% of income.', ['tdsr limit']),
    A('cancel', 'What is the cancellation fee on an incomplete property?', 'Charged on the undisbursed amount, on top of any clawback.', ['cancellation fee']),
    A('equity', 'What is an equity loan?', 'Private property only.', ['equity loan', 'hdb equity loan', 'cash out']),
    A('legal', 'What are the legal fees for buying a condo?', 'About $2,500. Refinancing differs.', ['legal fee']),
    A('legal-refi', 'What are the legal fees for refinancing?', 'About $1,800 for a condo.', ['legal fee refinance']),
]

describe('rankArticles', () => {
    it('refuses an unrelated question even when the embedder likes it', () => {
        const sims = new Map(KB.map(a => [a.id, 0.8]))
        expect(rankArticles('best chicken rice in town', KB, sims).confidence).toBe('none')
    })
    it('answers a clear match directly', () => {
        const r = rankArticles('tdsr limit?', KB)
        expect([r.confidence, r.ranked[0].article.id]).toEqual(['direct', 'tdsr'])
    })
    it('understands agent wording and one typo', () => {
        expect(rankArticles('cashout hdb', KB).ranked[0].article.id).toBe('equity')
        expect(rankArticles('cancelation fee', KB).ranked[0].article.id).toBe('cancel')
        expect(oneEditApart('calwback', 'clawback')).toBe(true)
        expect(oneEditApart('tenure', 'tenant')).toBe(false)
    })
    it('never answers directly when two articles compete or on one word', () => {
        expect(rankArticles('legal fees condo refinance', KB).confidence).not.toBe('direct')
        expect(rankArticles('equity', KB).confidence).not.toBe('direct')
    })
    it('ignores amounts', () => expect(terms('fee on 300k at 45')).toEqual(['fee']))
})

describe('other ways agents ask', () => {
    const kb = [A('a', 'What is the clawback period?', 'x', ['subsidy clawback', 'cpf']), A('b', 'What is lock-in?', 'y', ['cpf', 'early exit fee'])]
    it('always shows the listing article, ignoring case, spaces and the question mark', () => {
        expect(exactMatch('  Subsidy   CLAWBACK ? ', kb)?.id).toBe('a')
        expect(exactMatch('what is the clawback period', kb)?.id).toBe('a')
    })
    it('never forces one on a single word, a different wording or a shared one', () => {
        expect(exactMatch('cpf', kb)).toBeNull()
        expect(exactMatch('subsidy clawback hdb', kb)).toBeNull()
        expect(exactMatch('early exit fee', [...kb, A('c', 'Other', 'z', ['early exit fee'])])).toBeNull()
    })
    it('stops two articles claiming one wording, but not an article itself', () => {
        expect(clashes({ id: 'n', title: 'New', tags: ['Early exit fee?'] }, kb)?.article.id).toBe('b')
        expect(clashes({ id: 'b', title: 'What is lock-in?', tags: ['early exit fee', 'cpf'] }, kb)).toBeNull()
    })
})

describe('groupQuestions', () => {
    const r = (o: Partial<QuestionRow>): QuestionRow => ({ id: 'x', question: 'Q', kind: 'ai', answer: 'A', article_ids: [], rating: null, created_at: '2026-11-24', ...o })
    it('puts answers marked wrong first, then the most asked', () => {
        const g = groupQuestions([r({ id: '1', question: 'often' }), r({ id: '2', question: 'Often ' }), r({ id: '3', question: 'bad', rating: -1 }), r({ id: '4', question: 'once' })])
        expect(g.map(x => [x.question, x.count, x.down])).toEqual([['bad', 1, 1], ['often', 2, 0], ['once', 1, 0]])
    })
    it('keeps different answers to one question apart', () => expect(groupQuestions([r({ answer: 'A' }), r({ answer: 'B' }), r({ kind: 'gap', answer: null })])).toHaveLength(3))
})

describe('figuresMatch', () => {
    const src = ['ABSD is 20% above $1,500,000', 'age 45']
    it('accepts figures from the sources in any format', () => {
        expect(figuresMatch('1. It is 20% above $1.5m.\n2. At 45.', src)).toBe(true)
        expect(figuresMatch('It depends.', src)).toBe(true)
    })
    it('rejects an invented or worked-out figure', () => expect(figuresMatch('That is $300,000.', src)).toBe(false))
})

describe('calculators', () => {
    it('reads money but not ages or years', () => {
        expect(money('condo at $1.2m')).toBe(1_200_000)
        expect(money('300k undisbursed')).toBe(300_000)
        expect(money('1,500,000')).toBe(1_500_000)
        expect(money('age 45, 3M SORA')).toBeNull()
    })
    it('asks for what is missing instead of guessing', () => {
        const r = runCalc('max_loan', 'how much loan i can get for my HDB')
        expect(r.result).toBeNull()
        expect(r.missing).toEqual(['property', 'price', 'income', 'debts', 'age', 'loans'])
    })
    it('cancellation fee', () => {
        const q = 'cancellation fee undisbursed 300k'
        expect(detectCalc(q)).toBe('cancellation')
        expect(runCalc('cancellation', q).result!.lines[0].value).toBe('$2,250')
    })
    it('BSD and ABSD use the shared stamp duty tables', () => {
        expect(runCalc('bsd', 'bsd on 1.5m condo').result!.lines.at(-1)!.value).toBe('$44,600')
        const q = 'absd for PR second home 1m'
        expect(detectCalc(q)).toBe('absd')
        expect(runCalc('absd', q).result!.lines[1].value).toBe('$300,000')
    })
    it('leaves couples, nationalities and decoupling to people', () => {
        for (const q of ['absd married couple 1m', 'us citizen absd 1m', 'decoupling absd 1m', 'absd joint purchase 1m']) expect(detectCalc(q)).toBeNull()
    })
    it('tenure, with the HDB 25-year limit at the higher loan', () => {
        const q = 'my client age 45 longest tenure for bto'
        expect(detectCalc(q)).toBe('tenure_buy')
        expect(runCalc('tenure_buy', q).result!.lines.map(l => l.value)).toEqual(['20 years', '30 years'])
        expect(runCalc('tenure_buy', 'bto age 30').result!.lines.map(l => l.value)).toEqual(['25 years', '30 years'])
        expect(runCalc('tenure_refi', 'refinance hdb age 45 tenure bought 2016', {}, 2026).result!.lines.map(l => l.value)).toEqual(['30 years', '19 years', '19 years'])
    })
    it('rule questions are not sums', () => {
        for (const q of ['what is the minimum loan tenure', 'absd for foreigner', 'is tdsr 55%', 'legal fee refinance condo', 'bank subsidy 800k loan', 'how much equity loan can i get', 'how much cash needed first condo']) expect(detectCalc(q)).toBeNull()
    })
    it('rejects bad form values', () => {
        const r = runCalc('instalment', 'x', { loan: 'abc', rate: -1, years: 30 })
        expect(r.missing).toEqual(['loan', 'rate'])
    })
    it('income limits the loan before the loan-to-value cap', () => {
        const r = runCalc('max_loan', '', { property: 'resale_hdb', price: 600000, income: 4000, debts: 0, age: 35, loans: '0' })
        // $1,200 a month (30%) at 4% over 25 years.
        expect(r.result!.lines[0].value).toBe('$227,342')
        expect(r.result!.lines[1].value).toBe('Income')
    })
})

describe('live data', () => {
    it('recognises only questions about today', () => {
        expect(detectLive('what is the current 3M SORA')).toBe('sora')
        expect(detectLive('what is SORA')).toBeNull()
        expect(detectLive('which bank has the lowest fixed rate now')).toBe('rates')
        expect(detectLive('fixed or floating better now')).toBeNull()
        expect(detectLive('any promotions from banks')).toBe('promotions')
    })
    it('answers only for the bank, loan and lock-in asked', () => {
        const p = (bank: string, rate: number, o: object = {}) => ({ status: 'published', category: 'Fixed', bank, package_name: 'x', property_type: 'HDB / Private', lockin_years: 2, min_loan_size: 200000, min_loan_note: null, last_updated: '2026-11-20', rate_schedule: [{ year: 1, type: 'fixed', rate }], ...o }) as MortgagePackage
        const kb = [p('RHB', 1.4), p('DBS', 1.6, { min_loan_size: 1500000 }), p('DBS', 1.7), p('Standard Chartered', 1.8, { lockin_years: 0 })]
        const got = (q: string) => lowestRates(kb, 'Fixed', q, null).map(x => [x.pkg.bank, x.rate])
        expect(detectLive('dbs fixed rate')).toBe('rates')
        expect(got('dbs lowest fixed rate?')).toEqual([['DBS', 1.6], ['DBS', 1.7]])
        expect(got('dbs lowest fixed rate for 500k loan')).toEqual([['DBS', 1.7]])
        expect(got('lowest fixed rate dbs and scb')).toEqual([['DBS', 1.6], ['Standard Chartered', 1.8]])
        expect(got('lowest fixed rate no lock in')).toEqual([['Standard Chartered', 1.8]])
        expect(got('cimb lowest fixed rate')).toEqual([])
        const chip = ratesReply(kb, 'dbs lowest fixed rate for 500k loan', null, {}, '2026-11-24').filters![0].question
        expect(got(chip)).toEqual([['DBS', 1.7]])
    })
    describe('floating and all types', () => {
        const sora = { value_date: '2099-01-01', comp_sora_1m: 1.5, comp_sora_3m: 1.4, sora: 1, sora_index: null, comp_sora_6m: null, published_date: null, benchmarks: { FHR6: 0.8 } }
        const f = (bank: string, reference: string, spread: number, o: object = {}) => ({ status: 'published', category: 'Floating (Completed)', bank, package_name: 'x', property_type: 'HDB / Private', lockin_years: 2, min_loan_size: 200000, min_loan_note: null, last_updated: '2026-11-20', rate_schedule: [{ year: 1, type: 'floating', reference, spread }], ...o }) as MortgagePackage
        const kb = [f('UOB', '1M SORA', 0.3), f('OCBC', '3M SORA', 0.3), f('HSBC', '1M/3M SORA', 0.2), f('DBS', 'FHR6', 0.6), f('Citibank', '3M SORA', 0.1, { min_loan_note: 'CITI PRIVATE CLIENT (AUM>=$1,500,000)' }), f('CIMB', 'Board Rate', 0),
            f('RHB', '3M SORA', 0.25, { category: 'BUC', lockin_years: 0 }), f('RHB', '', 0, { category: 'Fixed', rate_schedule: [{ year: 1, type: 'fixed', rate: 1.45 }] })]
        it('prices floating packages at today\'s rate and ranks them', () => {
            expect(lowestRates(kb, 'Floating (Completed)', 'lowest floating rate', sora).map(x => [x.pkg.bank, +x.rate.toFixed(2)])).toEqual([['DBS', 1.4], ['HSBC', 1.6], ['OCBC', 1.7], ['UOB', 1.8]])
        })
        it('never ranks an outdated bank rate first', () => {
            const top = (d: string) => ratesReply(kb, 'lowest floating rate', sora, { FHR6: d }, '2026-11-24').rows!.map(x => x.title)
            expect(top('2026-06-24')).toEqual(['HSBC', 'OCBC', 'UOB', 'DBS'])
            expect(top('2026-11-20')[0]).toBe('DBS')
        })
        it('leaves special-client packages out unless asked', () => {
            expect(isRestricted(kb[4])).toBe(true)
            expect(isRestricted(f('SCB', 'x', 0, { min_loan_note: 'Priority Banking: min $500K' }))).toBe(false)
            expect(isRestricted(f('DBS', 'x', 0, { min_loan_note: 'Only for Treasures' }))).toBe(true)
            expect(lowestRates(kb, 'Floating (Completed)', 'citigold lowest floating rate', sora).map(x => x.pkg.bank)).toContain('Citibank')
        })
        it('shows every type when none is named, one type when it is', () => {
            expect(ratesReply(kb, 'lowest rate now', sora).sections!.map(x => x.heading)).toEqual(['Fixed', 'Floating', 'Under construction (BUC)'])
            expect(ratesReply(kb, 'lowest buc rate', sora).rows!.map(x => x.title)).toEqual(['RHB'])
            expect(ratesReply(kb, 'dbs floating rate', sora, { FHR6: '2026-06-24' }, '2026-11-24').rows![0].warn).toContain('FHR6 last set 24 Jun 2026')
        })
        it('knows a package question from a rule', () => {
            for (const q of ['lowest floating rate', 'dbs rates', 'best rate now', 'lowest buc rate', 'cheapest package', 'lowest fixed or floating rate', 'ocbc floating package']) expect(detectLive(q)).toBe('rates')
            for (const q of ['absd rate now', 'stress test rate today', 'fixed or floating better now', 'what is the hdb loan rate now', 'cpf accrued interest rate now', 'fixed vs floating rate', 'what is sora', 'bank subsidy 800k loan', 'bsd rates', 'what rate is used for tdsr']) expect(detectLive(q)).toBeNull()
            expect(detectLive('current 3m sora rate')).toBe('sora')
        })
    })
    it('every filter chip is a live question that does what it says', () => {
        const p = (o: object) => ({ status: 'published', category: 'Fixed', bank: 'B', package_name: 'B 2Y', property_type: 'HDB / Private', lockin_years: 2, min_loan_size: 200000, min_loan_note: null, last_updated: '2026-11-20', rate_schedule: [{ year: 1, type: 'fixed', rate: 1.6 }, { year: 2, type: 'fixed', rate: 1.6 }], ...o }) as MortgagePackage
        const r = ratesReply([p({}), p({ bank: 'C', last_updated: '2026-06-12' })], 'lowest fixed rate now', null, {}, '2026-11-24')
        for (const f of r.filters!) {
            expect(detectLive(f.question)).toBe('rates')
            const on = ratesReply([p({})], f.question, null, {}, '2026-11-24').filters!.find(x => x.label === f.label)!
            expect(on.on).toBe(!f.on)
            expect(ratesReply([p({})], on.question, null, {}, '2026-11-24').filters!.find(x => x.label === f.label)!.on).toBe(f.on)
        }
        expect(r.rows!.map(x => x.warn)).toEqual([undefined, 'Updated 12 Jun 2026'])
        expect(ratesReply([p({ last_updated: '2026-06-12' })], 'x', null, {}, '2026-11-24').warning).toContain('12 Jun 2026')
    })
    it('lists only published packages whose first year is fixed', () => {
        const p = (o: Partial<MortgagePackage>) => ({ status: 'published', category: 'Fixed', property_type: 'HDB', lockin_years: 2, rate_schedule: [{ year: 1, type: 'fixed', rate: 2 }], ...o }) as MortgagePackage
        const r = lowestRates([p({ id: 'a', bank: 'A' }), p({ id: 'a2', bank: 'A', rate_schedule: [{ year: 1, type: 'fixed', rate: 2.5 }] }), p({ id: 'b', status: 'draft' }), p({ id: 'c', rate_schedule: [{ year: 1, type: 'floating', spread: 0.2 }] }), p({ id: 'd', bank: 'D', rate_schedule: [{ year: 1, type: 'fixed', rate: 1.5 }] }), p({ id: 'e', property_type: 'Private' })], 'Fixed', 'lowest fixed hdb rate', null)
        expect(r.map(x => x.pkg.id)).toEqual(['d', 'a'])
    })
})
