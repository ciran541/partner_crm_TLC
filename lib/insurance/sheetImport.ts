// Server-only: used by the /api/insurance/cases/import routes, never a client component.
import ExcelJS from 'exceljs'
import { findHeaderRow, normaliseHeader } from '@/lib/insurance/columnMatch'

/**
 * Mass upload — read ANY client list an agent already has (Excel or CSV, any
 * layout) into a plain grid: header row + data rows. Which column is which is
 * decided afterwards by columnMatch.ts and confirmed by the agent.
 *
 * Covers the real sources: Excel/Numbers files, Google Sheets (File → Download),
 * and CRM / Privyr / contacts exports (CSV). Old binary .xls isn't readable by
 * exceljs, so those get a "save as .xlsx or CSV" message instead.
 *
 * Cells come back JSON-safe (they travel to the browser for the mapping screen
 * and back): dates as 'YYYY-MM-DD', numbers as numbers, everything else text.
 */

export const MAX_ROWS = 2000
export const MAX_BYTES = 8 * 1024 * 1024

export type Cell = string | number | null

export type SheetResult =
    | { ok: true; headers: string[]; rows: Cell[][]; rowNumbers: number[]; sheetName?: string }
    | { ok: false; error: string }

const pad = (n: number) => String(n).padStart(2, '0')

function toCell(v: ExcelJS.CellValue): Cell {
    if (v == null) return null
    if (v instanceof Date) {
        // Excel dates are stored as UTC midnight — read UTC parts so SGT doesn't shift the day.
        return isNaN(v.getTime()) ? null : `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`
    }
    if (typeof v === 'number') return isFinite(v) ? v : null
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    if (typeof v === 'string') return v.trim() || null
    if (typeof v === 'object') {
        if ('result' in v) return toCell(v.result as ExcelJS.CellValue)        // formula → its value
        if ('richText' in v) return v.richText.map(t => t.text).join('').trim() || null
        if ('text' in v) return String((v as { text: unknown }).text ?? '').trim() || null   // hyperlink, e.g. emails
        if ('error' in v) return null
    }
    return null
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/** RFC 4180-ish: quoted fields, "" escapes, newlines inside quotes; , ; or tab separated. */
export function parseCsv(text: string): Cell[][] {
    const src = text.replace(/^﻿/, '')
    const firstLine = src.slice(0, src.search(/\r?\n/) >>> 0 || src.length)
    const delim = [',', ';', '\t'].reduce((best, d) =>
        firstLine.split(d).length > firstLine.split(best).length ? d : best, ',')

    const rows: Cell[][] = []
    let row: Cell[] = []
    let field = ''
    let quoted = false
    const pushField = () => { const t = field.trim(); row.push(t === '' ? null : t); field = '' }

    for (let i = 0; i < src.length; i++) {
        const ch = src[i]
        if (quoted) {
            if (ch === '"') {
                if (src[i + 1] === '"') { field += '"'; i++ } else quoted = false
            } else field += ch
        } else if (ch === '"' && field.trim() === '') {
            quoted = true
            field = ''
        } else if (ch === delim) {
            pushField()
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && src[i + 1] === '\n') i++
            pushField()
            rows.push(row)
            row = []
        } else field += ch
    }
    if (field !== '' || row.length) { pushField(); rows.push(row) }
    return rows
}

// ─── Excel ───────────────────────────────────────────────────────────────────

async function readXlsx(buf: ArrayBuffer): Promise<{ grid: Cell[][]; sheetName: string } | null> {
    const wb = new ExcelJS.Workbook()
    try {
        await wb.xlsx.load(buf)
    } catch {
        return null
    }
    // The visible sheet with the most filled rows — a workbook often carries a
    // cover / notes sheet before the actual list.
    let best: { grid: Cell[][]; sheetName: string; filled: number } | null = null
    wb.eachSheet(ws => {
        if (ws.state !== 'visible') return
        const grid: Cell[][] = []
        const last = Math.min(ws.rowCount, MAX_ROWS + 20)
        for (let r = 1; r <= last; r++) {
            const row = ws.getRow(r)
            const cells: Cell[] = []
            for (let c = 1; c <= Math.min(ws.columnCount, 60); c++) cells.push(toCell(row.getCell(c).value))
            grid.push(cells)
        }
        const filled = grid.filter(r => r.some(c => c != null)).length
        if (!best || filled > best.filled) best = { grid, sheetName: ws.name, filled }
    })
    return best
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const colName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `C${i + 1}`)

