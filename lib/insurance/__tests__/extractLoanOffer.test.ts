/**
 * Tests for the Letter-of-Offer extraction normaliser.
 *
 * The model's output is untrusted text — these tests pin the guarantees that
 * hold regardless of which lane (DeepSeek text / Gemini vision) or which model
 * produced it. That matters more here than in most extractors: the amounts
 * that survive normalisation become original_loan_total, which is the
 * commission base, so a token parsed wrongly mis-pays someone.
 */

import { describe, it, expect } from 'vitest'
import {
    parseMoney, parseTenureYears, normalize, normalizeBenchmark,
    completeness, MAX_COMPLETENESS, hoistNestedFields, repairTruncatedJson,
} from '@/lib/insurance/extractLoanOffer'
import type { ClosedLoanKind } from '@/lib/types'

const REFI_KINDS: ClosedLoanKind[] = ['home', 'equity']

describe('parseMoney', () => {
    it('parses the formats an LO actually prints', () => {
        expect(parseMoney('$1,250,000.00')).toBe(1_250_000)
        expect(parseMoney('S$800,000')).toBe(800_000)
        expect(parseMoney('1,250,000')).toBe(1_250_000)
        expect(parseMoney('800000')).toBe(800_000)
    })

    it('expands K/M suffixes rather than reading them as digits', () => {
        // The bug this guards: "3M" silently becoming 3.
        expect(parseMoney('3M')).toBe(3_000_000)
        expect(parseMoney('1.25m')).toBe(1_250_000)
        expect(parseMoney('800K')).toBe(800_000)
    })

    it('reads a period used as a thousands separator', () => {
        // A scanned UOB letter rendered "S$200,000" as "S$200.000"; parseFloat
        // read that as 200.0 — a 1000x under-read into the commission base.
        expect(parseMoney('S$200.000')).toBe(200_000)
        expect(parseMoney('1.250.000')).toBe(1_250_000)
        expect(parseMoney('200.000')).toBe(200_000)
    })

    it('still treats a period as a decimal point where that is unambiguous', () => {
        expect(parseMoney('1.25M')).toBe(1_250_000)
        expect(parseMoney('200000.50')).toBe(200_001)   // rounded
        expect(parseMoney('1,250,000.00')).toBe(1_250_000)
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
        // LOs state tenure both ways, so a bare 300 is unambiguous in practice:
        // no one takes a 300-year mortgage.
        expect(parseTenureYears('300')).toBe(25)
    })

    it('rejects out-of-range and unusable values', () => {
        expect(parseTenureYears('0')).toBe(0)
        expect(parseTenureYears('')).toBe(0)
        expect(parseTenureYears(undefined)).toBe(0)
        expect(parseTenureYears('1200 months')).toBe(0)   // 100y — a misread
    })
})

describe('normalizeBenchmark', () => {
    it('expands a bare tenor the prompt asked for but the model may not give', () => {
        expect(normalizeBenchmark('3m')).toBe('3M SORA')
        expect(normalizeBenchmark('1 M')).toBe('1M SORA')
        expect(normalizeBenchmark('3-month')).toBe('3M SORA')
    })

    it('normalises a spelled-out compounded benchmark to the stored form', () => {
        // Straight from a real vision read of a UOB letter. Left as-is it
        // would not match the rate editor's "3M SORA" option.
        expect(normalizeBenchmark('3-month Compounded SORA')).toBe('3M SORA')
        expect(normalizeBenchmark('1 month Compounded SORA')).toBe('1M SORA')
    })

    it('collapses a bank\'s full prose description of the benchmark', () => {
        // Verbatim from a real Maybank vision read. Left as-is it prices fine
        // but matches none of the rate editor's options, so the benchmark
        // looks unset to the agent.
        expect(normalizeBenchmark('1-month compounded Singapore Overnight Rate Average (Compounded SORA)')).toBe('1M SORA')
        expect(normalizeBenchmark('3-month Singapore Overnight Rate Average')).toBe('3M SORA')
    })

    it('never collapses a dual benchmark to a single tenor', () => {
        // effectiveRate prices "1M/3M" as the lower of the two — losing one
        // side would silently change the quoted rate.
        expect(normalizeBenchmark('1M/3M SORA')).toBe('1M/3M SORA')
        // Both tenors kept; "Compounded" still drops, matching the canonical
        // combined form the rest of the codebase stores.
        expect(normalizeBenchmark('1-month/3-month Compounded SORA')).toBe('1M/3M SORA')
    })

    it('leaves an already-formed or non-SORA benchmark alone', () => {
        expect(normalizeBenchmark('3M SORA')).toBe('3M SORA')
        expect(normalizeBenchmark('3MSORA')).toBe('3M SORA')
        expect(normalizeBenchmark('1M/3M SORA')).toBe('1M/3M SORA')
        expect(normalizeBenchmark('FD Rate')).toBe('FD Rate')
        expect(normalizeBenchmark('Board Rate')).toBe('Board Rate')
    })
})

