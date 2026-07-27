/**
 * Tests for the "Documents to prepare" mapping — which HDB/CPF/IRAS documents a case
 * needs, derived from case type + property + employment. Guide-backed items must
 * reference a real document id in DOC_RETRIEVAL_GUIDE.
 */

import { describe, it, expect } from 'vitest'
import { caseDocuments } from '@/lib/insurance/caseDocuments'
import { DOC_RETRIEVAL_GUIDE } from '@/lib/insurance/docRetrievalGuide'

const GUIDE_IDS = new Set(DOC_RETRIEVAL_GUIDE.flatMap(i => i.documents.map(d => d.id)))
const ids = (docs: { id: string }[]) => docs.map(d => d.id)

describe('caseDocuments — income docs', () => {
    it('employed borrower → payslips + CPF contribution', () => {
        const docs = caseDocuments({ caseType: 'Purchase', borrowers: [{ employment: 'employed' }] })
        expect(ids(docs)).toEqual(expect.arrayContaining(['b1-payslip', 'b1-cpf-contrib']))
        expect(ids(docs)).not.toContain('b1-noa')
    })

    it('self-employed borrower → NOA + CPF contribution (no payslips)', () => {
        const docs = caseDocuments({ caseType: 'Purchase', borrowers: [{ employment: 'self_employed' }] })
        expect(ids(docs)).toEqual(expect.arrayContaining(['b1-noa', 'b1-cpf-contrib']))
        expect(ids(docs)).not.toContain('b1-payslip')
    })

    it('drops padded/empty borrower slots', () => {
        const docs = caseDocuments({
            caseType: 'Purchase',
            borrowers: [{ employment: 'employed' }, { employment: 'self_employed' }, {}, {}],
        })
        expect(ids(docs)).toEqual(expect.arrayContaining(['b1-payslip', 'b2-noa']))
        expect(ids(docs).some(id => id.startsWith('b3') || id.startsWith('b4'))).toBe(false)
    })
})

describe('caseDocuments — Refinancing property/loan logic', () => {
    const b = [{ employment: 'employed' as const }]

    it('HDB on HDB loan → Financial Info + SOA + Flat Details (no bank statement)', () => {
        const docs = caseDocuments({ caseType: 'Refinancing', isHdb: true, onHdbLoan: true, borrowers: b })
        expect(ids(docs)).toEqual(expect.arrayContaining(['hdb-financial-info', 'hdb-soa', 'hdb-flat-details', 'cpf-home-ownership', 'cpf-property-withdrawal']))
        expect(ids(docs)).not.toContain('bank-loan-statement')
    })

    it('HDB on bank loan → Financial Info + bank statement + Flat Details (no SOA)', () => {
        const docs = caseDocuments({ caseType: 'Refinancing', isHdb: true, onHdbLoan: false, borrowers: b })
        expect(ids(docs)).toEqual(expect.arrayContaining(['hdb-financial-info', 'bank-loan-statement', 'hdb-flat-details']))
        expect(ids(docs)).not.toContain('hdb-soa')
    })

    it('private → bank statement + CPF, no HDB docs', () => {
        const docs = caseDocuments({ caseType: 'Refinancing', isHdb: false, borrowers: b })
        expect(ids(docs)).toEqual(expect.arrayContaining(['bank-loan-statement', 'cpf-home-ownership', 'cpf-property-withdrawal']))
        expect(ids(docs).some(id => id.startsWith('hdb-'))).toBe(false)
    })
})

describe('caseDocuments — other case types', () => {
    const b = [{ employment: 'employed' as const }]

    it('Purchase → IRAS property summary + CPF balance, no HDB', () => {
        const docs = caseDocuments({ caseType: 'Purchase', borrowers: b })
        expect(ids(docs)).toEqual(expect.arrayContaining(['iras-property-summary', 'cpf-account-balance']))
        expect(ids(docs).some(id => id.startsWith('hdb-'))).toBe(false)
    })

    it('Equity Loan (fully paid) → CPF only, no bank statement', () => {
        const docs = caseDocuments({ caseType: 'Equity Loan', fullyPaid: true, borrowers: b })
        expect(ids(docs)).toEqual(expect.arrayContaining(['cpf-home-ownership', 'cpf-property-withdrawal']))
        expect(ids(docs)).not.toContain('bank-loan-statement')
    })

    it('Equity Loan (not fully paid) → adds bank statement', () => {
        const docs = caseDocuments({ caseType: 'Equity Loan', fullyPaid: false, borrowers: b })
        expect(ids(docs)).toContain('bank-loan-statement')
    })

    it('Decouple → both-owner CPF withdrawal + IRAS + bank statement', () => {
        const docs = caseDocuments({ caseType: 'Decouple', isHdb: false, borrowers: b })
        expect(ids(docs)).toEqual(expect.arrayContaining(['cpf-property-withdrawal', 'iras-property-summary', 'cpf-account-balance', 'bank-loan-statement']))
    })
})

describe('caseDocuments — integrity', () => {
    it('never repeats a document id', () => {
        const docs = caseDocuments({ caseType: 'Decouple', isHdb: true, onHdbLoan: true, borrowers: [{ employment: 'employed' }, { employment: 'self_employed' }] })
        const seen = ids(docs)
        expect(new Set(seen).size).toBe(seen.length)
    })

    it('every guideDocId points to a real guide document', () => {
        const cases = [
            caseDocuments({ caseType: 'Refinancing', isHdb: true, onHdbLoan: true, borrowers: [{ employment: 'self_employed' }] }),
            caseDocuments({ caseType: 'Purchase', borrowers: [{ employment: 'employed' }] }),
            caseDocuments({ caseType: 'Decouple', borrowers: [{ employment: 'employed' }] }),
            caseDocuments({ caseType: 'Equity Loan', borrowers: [{ employment: 'employed' }] }),
        ].flat()
        for (const d of cases) {
            if (d.guideDocId) expect(GUIDE_IDS.has(d.guideDocId)).toBe(true)
        }
    })
})