export async function readSheet(buf: ArrayBuffer, fileName: string): Promise<SheetResult> {
    const name = fileName.toLowerCase()
    let grid: Cell[][]
    let sheetName: string | undefined

    if (name.endsWith('.xls')) {
        return { ok: false, error: 'This is an old-style .xls file. Open it in Excel and use Save As → Excel Workbook (.xlsx) or CSV, then upload that.' }
    }
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
        grid = parseCsv(new TextDecoder('utf-8').decode(buf))
    } else if (name.endsWith('.xlsx')) {
        const x = await readXlsx(buf)
        if (!x) return { ok: false, error: 'Could not open this Excel file. Try saving it again as .xlsx or CSV.' }
        grid = x.grid
        sheetName = x.sheetName
    } else {
        return { ok: false, error: 'Please upload an Excel (.xlsx) or CSV file. From Google Sheets: File → Download → Microsoft Excel.' }
    }

    if (!grid.some(r => r.some(c => c != null))) return { ok: false, error: 'The file is empty.' }

    const h = findHeaderRow(grid)
    const rawHeaders = grid[h] ?? []
    const dataRows = grid.slice(h + 1)

    // Trim trailing columns that have neither a header nor any data.
    let width = rawHeaders.length
    for (const r of dataRows) width = Math.max(width, r.length)
    while (width > 0 && rawHeaders[width - 1] == null && dataRows.every(r => r[width - 1] == null)) width--

    const headers = Array.from({ length: width }, (_, i) => {
        const v = rawHeaders[i]
        return v != null && normaliseHeader(v) ? String(v) : `Column ${colName(i)}`
    })

    // Keep the original sheet row number with each row so problems point at the
    // right line in the agent's own file; drop blank rows.
    const rows: Cell[][] = []
    const rowNumbers: number[] = []
    dataRows.forEach((r, i) => {
        if (r.some(c => c != null)) { rows.push(Array.from({ length: width }, (_, j) => r[j] ?? null)); rowNumbers.push(h + 2 + i) }
    })

    if (rows.length === 0) return { ok: false, error: 'Found the column headings but no clients under them.' }
    if (rows.length > MAX_ROWS) return { ok: false, error: `This file has ${rows.length} clients — up to ${MAX_ROWS} per upload. Split it into smaller files.` }

    return { ok: true, headers, rows, rowNumbers, sheetName }
}

// ─── Blank sheet (for agents with no list yet) ───────────────────────────────

/**
 * A plain starter sheet. No dropdowns or locked format any more — it's just a
 * list whose headings match HUB's synonyms exactly, so every column maps
 * automatically. Agents who already have a list upload that instead.
 */
export const STARTER_HEADERS = [
    'Client Name', 'Mobile', 'Email', 'Loan Amount', 'Current Bank', 'Lock-in End Date',
    'Follow-up Date', 'Property Type', 'Property Address', 'Remaining Tenure',
    'Current Rate', 'Property Value', 'Year of Purchase',
    'Subsidy Received', 'Case Type', 'Stage', 'Remarks',
]

const STARTER_NOTES: Record<string, string> = {
    'Client Name': 'Required. e.g. Tan Wei Ming',
    'Mobile': 'Required. e.g. 91234567 or +65 9123 4567',
    'Email': 'Optional',
    'Loan Amount': 'Current outstanding loan, e.g. 750000',
    'Current Bank': 'e.g. DBS',
    'Lock-in End Date': 'DD/MM/YYYY, e.g. 15/03/2027',
    'Follow-up Date': 'DD/MM/YYYY. HUB reminds you on this day',
    'Property Type': 'HDB / Condo / Landed / EC',
    'Property Address': 'Optional',
    'Remaining Tenure': 'Years left on the loan, e.g. 22',
    'Current Rate': 'Current interest rate in %, e.g. 2.6',
    'Property Value': 'Latest valuation, e.g. 1500000',
    'Year of Purchase': 'e.g. 2019',
    'Subsidy Received': 'e.g. 2000',
    'Case Type': 'Refinancing / Purchase / Decoupling / Equity Loan. Blank = Refinancing',
    'Stage': 'Blank = Inactive (past client, follow-up only). Or Touched Base etc.',
    'Remarks': 'Optional notes',
}

export async function buildStarterSheet(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook()
    wb.creator = 'TLC HUB'
    const ws = wb.addWorksheet('Clients', { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = STARTER_HEADERS.map(h => ({ header: h, width: Math.max(14, h.length + 4) }))
    const head = ws.getRow(1)
    head.font = { bold: true }
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } }
    // Examples live in header notes, not an example row (which would get imported if left in).
    STARTER_HEADERS.forEach((h, i) => { head.getCell(i + 1).note = STARTER_NOTES[h] })
    return Buffer.from(await wb.xlsx.writeBuffer())
}