describe('normalize — loans', () => {
    it('parses raw tokens into the form figures', () => {
        const out = normalize({
            loans: [{ kind: 'home', amount: '$1,250,000.00', tenure: '300 months' }],
            rate_schedule: [],
        }, REFI_KINDS, 'pdf-text')

        expect(out.loans).toEqual([{ kind: 'home', amount: 1_250_000, tenure: 25 }])
    })

    it('coerces a kind the case type cannot close, and flags it', () => {
        const out = normalize({
            loans: [{ kind: 'new_purchase_home', amount: '500000', tenure: '25' }],
            rate_schedule: [],
        }, REFI_KINDS, 'pdf-text')

        expect(out.loans[0].kind).toBe('home')
        expect(out.notes.some(n => /unclear/i.test(n))).toBe(true)
    })

    it('does not stack two facilities onto the same row', () => {
        const out = normalize({
            loans: [
                { kind: 'home', amount: '800000', tenure: '25' },
                { kind: 'home', amount: '200000', tenure: '10' },
            ],
            rate_schedule: [],
        }, REFI_KINDS, 'pdf-text')

        expect(out.loans.map(l => l.kind)).toEqual(['home', 'equity'])
        expect(out.loans[1].amount).toBe(200_000)
    })

    it('notes a facility it has no row left for instead of dropping it silently', () => {
        const out = normalize({
            loans: [
                { kind: 'home', amount: '800000', tenure: '25' },
                { kind: 'home', amount: '200000', tenure: '10' },
                { kind: 'home', amount: '100000', tenure: '5' },
            ],
            rate_schedule: [],
        }, REFI_KINDS, 'pdf-text')

        expect(out.loans).toHaveLength(2)
        expect(out.notes.some(n => /Extra facility/i.test(n))).toBe(true)
    })

    it('flags an amount too small to be a mortgage', () => {
        const out = normalize({
            loans: [{ kind: 'home', amount: '200', tenure: '30' }],
            rate_schedule: [],
        }, REFI_KINDS, 'vision')

        expect(out.loans[0].amount).toBe(200)   // kept — the agent may correct it
        expect(out.notes.some(n => /too small for a mortgage/i.test(n))).toBe(true)
    })

    it('drops a facility carrying neither figure', () => {
        const out = normalize({
            loans: [{ kind: 'home' }],
            rate_schedule: [],
        }, REFI_KINDS, 'pdf-text')

        expect(out.loans).toHaveLength(0)
        expect(out.notes.some(n => /No loan amount or tenure/i.test(n))).toBe(true)
    })
})

