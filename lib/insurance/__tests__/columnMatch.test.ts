import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import {
    guessMapping, findHeaderRow, applyMapping, mappingProblems, layoutSignature, type MatchField,
} from '@/lib/insurance/columnMatch'
import { readSheet, parseCsv, buildStarterSheet, STARTER_HEADERS } from '@/lib/insurance/sheetImport'
import { validateIntake, intakeToCaseRow } from '@/lib/insurance/caseIntake'

const BANKS = ['DBS', 'OCBC', 'UOB', 'Standard Chartered', 'Maybank', 'HSBC']
const fields = (headers: string[], rows: unknown[][]) => guessMapping(headers, rows, BANKS).map(g => g.field)

describe('guessMapping — real-world layouts', () => {
    it("an agent's own sheet with short-hand headings", () => {
        const headers = ['S/N', 'Client', 'H/P No.', 'Loan Amt', 'Bank', 'Lock-in Expiry', 'Address', 'Remarks']
        const rows = [[1, 'Tan Wei Ming', '9123 4567', '$750,000', 'DBS', '15/03/2027', 'Blk 123 AMK', 'refi due'],
                      [2, 'Lim Mei Ling', '+65 8765 4321', 1200000, 'OCBC', '01/09/2026', '8 Orchard Blvd', '']]
        expect(fields(headers, rows)).toEqual<(MatchField | null)[]>([
            null, 'client_name', 'client_mobile', 'loan_amount', 'current_bank', 'lock_in_end_date', 'property_address', 'remarks',
        ])
    })

    it('a CRM / Privyr-style export', () => {
        const headers = ['Name', 'Phone', 'Email', 'Source', 'Group', 'Notes', 'Created At']
        const rows = [['Ahmad', '6591234567', 'ahmad@mail.com', 'Facebook', 'Refi', 'call back', '2025-01-02']]
        const m = fields(headers, rows)
        expect(m.slice(0, 3)).toEqual(['client_name', 'client_mobile', 'client_email'])
        expect(m[5]).toBe('remarks')
        expect(m[3]).toBe('lead_source')   // Source → Lead source ("Facebook" → Social Media)
    })

    it('a Google Contacts export (first + last name, "Phone 1 - Value")', () => {
        const headers = ['First Name', 'Last Name', 'Phone 1 - Value', 'E-mail 1 - Value']
        const rows = [['Wei Ming', 'Tan', '91234567', 'tan@x.com']]
        const m = fields(headers, rows)
        expect(m).toEqual(['first_name', 'last_name', 'client_mobile', 'client_email'])
        expect(applyMapping(rows[0], m).client_name).toBe('Wei Ming Tan')
        expect(mappingProblems(m)).toEqual([])
    })

    it('falls back to the CONTENT when headings are useless', () => {
        const headers = ['Column A', 'Column B', 'Column C', 'Info']
        const rows = [
            ['Tan', '91234567', 'tan@x.com', 'UOB'],
            ['Lim', '87654321', 'lim@x.com', 'Maybank'],
            ['Ong', '98887777', 'ong@x.com', 'DBS'],
        ]
        const g = guessMapping(headers, rows, BANKS)
        expect(g[1]).toEqual({ field: 'client_mobile', via: 'content' })
        expect(g[2]).toEqual({ field: 'client_email', via: 'content' })
        expect(g[3]).toEqual({ field: 'current_bank', via: 'content' })
        expect(g[0].field).toBeNull()   // a name can't be told from content — agent picks it
    })

    it('"Contact" holding phone numbers is the mobile, not the name', () => {
        const m = fields(['Contact Name', 'Contact'], [['Tan', '91234567'], ['Lim', '87654321']])
        expect(m).toEqual(['client_name', 'client_mobile'])
    })

    it('never maps a "Status" column to stage (agents use it for their own labels)', () => {
        const m = fields(['Name', 'Mobile', 'Status'], [['Tan', '91234567', 'Hot lead']])
        expect(m[2]).toBeNull()
    })

    it('an ambiguous "Property" heading is decided by what the column holds', () => {
        const asType = fields(['Name', 'HP', 'Property', 'Address'], [['Tan', '91234567', 'HDB 4-rm', 'Blk 123 Test Ave 1'], ['Lim', '87654321', 'Condo', '8 Sample Boulevard #10-01']])
        expect(asType.slice(2)).toEqual(['property_type', 'property_address'])
        const asAddress = fields(['Name', 'HP', 'Property'], [['Tan', '91234567', 'Blk 123 Test Ave 1'], ['Lim', '87654321', '8 Sample Boulevard #10-01']])
        expect(asAddress[2]).toBe('property_address')
    })

    it('uses each HUB field once', () => {
        const m = fields(['Mobile', 'Phone', 'Name'], [['91234567', '61234567', 'Tan']])
        expect(m.filter(f => f === 'client_mobile')).toHaveLength(1)
    })
})

