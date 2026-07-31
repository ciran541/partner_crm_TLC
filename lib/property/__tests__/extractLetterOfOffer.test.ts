/**
 * Tests for the property Letter-of-Offer extraction normaliser and the
 * mapping into the wizard's package_type/fixed_years/floating_rate_type/
 * year_rates shape. The model's output is untrusted text — these pin the
 * guarantees that hold regardless of which lane produced it.
 */

import { describe, it, expect } from 'vitest'
import {
    parseMoney, parseTenureYears, normalize, normalizeBenchmark,
    completeness, MAX_COMPLETENESS, repairTruncatedJson, toMortgageFields,
    type RateScheduleEntry,
} from '@/lib/property/extractLetterOfOffer'

describe('parseMoney', () => {
    it('parses the formats an LO actually prints', () => {
        expect(parseMoney('$1,250,000.00')).toBe(1_250_000)
        expect(parseMoney('S$800,000')).toBe(800_000)
        expect(parseMoney('1,250,000')).toBe(1_250_000)
        expect(parseMoney('800000')).toBe(800_000)
    })

    it('expands K/M suffixes rather than reading them as digits', () => {
        expect(parseMoney('3M')).toBe(3_000_000)
        expect(parseMoney('1.25m')).toBe(1_250_000)
        expect(parseMoney('800K')).toBe(800_000)
    })

    it('reads a period used as a thousands separator', () => {
        expect(parseMoney('S$200.000')).toBe(200_000)
        expect(parseMoney('1.250.000')).toBe(1_250_000)
    })

    it('returns 0 for anything unusable rather than guessing', () => {
        expect(parseMoney(undefined)).toBe(0)
        expect(parseMoney(null)).toBe(0)
        expect(parseMoney('')).toBe(0)
        expect(parseMoney('not stated')).toBe(0)
        expect(parseMoney(-5)).toBe(0)
    })
})

describe('parseTenureYears', () => {
    it('reads years directly', () => {
        expect(parseTenureYears('25 years')).toBe(25)
        expect(parseTenureYears('25')).toBe(25)
        expect(parseTenureYears(30)).toBe(30)
    })

    it('converts an explicit months unit', () => {
        expect(parseTenureYears('300 months')).toBe(25)
        expect(parseTenureYears('360 mths')).toBe(30)
    })

    it('treats a bare number too large to be years as months', () => {
        expect(parseTenureYears('300')).toBe(25)
    })

    it('rejects out-of-range and unusable values', () => {
        expect(parseTenureYears('0')).toBe(0)
        expect(parseTenureYears('')).toBe(0)
        expect(parseTenureYears(undefined)).toBe(0)
        expect(parseTenureYears('1200 months')).toBe(0)
    })
})

describe('normalizeBenchmark', () => {
    it('collapses verbose SORA descriptions to the canonical form', () => {
        expect(normalizeBenchmark('3-month Compounded SORA')).toBe('3M SORA')
        expect(normalizeBenchmark('1-month compounded Singapore Overnight Rate Average')).toBe('1M SORA')
        expect(normalizeBenchmark('3m')).toBe('3M SORA')
    })

    it('leaves a combined benchmark intact', () => {
        expect(normalizeBenchmark('1M/3M SORA')).toBe('1M/3M SORA')
    })

    it('passes through non-SORA benchmarks unchanged (tidied)', () => {
        expect(normalizeBenchmark('Board Rate')).toBe('Board Rate')
        expect(normalizeBenchmark('FD Rate')).toBe('FD Rate')
    })
})