describe('normalize — rate schedule', () => {
    it('sequences years by row order regardless of the labels given', () => {
        const out = normalize({
            loans: [],
            rate_schedule: [
                { year: 1, type: 'fixed', rate: 2.0 },
                { year: 1, type: 'fixed', rate: 2.2 },   // duplicate label
                { thereafter: true, type: 'floating', reference: '3m', spread: 0.75 },
            ],
        }, REFI_KINDS, 'pdf-text')

        expect(out.schedule.map(e => e.year)).toEqual([1, 2, undefined])
        expect(out.schedule[2].thereafter).toBe(true)
    })

    it('keeps the model\'s stated years instead of renumbering from 1', () => {
        // The real failure: a UOB read came back starting at Year 3, was
        // relabelled Year 1, and the client's Year-1 fixed 1.6% was replaced
        // on screen by their Year-3 floating rate.
        const out = normalize({
            loans: [],
            rate_schedule: [
                { year: 3, type: 'floating', reference: '3M Compounded SORA', spread: 0.5 },
                { thereafter: true, type: 'floating', reference: '3M Compounded SORA', spread: 1.0 },
            ],
        }, REFI_KINDS, 'vision')

        expect(out.schedule[0].year).toBe(3)
        expect(out.schedule[1].thereafter).toBe(true)
    })

    it('parses a rate the model returned as a string with a percent sign', () => {
        // Number("1.6%") is NaN, which silently dropped both fixed years.
        const out = normalize({
            loans: [],
            rate_schedule: [
                { year: 1, type: 'fixed', rate: '1.6%' },
                { year: 2, type: 'fixed', rate: '1.6% Fixed' },
            ],
        }, REFI_KINDS, 'vision')

        expect(out.schedule).toHaveLength(2)
        expect(out.schedule[0].rate).toBe(1.6)
        expect(out.schedule[1].rate).toBe(1.6)
    })

    it('fills only unlabelled years, continuing from the last stated one', () => {
        const out = normalize({
            loans: [],
            rate_schedule: [
                { year: 1, type: 'fixed', rate: 1.6 },
                { type: 'fixed', rate: 1.6 },          // unlabelled -> 2
                { year: 3, type: 'floating', reference: '3M SORA', spread: 0.5 },
            ],
        }, REFI_KINDS, 'pdf-text')

        expect(out.schedule.map(e => e.year)).toEqual([1, 2, 3])
    })

    it('keeps a fixed row fixed when the schema padded it with empty leftovers', () => {
        // Gemini's responseSchema emits every declared property, so fixed rows
        // arrive with reference:"" and spread:0. Testing those for presence
        // reclassified them as floating and lost the rate.
        const out = normalize({
            loans: [],
            rate_schedule: [
                { year: 1, type: 'fixed', rate: 1.6, reference: '', spread: 0 },
                { year: 3, type: 'floating', rate: 0, reference: '3M Compounded SORA', spread: 0.5 },
            ],
        }, REFI_KINDS, 'vision')

        expect(out.schedule[0]).toEqual({ type: 'fixed', year: 1, rate: 1.6 })
        expect(out.schedule[1].type).toBe('floating')
        expect(out.schedule[1].spread).toBe(0.5)
    })

    it('recovers a fixed rate the model omitted, from rate_text', () => {
        // Verbatim from a real Gemini vision response on a scanned UOB letter:
        // it identified both fixed years but emitted NO rate for them, so both
        // rows were dropped and the client's 1.6% never reached the form.
        const out = normalize({
            loans: [],
            rate_schedule: [
                { type: 'fixed', year: 1, rate_text: '1.6% Fixed' },
                { type: 'fixed', year: 2, rate_text: '1.6% Fixed' },
                { type: 'floating', year: 3, rate_text: '0.5% above 3-month Compounded SORA', reference: '3-month Compounded SORA', spread: 0.5 },
                { type: 'floating', thereafter: true, rate_text: '1% above 3-month Compounded SORA', reference: '3-month Compounded SORA', spread: 1.0 },
            ],
        }, REFI_KINDS, 'vision')

        expect(out.schedule).toHaveLength(4)
        expect(out.schedule[0]).toEqual({ type: 'fixed', year: 1, rate: 1.6 })
        expect(out.schedule[1]).toEqual({ type: 'fixed', year: 2, rate: 1.6 })
        expect(out.schedule[2].year).toBe(3)
        expect(out.schedule[2].reference).toBe('3M SORA')
        expect(out.schedule[2].spread).toBe(0.5)
        expect(out.schedule[3].thereafter).toBe(true)
        expect(out.schedule[3].spread).toBe(1.0)
    })

    it('recovers a floating spread from rate_text when the model omits it', () => {
        const out = normalize({
            loans: [],
            rate_schedule: [
                { type: 'floating', year: 1, rate_text: '0.75% above 3M SORA', reference: '3M SORA' },
            ],
        }, REFI_KINDS, 'vision')

        expect(out.schedule[0].spread).toBe(0.75)
    })

    it('infers floating from the data when the model ignores the enum', () => {
        const out = normalize({
            loans: [],
            rate_schedule: [{ year: 1, type: 'SORA', reference: '3m', spread: 0.35 }],
        }, REFI_KINDS, 'pdf-text')

        expect(out.schedule[0].type).toBe('floating')
        expect(out.schedule[0].reference).toBe('3M SORA')
        expect(out.schedule[0].spread).toBe(0.35)
    })

    it('drops a "rate" that is really an instalment or loan amount', () => {
        // A misread here would reach the amortisation maths and produce a
        // wildly wrong post-lock-in outstanding.
        const out = normalize({
            loans: [],
            rate_schedule: [
                { year: 1, type: 'fixed', rate: 3200 },
                { year: 2, type: 'fixed', rate: 2.5 },
            ],
        }, REFI_KINDS, 'pdf-text')

        expect(out.schedule).toHaveLength(1)
        expect(out.schedule[0].rate).toBe(2.5)
    })
})