describe('header row + mapping checks', () => {
    it('skips a title row above the headings', () => {
        const grid = [['My Clients 2024'], [], ['Name', 'HP', 'Bank'], ['Tan', '91234567', 'DBS']]
        expect(findHeaderRow(grid)).toBe(2)
    })

    it('needs name and mobile before continuing', () => {
        expect(mappingProblems([null, 'client_email'])).toEqual([
            'Pick which column has the client name', 'Pick which column has the mobile number',
        ])
    })

    it('identifies a layout by its headings, ignoring case/punctuation', () => {
        expect(layoutSignature(['H/P No.', 'Name'])).toBe(layoutSignature(['h p no', 'NAME']))
    })
})

describe('readSheet', () => {
    const csvBuf = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

    it('parses CSV with quotes, commas inside quotes and a BOM', () => {
        expect(parseCsv('﻿Name,Address\n"Tan, Wei Ming","Blk 1 ""A"" St"\n')).toEqual([
            ['Name', 'Address'], ['Tan, Wei Ming', 'Blk 1 "A" St'],
        ])
    })

    it('reads semicolon CSVs (European Excel) and keeps sheet row numbers past blank lines', async () => {
        const r = await readSheet(csvBuf('Name;Mobile\nTan;91234567\n\nLim;87654321\n'), 'list.csv')
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.headers).toEqual(['Name', 'Mobile'])
        expect(r.rowNumbers).toEqual([2, 4])
    })

    it('reads an Excel file, picking the sheet that holds the list and turning dates into YYYY-MM-DD', async () => {
        const wb = new ExcelJS.Workbook()
        wb.addWorksheet('Cover').addRow(['Prepared by Justin'])
        const ws = wb.addWorksheet('Clients')
        ws.addRow(['Name', 'HP', 'Lock in end'])
        ws.addRow(['Tan', 91234567, new Date(Date.UTC(2027, 2, 15))])
        const r = await readSheet((await wb.xlsx.writeBuffer()) as ArrayBuffer, 'mine.xlsx')
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.sheetName).toBe('Clients')
        expect(r.rows[0]).toEqual(['Tan', 91234567, '2027-03-15'])
        const m = guessMapping(r.headers, r.rows, BANKS).map(g => g.field)
        const v = validateIntake(applyMapping(r.rows[0], m), BANKS)
        expect(v.ok && v.value.lock_in_end_date).toBe('2027-03-15')
        expect(v.ok && v.value.client_mobile).toBe('91234567')
    })

    it('explains old .xls files and unsupported types instead of failing silently', async () => {
        const xls = await readSheet(csvBuf('x'), 'old.xls')
        expect(!xls.ok && xls.error).toMatch(/Save As/)
        const pdf = await readSheet(csvBuf('x'), 'list.pdf')
        expect(!pdf.ok && pdf.error).toMatch(/Excel \(\.xlsx\) or CSV/)
    })

    it('the blank starter sheet maps every column automatically', async () => {
        const r = await readSheet((await buildStarterSheet()) as unknown as ArrayBuffer, 'blank.xlsx')
        // Empty starter → "no clients" error, but its headings must all be recognised:
        expect(r.ok).toBe(false)
        const m = guessMapping(STARTER_HEADERS, [STARTER_HEADERS.map(() => 'x')], BANKS).map(g => g.field)
        expect(m.every(f => f !== null)).toBe(true)
    })
})

