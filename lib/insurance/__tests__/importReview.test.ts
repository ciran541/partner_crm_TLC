import { describe, it, expect } from 'vitest'
import { reviewRows, rowsWithSameValue, toEditable, type ReviewInput } from '@/lib/insurance/importReview'
import { validateIntake } from '@/lib/insurance/caseIntake'

const BANKS = ['DBS', 'OCBC']
const row = (rowNumber: number, raw: ReviewInput['raw'], removed = false): ReviewInput => ({ rowNumber, raw, removed })

describe('reviewRows', () => {
    it('blocks the import while any row has a problem', () => {
        const rows = [row(2, { client_name: 'Tan', client_mobile: '91234567' }), row(3, { client_name: 'Lim', client_email: 'bad@' })]
        const r = reviewRows(rows, BANKS, new Map())
        expect(r.counts).toMatchObject({ ok: 1, error: 1 })
        expect(r.canImport).toBe(false)
        // the exact fields are reported, so the screen can highlight them
        expect(Object.keys(r.rows[1].fieldErrors!)).toEqual(['client_mobile', 'client_email'])
    })

    it('fixing the row in place unlocks the import', () => {
        const rows = [row(2, { client_name: 'Tan', client_mobile: '91234567' }), row(3, { client_name: 'Lim', client_mobile: '87654321', client_email: 'lim@x.com' })]
        const r = reviewRows(rows, BANKS, new Map())
        expect(r.canImport).toBe(true)
        expect(r.ready.map(v => v.client_name)).toEqual(['Tan', 'Lim'])
    })

    it('removing a row is an explicit choice — it no longer blocks, and is not imported', () => {
        const rows = [row(2, { client_name: 'Tan', client_mobile: '91234567' }), row(3, { client_name: 'junk' }, true)]
        const r = reviewRows(rows, BANKS, new Map())
        expect(r.counts).toMatchObject({ ok: 1, error: 0, removed: 1 })
        expect(r.canImport).toBe(true)
        expect(r.ready).toHaveLength(1)
    })

    it('re-checks duplicates live: correcting a mobile to an existing client flips it to "already in HUB"', () => {
        const existing = new Map([['91234567', 'Tan Wei Ming']])
        const r = reviewRows([row(2, { client_name: 'Tan', client_mobile: '+65 9123 4567' })], BANKS, existing)
        expect(r.rows[0]).toMatchObject({ status: 'duplicate', reason: 'Already in HUB as Tan Wei Ming' })
        expect(r.canImport).toBe(false)   // nothing new to import
    })

    it('keeps the first of two rows with the same mobile', () => {
        const r = reviewRows([row(2, { client_name: 'A', client_mobile: '91234567' }), row(5, { client_name: 'B', client_mobile: '9123 4567' })], BANKS, new Map())
        expect(r.rows.map(x => x.status)).toEqual(['ok', 'duplicate'])
        expect(r.rows[1].reason).toBe('Same mobile as row 2')
    })
})

describe('bulk fix + helpers', () => {
    it('finds the other rows holding the same bad value', () => {
        const rows = [row(2, { case_type: 'Refi loan' }), row(3, { case_type: 'Refi loan ' }), row(4, { case_type: 'Purchase' }), row(5, { case_type: 'Refi loan' }, true)]
        expect(rowsWithSameValue(rows, 'case_type', 'Refi loan', 0)).toEqual([1])   // removed rows left alone
    })

    it('turns mapped cells into editable text that validates the same way', () => {
        const raw = toEditable({ client_name: 'Tan', client_mobile: 91234567, loan_amount: 750000, client_email: '' })
        expect(raw).toEqual({ client_name: 'Tan', client_mobile: '91234567', loan_amount: '750000' })
        expect(validateIntake(raw, BANKS).ok).toBe(true)
    })
})