describe('normalize — address, features, subsidy', () => {
    it('carries address, features and subsidy through', () => {
        const out = normalize({
            loans: [], rate_schedule: [],
            property_address: '  123 Bishan Street 12  #08-45\n Singapore 570123 ',
            features: ['Free conversion after lock-in', 'Legal subsidy $2,000'],
            subsidy: 'Legal subsidy $2,000, clawback within 3 years',
        }, REFI_KINDS, 'pdf-text')

        expect(out.property_address).toBe('123 Bishan Street 12 #08-45 Singapore 570123')
        expect(out.features).toEqual(['Free conversion after lock-in', 'Legal subsidy $2,000'])
        expect(out.subsidy).toBe('Legal subsidy $2,000, clawback within 3 years')
    })

    it('dedupes and drops empty features', () => {
        const out = normalize({
            loans: [], rate_schedule: [],
            features: ['Free conversion', 'Free conversion', '  ', ''],
        }, REFI_KINDS, 'pdf-text')

        expect(out.features).toEqual(['Free conversion'])
    })

    it('accepts a real printed clawback date', () => {
        const yr = new Date().getUTCFullYear() + 2
        const out = normalize({
            loans: [], rate_schedule: [], clawback_end_date: `${yr}-06-30`,
        }, REFI_KINDS, 'pdf-text')

        expect(out.clawback_end_date).toBe(`${yr}-06-30`)
    })

    it('rejects a clawback date that is not a real calendar date', () => {
        // The prompt forbids deriving one from "3 years from disbursement";
        // this is the backstop for when the model does it anyway. The value
        // lands in a `date` column, so junk must never reach it.
        for (const bad of ['3 years from disbursement', '2026-13-45', '30/06/2028', '']) {
            const out = normalize({ loans: [], rate_schedule: [], clawback_end_date: bad }, REFI_KINDS, 'pdf-text')
            expect(out.clawback_end_date).toBeUndefined()
        }
    })

    it('rejects a clawback date in the past or absurdly far out', () => {
        const past = normalize({ loans: [], rate_schedule: [], clawback_end_date: '2019-01-01' }, REFI_KINDS, 'pdf-text')
        expect(past.clawback_end_date).toBeUndefined()
        expect(past.notes.some(n => /implausible clawback/i.test(n))).toBe(true)

        const far = normalize({ loans: [], rate_schedule: [], clawback_end_date: '2140-01-01' }, REFI_KINDS, 'pdf-text')
        expect(far.clawback_end_date).toBeUndefined()
    })

    it('omits absent optional fields rather than emitting empty strings', () => {
        const out = normalize({ loans: [], rate_schedule: [] }, REFI_KINDS, 'pdf-text')
        expect(out.property_address).toBeUndefined()
        expect(out.subsidy).toBeUndefined()
        expect(out.clawback_end_date).toBeUndefined()
        expect(out.features).toEqual([])
    })
})