describe('every HUB field an agent sheet might carry', () => {
    it('matches the extra columns to their HUB fields — nothing HUB stores is missed', () => {
        const headers = ['Client', 'HP', 'Loan Amt', 'Current Tenure', 'Current Rate', 'Valuation', 'Year Purchased',
            'Equity Loan', 'Equity Tenure', 'Clawback End', 'Property Use', 'DOB', 'Monthly Income', 'Bonus', 'Commitments', 'Residency']
        const rows = [['Tan', '91234567', 750000, 22, '2.6%', 1500000, 2019, 200000, 15, '01/06/2026', 'Own stay', '12/05/1980', 8000, 20000, 500, 'SC']]
        expect(fields(headers, rows)).toEqual<(MatchField | null)[]>([
            'client_name', 'client_mobile', 'loan_amount', 'remaining_tenure', 'current_rate', 'property_value', 'year_of_purchase',
            'outstanding_equity_loan', 'equity_loan_tenure', 'clawback_end_date', 'property_use', 'borrower_age',
            'borrower_income', 'borrower_variable', 'borrower_commitments', 'borrower_residency',
        ])
    })

    it('"Add to remarks" keeps columns HUB has no field for, labelled', () => {
        const raw = applyMapping(['Tan', '91234567', 'Hot', 'Facebook', 'note'], ['client_name', 'client_mobile', 'extra_remarks', 'extra_remarks', 'remarks'], ['Name', 'HP', 'Status', 'Source', 'Remarks'])
        expect(raw.remarks).toBe('note\nStatus: Hot\nSource: Facebook')
        // several columns may use it without counting as a clash
        expect(mappingProblems(['client_name', 'client_mobile', 'extra_remarks', 'extra_remarks'])).toEqual([])
    })
})

describe('extra field values → intake + workflow pre-fill', () => {
    const base = { client_name: 'Tan', client_mobile: '91234567' }

    it('reads rates however they are written', () => {
        for (const v of ['2.6%', '2.6', 0.026, '2.6% p.a.']) {
            const r = validateIntake({ ...base, current_rate: v }, BANKS)
            expect(r.ok && r.value.current_rate).toBe(2.6)
        }
        expect(validateIntake({ ...base, current_rate: '26' }, BANKS).ok).toBe(false)
    })

    it('turns an age, a date of birth or a year of birth into an age', () => {
        const year = new Date().getFullYear()
        expect((validateIntake({ ...base, borrower_age: 45 }, BANKS) as { value: { borrower_age: number } }).value.borrower_age).toBe(45)
        expect((validateIntake({ ...base, borrower_age: '1980' }, BANKS) as { value: { borrower_age: number } }).value.borrower_age).toBe(year - 1980)
        const dob = validateIntake({ ...base, borrower_age: '01/01/1980' }, BANKS)
        expect(dob.ok && dob.value.borrower_age).toBe(year - 1980)
    })

    it('understands own stay / investment and residency wording', () => {
        expect((validateIntake({ ...base, property_use: 'Rented out' }, BANKS) as { value: { property_use: string } }).value.property_use).toBe('investment')
        expect((validateIntake({ ...base, property_use: 'Owner occupied' }, BANKS) as { value: { property_use: string } }).value.property_use).toBe('own_stay')
        expect((validateIntake({ ...base, borrower_residency: 'S PR' }, BANKS) as { value: { borrower_residency: string } }).value.borrower_residency).toBe('pr')
    })

    it('pre-fills the refinancing workflow, including the main borrower', () => {
        const r = validateIntake({ ...base, current_rate: '2.6%', property_value: '1.5m', year_of_purchase: 2019, outstanding_equity_loan: 200000,
            equity_loan_tenure: 15, property_use: 'own stay', borrower_age: 45, borrower_income: 8000, borrower_commitments: 500, clawback_end_date: '01/06/2026' }, BANKS)
        expect(r.ok).toBe(true)
        if (!r.ok) return
        const row = intakeToCaseRow(r.value, 'u')
        expect(row.workflow_data).toMatchObject({
            current_rate: 2.6, market_price: 1_500_000, year_of_purchase: 2019, outstanding_equity_loan: 200000,
            current_equity_loan_tenure: 15, property_use: 'own_stay', provide_income: true,
            borrowers: [{ age: 45, employment: 'employed', basic_salary: 8000, commitments: 500 }],
        })
        expect(row.clawback_end_date).toBe('2026-06-01')
        expect(row.property_price).toBe(1_500_000)
    })
})