describe('normalize', () => {
    it('reads a complete schedule in row order, moving thereafter to the end', () => {
        const result = normalize({
            loans: [{ label: 'Housing Loan', amount: '$800,000', tenure: '25 years' }],
            lockin_years: 2,
            bank: 'OCBC Bank',
            property_address: '178 Lompang Road #12-40 Singapore 670178',
            lo_date: '2026-03-15',
            schedule: [
                { year: 1, type: 'fixed', rate_text: '1.6% Fixed', rate: 1.6 },
                { year: 2, type: 'fixed', rate_text: '1.6% Fixed', rate: 1.6 },
                { thereafter: true, type: 'floating', rate_text: '1% above 3M SORA', reference: '3M SORA', spread: 1.0 },
            ],
            notes: [],
        }, 'pdf-text')

        expect(result.total_loan_amount).toBe(800_000)
        expect(result.tenure_years).toBe(25)
        expect(result.lockin_years).toBe(2)
        expect(result.bank).toBe('OCBC Bank')
        expect(result.property_address).toBe('178 Lompang Road #12-40 Singapore 670178')
        expect(result.lo_date).toBe('2026-03-15')
        expect(result.schedule).toEqual([
            { type: 'fixed', rate: 1.6, year: 1 },
            { type: 'fixed', rate: 1.6, year: 2 },
            { type: 'floating', reference: '3M SORA', spread: 1.0, thereafter: true, year: undefined },
        ])
        expect(completeness(result)).toBe(MAX_COMPLETENESS)
    })

    it('sums multiple facilities into one total, matching the tenure they share', () => {
        // The real case that exposed this: an HSBC refinancing LO granting a
        // Housing Loan of $245,000 AND a separate Term Loan of $735,000, both
        // over 18 years — the case is a $980,000 loan, not a $245,000 one.
        const result = normalize({
            loans: [
                { label: 'Housing Loan', amount: 'SGD245,000.00', tenure: '18 years' },
                { label: 'Term Loan', amount: 'SGD735,000.00', tenure: '18 years' },
            ],
            schedule: [],
            notes: [],
        }, 'pdf-text')

        expect(result.loans).toEqual([
            { label: 'Housing Loan', amount: 245_000, tenure_years: 18 },
            { label: 'Term Loan', amount: 735_000, tenure_years: 18 },
        ])
        expect(result.total_loan_amount).toBe(980_000)
        expect(result.tenure_years).toBe(18)
        expect(result.notes.some(n => n.includes('combines 2 facilities') && n.includes('980,000'))).toBe(true)
    })

    it('takes the longest tenure and flags it when facilities disagree', () => {
        const result = normalize({
            loans: [
                { label: 'Housing Loan', amount: '500000', tenure: '20 years' },
                { label: 'Term Loan', amount: '200000', tenure: '15 years' },
            ],
            schedule: [],
            notes: [],
        }, 'pdf-text')
        expect(result.tenure_years).toBe(20)
        expect(result.notes.some(n => n.includes('different tenures'))).toBe(true)
    })

    it('falls back to a single facility when the model ignores the schema and returns the old top-level shape', () => {
        const result = normalize({ loan_amount: '$800,000', tenure: '25 years', schedule: [], notes: [] }, 'pdf-text')
        expect(result.total_loan_amount).toBe(800_000)
        expect(result.tenure_years).toBe(25)
    })

    it('recovers a fixed rate from rate_text when the numeric field is missing', () => {
        const result = normalize({
            schedule: [{ year: 1, type: 'fixed', rate_text: '1.6% Fixed' }],
            notes: [],
        }, 'vision')
        expect(result.schedule).toEqual([{ type: 'fixed', rate: 1.6, year: 1 }])
    })

    it('flags an implausibly small loan amount rather than trusting it silently', () => {
        const tiny = normalize({ loans: [{ amount: '5000', tenure: '20 years' }], schedule: [], notes: [] }, 'pdf-text')
        expect(tiny.notes.some(n => n.includes('too small for a mortgage'))).toBe(true)
    })

    it('rejects an implausible lo_date rather than passing it through', () => {
        const result = normalize({ lo_date: '2099-01-01', schedule: [], notes: [] }, 'pdf-text')
        expect(result.lo_date).toBeUndefined()
    })

    it('never invents a lock-in, bank, address or facility that were not returned', () => {
        const result = normalize({ schedule: [], notes: [] }, 'pdf-text')
        expect(result.loans).toEqual([])
        expect(result.total_loan_amount).toBe(0)
        expect(result.lockin_years).toBeUndefined()
        expect(result.bank).toBeUndefined()
        expect(result.property_address).toBeUndefined()
        expect(result.lo_date).toBeUndefined()
    })
})

describe('repairTruncatedJson', () => {
    it('rewinds to the last complete element and closes open brackets', () => {
        const truncated = '{"a":1,"schedule":[{"year":1,"type":"fixed"},{"year":2,"typ'
        const repaired = repairTruncatedJson(truncated)
        expect(repaired).not.toBeNull()
        expect(() => JSON.parse(repaired!)).not.toThrow()
    })

    it('returns null when the input is already complete', () => {
        expect(repairTruncatedJson('{"a":1}')).toBeNull()
    })
})

describe('toMortgageFields', () => {
    it('splits a leading fixed run from a trailing floating run', () => {
        const schedule: RateScheduleEntry[] = [
            { year: 1, type: 'fixed', rate: 1.6 },
            { year: 2, type: 'fixed', rate: 1.6 },
            { year: 3, type: 'floating', reference: '3M SORA', spread: 0.5 },
        ]
        const result = toMortgageFields(schedule, 3)
        expect(result.package_type).toBe('fixed')
        expect(result.fixed_years).toBe('2')
        expect(result.floating_rate_type).toBe('3MSORA')
        expect(result.year_rates).toEqual(['1.6', '1.6', '0.5'])
    })

    it('reports a fully floating package with no fixed years', () => {
        const schedule: RateScheduleEntry[] = [
            { year: 1, type: 'floating', reference: '1M SORA', spread: 0.65 },
            { year: 2, type: 'floating', reference: '1M SORA', spread: 0.65 },
        ]
        const result = toMortgageFields(schedule, 2)
        expect(result.package_type).toBe('floating')
        expect(result.fixed_years).toBe('')
        expect(result.floating_rate_type).toBe('1MSORA')
        expect(result.year_rates).toEqual(['0.65', '0.65'])
    })

    it('falls back to a thereafter row for lock-in years beyond the last explicit year', () => {
        const schedule: RateScheduleEntry[] = [
            { year: 1, type: 'fixed', rate: 1.5 },
            { thereafter: true, type: 'floating', reference: '3M SORA', spread: 1.0 },
        ]
        const result = toMortgageFields(schedule, 3)
        expect(result.fixed_years).toBe('1')
        expect(result.year_rates).toEqual(['1.5', '1', '1'])
    })

    it('returns an empty prefill when there is no lock-in or no schedule', () => {
        expect(toMortgageFields([], 3)).toEqual({ package_type: '', fixed_years: '', floating_rate_type: '', year_rates: [] })
        expect(toMortgageFields([{ year: 1, type: 'fixed', rate: 1.5 }], 0)).toEqual({ package_type: '', fixed_years: '', floating_rate_type: '', year_rates: [] })
    })

    it('leaves floating_rate_type unset when the reference matches no known benchmark', () => {
        const schedule: RateScheduleEntry[] = [{ year: 1, type: 'floating', reference: 'Some Unknown Benchmark', spread: 0.5 }]
        const result = toMortgageFields(schedule, 1)
        expect(result.floating_rate_type).toBe('')
    })
})