describe('completeness — decides whether to re-read with vision', () => {
    // Modelled on a real UOB facility letter: S$200,000 / 30 years,
    // 1.6% fixed Y1-Y2, 3M SORA +0.5% Y3, thereafter +1.0%, 2-year
    // prepayment period, HDB property under the security clause.
    const fullRead = {
        loans: [{ kind: 'home', amount: 'S$200,000', tenure: '30 years' }],
        rate_schedule: [
            { year: 1, type: 'fixed', rate: 1.6 },
            { year: 2, type: 'fixed', rate: 1.6 },
            { year: 3, type: 'floating', reference: '3M Compounded SORA', spread: 0.5 },
            { thereafter: true, type: 'floating', reference: '3M Compounded SORA', spread: 1.0 },
        ],
        lockin_years: 2,
        property_address: '989B Jurong West Street 93 #07-711 Singapore 642989',
    }

    it('scores a complete read at the maximum, so no vision re-read happens', () => {
        const out = normalize(fullRead, REFI_KINDS, 'pdf-text')
        expect(completeness(out)).toBe(MAX_COMPLETENESS)

        // and the figures themselves survive normalisation
        expect(out.loans[0]).toEqual({ kind: 'home', amount: 200_000, tenure: 30 })
        expect(out.lockin_years).toBe(2)
        expect(out.schedule).toHaveLength(4)
        expect(out.schedule[3].thereafter).toBe(true)
        expect(out.schedule[3].spread).toBe(1.0)
    })

    it('scores below maximum when any needed field is missing', () => {
        const { lockin_years: _drop, ...noLockin } = fullRead
        expect(completeness(normalize(noLockin, REFI_KINDS, 'pdf-text'))).toBeLessThan(MAX_COMPLETENESS)

        const { property_address: _drop2, ...noAddress } = fullRead
        expect(completeness(normalize(noAddress, REFI_KINDS, 'pdf-text'))).toBeLessThan(MAX_COMPLETENESS)

        // The failure actually seen in the wild: valid JSON, nothing in it.
        expect(completeness(normalize({ loans: [], rate_schedule: [] }, REFI_KINDS, 'pdf-text'))).toBe(0)
    })
})

describe('repairTruncatedJson — salvages a response cut off mid-write', () => {
    it('recovers the complete elements when a string is cut mid-word', () => {
        // The real HSBC failure: the model dumped page text into `subsidy`,
        // hit the output cap, and the whole extraction was lost to a bare
        // "couldn't read this file".
        const truncated = `{"loans":[{"kind":"home","amount":"SGD 245,000.00","tenure":"18 years"}],"lockin_years":2,"subsidy":"Cash incentive SGD2,000.00, clawback if redeemed in full within three years from first drawd`
        const repaired = repairTruncatedJson(truncated)

        expect(repaired).not.toBeNull()
        const parsed = JSON.parse(repaired!)
        expect(parsed.loans).toHaveLength(1)
        expect(parsed.loans[0].amount).toBe('SGD 245,000.00')
        expect(parsed.lockin_years).toBe(2)
        expect(parsed.subsidy).toBeUndefined()   // the incomplete field is dropped
    })

    it('keeps earlier array elements intact when cut inside a later one', () => {
        const truncated = `{"loans":[],"rate_schedule":[{"year":1,"type":"fixed","rate":1.4},{"year":2,"type":"fix`
        const parsed = JSON.parse(repairTruncatedJson(truncated)!)

        expect(parsed.rate_schedule[0]).toEqual({ year: 1, type: 'fixed', rate: 1.4 })

        // The half-written trailing element survives repair as a fragment, but
        // carries no rate — normalize drops it rather than emitting a rate-less
        // row, so the salvage can't inject a junk year into the schedule.
        const out = normalize(parsed, REFI_KINDS, 'vision')
        expect(out.schedule).toHaveLength(1)
        expect(out.schedule[0].rate).toBe(1.4)
    })

    it('returns null for JSON that is already complete', () => {
        expect(repairTruncatedJson('{"loans":[],"rate_schedule":[]}')).toBeNull()
    })

    it('is not fooled by braces or commas inside strings', () => {
        const truncated = `{"bank":"HSBC, {Singapore}","property_address":"197 Tembeling Ro`
        const parsed = JSON.parse(repairTruncatedJson(truncated)!)
        expect(parsed.bank).toBe('HSBC, {Singapore}')
        expect(parsed.property_address).toBeUndefined()
    })
})

