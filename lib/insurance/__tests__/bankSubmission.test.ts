/**
 * Tests for the bank submission classifier + digital process checklist.
 *
 * The digital/manual/tbc split drives whether the workflow's "What to do next" list
 * swaps to the submission checklist. Bank names come from free-text package
 * snapshots, so alias handling matters. realBorrowers drops padded/empty slots and
 * non-loan owners while preserving each borrower's real position — shared with the
 * Documents-to-prepare engine.
 */

import { describe, it, expect } from 'vitest'
import {
    normalizeBankKey,
    bankSubmissionMode,
    realBorrowers,
    submissionChecklist,
} from '@/lib/insurance/bankSubmission'

describe('normalizeBankKey', () => {
    it('maps long-form and short-form aliases to one key', () => {
        expect(normalizeBankKey('Standard Chartered')).toBe('scb')
        expect(normalizeBankKey('SCB')).toBe('scb')
        expect(normalizeBankKey('Bank of China')).toBe('boc')
        expect(normalizeBankKey('OCBC Bank')).toBe('ocbc')
        expect(normalizeBankKey('United Overseas Bank')).toBe('uob')
        expect(normalizeBankKey('State Bank of India')).toBe('sbi')
        expect(normalizeBankKey('POSB')).toBe('dbs')
    })

    it('is case/punctuation insensitive and safe on empty input', () => {
        expect(normalizeBankKey('  hsbc  ')).toBe('hsbc')
        expect(normalizeBankKey('May-Bank')).toBe('maybank')
        expect(normalizeBankKey(undefined)).toBe('')
        expect(normalizeBankKey('')).toBe('')
    })
})

describe('bankSubmissionMode', () => {
    it('classifies digital banks', () => {
        for (const b of ['OCBC', 'UOB', 'Standard Chartered', 'HSBC', 'Maybank']) {
            expect(bankSubmissionMode(b)).toBe('digital')
        }
    })

    it('classifies manual banks', () => {
        for (const b of ['DBS', 'Bank of China', 'SBI']) {
            expect(bankSubmissionMode(b)).toBe('manual')
        }
    })

    it('treats CIMB/Citi/RHB and unknowns as tbc', () => {
        for (const b of ['CIMB', 'Citibank', 'RHB', 'Some New Bank', undefined]) {
            expect(bankSubmissionMode(b)).toBe('tbc')
        }
    })
})

describe('realBorrowers', () => {
    it('drops padded empty slots and keeps real positions', () => {
        const real = realBorrowers([
            { age: 40, employment: 'employed' },
            { age: 45, employment: 'self_employed' },
            {},
            {},
        ])
        expect(real.map(r => r.n)).toEqual([1, 2])
    })

    it('preserves position when an earlier slot is empty', () => {
        const real = realBorrowers([{}, { age: 45, employment: 'employed' }])
        expect(real.map(r => r.n)).toEqual([2])
    })

    it('excludes owners not on the loan (non_borrower)', () => {
        const real = realBorrowers([
            { age: 40, employment: 'employed' },
            { age: 38, employment: 'employed', non_borrower: true },
        ])
        expect(real.map(r => r.n)).toEqual([1])
    })

    it('counts a slot with only employment or only income', () => {
        expect(realBorrowers([{ employment: 'employed' }]).map(r => r.n)).toEqual([1])
        expect(realBorrowers([{ basic_salary: 5000 }]).map(r => r.n)).toEqual([1])
    })
})

describe('submissionChecklist', () => {
    it('returns the digital process checklist for a digital bank, naming the bank', () => {
        const list = submissionChecklist('OCBC')
        expect(list).not.toBeNull()
        expect(list![0]).toContain('OCBC banker')
        expect(list!.some(a => a.includes("OCBC's panel"))).toBe(true)
        // Documents (payslips etc.) are NOT in this list — they live in caseDocuments.
        expect(list!.some(a => a.toLowerCase().includes('payslip'))).toBe(false)
    })

    it('returns null for manual/tbc/unpicked banks (fall back to generic steps)', () => {
        expect(submissionChecklist('DBS')).toBeNull()
        expect(submissionChecklist('CIMB')).toBeNull()
        expect(submissionChecklist(undefined)).toBeNull()
    })
})
