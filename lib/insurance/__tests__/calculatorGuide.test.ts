import { describe, expect, it } from 'vitest'
import { CALC_GUIDES, calculatorsForPage } from '../calculatorGuide'
import { CALC_KINDS, detectCalc, runCalc } from '../knowledgeCalc'

describe('Calculators guide', () => {
    it('covers every calculator once', () => {
        expect(CALC_GUIDES.map(g => g.kind).sort()).toEqual([...CALC_KINDS].sort())
    })
    it.each(CALC_GUIDES.flatMap(g => g.examples.map(q => [g.kind, q])))('%s: "%s" reaches it', (kind, q) => {
        expect(detectCalc(q)).toBe(kind)
    })
    it.each(CALC_GUIDES.map(g => [g.kind, g]))('%s: its example works out', (kind, g) => {
        const r = runCalc(kind, '', g.sample, 2026)
        expect(r.missing).toEqual([])
        expect(r.error).toBeNull()
        expect(r.result?.lines.some(l => l.main)).toBe(true)
    })
    it('shows the rates the calculators use', () => {
        const absd = CALC_GUIDES.find(g => g.kind === 'absd')!.tables[0].table
        expect(absd.rows.find(r => r[0] === 'Foreigner')).toEqual(['Foreigner', '60%', '60%', '60%'])
        const bsd = CALC_GUIDES.find(g => g.kind === 'bsd')!.tables[0].table
        expect(bsd.rows.at(-1)).toEqual(['Above $3,000,000', '6%'])
    })
    it('names the calculators to check when a page changes', () => {
        expect(calculatorsForPage('https://www.iras.gov.sg/taxes/stamp-duty/for-property/buying-or-acquiring-property/additional-buyer%27s-stamp-duty-(absd)')).toEqual(['absd'])
        expect(calculatorsForPage('https://www.mas.gov.sg/regulation/explainers/new-housing-loans/msr-and-tdsr-rules')).toEqual(['max_loan'])
        expect(calculatorsForPage('https://www.hdb.gov.sg/renting', 'Renting')).toEqual([])
    })
})