describe('normalize — recovers a nested (schema-less) response', () => {
    // Verbatim shape from a real DeepSeek read of an OCBC facility letter:
    // only Gemini gets an enforced responseSchema, so DeepSeek nested every
    // top-level field inside loans[0]. Everything read as absent and a fully
    // correct extraction scored 2/5, forcing a needless second AI call.
    const nested = {
        loans: [{
            kind: 'home',
            amount: 'SGD 454,965.00',
            tenure: '324 months',
            lockin_years: 3,
            rate_schedule: [
                { year: 1, type: 'fixed', rate_text: 'Fixed at 1.55% a year', rate: 1.55 },
                { year: 2, type: 'fixed', rate_text: 'Fixed at 1.55% a year', rate: 1.55 },
                { year: 3, type: 'fixed', rate_text: 'Fixed at 1.55% a year', rate: 1.55 },
                { thereafter: true, type: 'floating', rate_text: '1% above the applicable 3-month Compounded SORA', reference: '3M Compounded SORA', spread: 1.0 },
            ],
            bank: 'OCBC Bank',
            property_address: '178 LOMPANG ROAD, #12-40, SINGAPORE 670178',
            features: ['Prepayment fee 1.50% within 36 months (full or partial)'],
            subsidy: 'Cash reward SGD 2,000, clawback if redeemed within 36 months',
            notes: [],
        }],
    }

    it('reads a fully nested payload as if it had been returned correctly', () => {
        const out = normalize(nested, ['home', 'equity'], 'pdf-text')

        expect(out.loans[0]).toEqual({ kind: 'home', amount: 454_965, tenure: 27 })
        expect(out.schedule).toHaveLength(4)
        expect(out.schedule[0].rate).toBe(1.55)
        expect(out.schedule[3].reference).toBe('3M SORA')
        expect(out.lockin_years).toBe(3)
        expect(out.bank).toBe('OCBC Bank')
        expect(out.property_address).toBe('178 LOMPANG ROAD, #12-40, SINGAPORE 670178')
        expect(out.subsidy).toContain('Cash reward')
        expect(completeness(out)).toBe(MAX_COMPLETENESS)   // was 2/5 — no wasted vision call
    })

    it('leaves a correctly-shaped response untouched', () => {
        const flat = {
            loans: [{ kind: 'home', amount: '500000', tenure: '25' }],
            rate_schedule: [{ year: 1, type: 'fixed', rate: 2.0 }],
            lockin_years: 2,
            property_address: '1 Test Road',
        }
        expect(hoistNestedFields(flat)).toEqual(flat)
    })

    it('never lets a nested value overwrite a real top-level one', () => {
        const conflicting = {
            loans: [{ kind: 'home', amount: '500000', tenure: '25', lockin_years: 9 }],
            rate_schedule: [],
            lockin_years: 2,
        }
        expect(hoistNestedFields(conflicting).lockin_years).toBe(2)
    })
})

describe('normalize — lock-in and metadata', () => {
    it('keeps a plausible lock-in and discards an implausible one', () => {
        const ok = normalize({ loans: [], rate_schedule: [], lockin_years: 2 }, REFI_KINDS, 'pdf-text')
        expect(ok.lockin_years).toBe(2)

        const bad = normalize({ loans: [], rate_schedule: [], lockin_years: 240 }, REFI_KINDS, 'pdf-text')
        expect(bad.lockin_years).toBeUndefined()
    })

    it('carries the lane through so the UI can mark a vision read', () => {
        const out = normalize({ loans: [], rate_schedule: [] }, REFI_KINDS, 'vision')
        expect(out.source).toBe('vision')
    })

    it('survives junk shapes without throwing', () => {
        const out = normalize({ loans: 'nope', rate_schedule: null, notes: 5 }, REFI_KINDS, 'vision')
        expect(out.loans).toEqual([])
        expect(out.schedule).toEqual([])
        expect(out.notes.length).toBeGreaterThan(0)
    })
})
