/**
 * Column matching for the mass upload — "upload the list you already have".
 *
 * Agents keep clients in Excel, Google Sheets, Privyr / CRM exports, phone
 * contact exports… every one with different column names and orders. Rather
 * than make them retype into our layout, HUB works out which of THEIR columns
 * is which of OUR fields, then the agent confirms on a mapping screen.
 *
 * Deliberately rules, not AI:
 *   - privacy: guessing well needs sample rows, i.e. client names / phones /
 *     loan sizes. Rules never send client data anywhere.
 *   - determinism: same file → same result, testable, free, instant.
 *   - the vocabulary is small and predictable ("HP", "Contact No", "Loan Amt").
 * A wrong guess is caught by the agent on the mapping screen, and every row is
 * still validated by caseIntake.ts afterwards.
 *
 * Two signals per column:
 *   1. its HEADER against a synonym list (strong), and
 *   2. its CONTENT — e.g. mostly 8-digit numbers starting 8/9 → mobile (used
 *      when the header says nothing useful, like "Column C" or "Info").
 *
 * Pure — tested in __tests__/columnMatch.test.ts.
 */

import { parseMoney, type RawIntake } from '@/lib/insurance/caseIntake'

/**
 * A HUB field a column can feed. first/last name are combined into client_name.
 * 'extra_remarks' = "Add to remarks": any column with no HUB field of its own
 * (Status, Occupation…) is kept as "Heading: value" lines in remarks, so
 * nothing the agent recorded is thrown away. Unlike every other field it can be
 * picked for several columns.
 */
export type MatchField = keyof RawIntake | 'first_name' | 'last_name' | 'extra_remarks'

export const FIELD_LABELS: Record<MatchField, string> = {
    client_name: 'Client name',
    first_name: 'First name',
    last_name: 'Last name',
    client_mobile: 'Mobile',
    client_email: 'Email',
    lead_source: 'Lead source',
    lead_source_other: 'Lead source (other)',
    case_type: 'Case type',
    stage: 'Stage',
    loan_amount: 'Loan amount',
    current_bank: 'Current bank',
    subsidy: 'Subsidy received',
    property_address: 'Property address',
    property_type: 'Property type',
    remaining_tenure: 'Remaining tenure (yrs)',
    current_rate: 'Current rate (%)',
    property_value: 'Property value',
    year_of_purchase: 'Year of purchase',
    outstanding_equity_loan: 'Outstanding equity loan',
    equity_loan_tenure: 'Equity loan tenure (yrs)',
    clawback_end_date: 'Clawback end date',
    property_use: 'Own stay / investment',
    borrower_age: 'Borrower age / DOB',
    borrower_income: 'Monthly income',
    borrower_variable: 'Annual bonus / variable',
    borrower_commitments: 'Monthly commitments',
    borrower_residency: 'Residency (SC / PR / Foreigner)',
    extra_remarks: 'Add to remarks',
    lock_in_end_date: 'Lock-in end date',
    follow_up_date: 'Follow-up date',
    remarks: 'Remarks',
}

/** Order shown in the mapping dropdown. */
export const MATCH_FIELDS: MatchField[] = [
    'client_name', 'first_name', 'last_name', 'client_mobile', 'client_email',
    'loan_amount', 'current_bank', 'lock_in_end_date', 'follow_up_date',
    'property_type', 'property_address', 'remaining_tenure', 'current_rate',
    'property_value', 'year_of_purchase', 'subsidy', 'clawback_end_date',
    'outstanding_equity_loan', 'equity_loan_tenure', 'property_use',
    'borrower_age', 'borrower_income', 'borrower_variable', 'borrower_commitments', 'borrower_residency',
    'lead_source', 'case_type', 'stage', 'remarks', 'extra_remarks',
]

/**
 * Header synonyms, already normalised (lower case, words only). Extend this list
 * when a real upload shows a header we missed — that's the whole maintenance.
 */
const SYNONYMS: Record<MatchField, string[]> = {
    client_name: ['name', 'client', 'client name', 'customer', 'customer name', 'full name', 'contact name', 'borrower', 'borrower name', 'lead name', 'clients'],
    first_name: ['first name', 'given name', 'firstname'],
    last_name: ['last name', 'surname', 'family name', 'lastname'],
    client_mobile: ['mobile', 'mobile no', 'mobile number', 'hp', 'hp no', 'h p', 'handphone', 'hand phone', 'phone', 'phone no', 'phone number', 'contact', 'contact no', 'contact number', 'tel', 'tel no', 'cell', 'whatsapp', 'phone 1 value', 'mobile phone'],
    client_email: ['email', 'e mail', 'email address', 'mail', 'e mail 1 value', 'email 1 value'],
    // Not "referred by": that column usually holds a person's name, not a channel.
    lead_source: ['lead source', 'source', 'lead', 'channel', 'lead channel', 'source of lead', 'how did you hear', 'how found us', 'origin'],
    lead_source_other: [],   // never auto-matched
    case_type: ['case type', 'loan type', 'service', 'category', 'deal type'],
    // Not "status": in agents' own sheets that column holds their own labels
    // ("Hot", "Called", "Closed") — auto-mapping it would fail most rows. Leaving
    // it unmapped means every row gets the default (Inactive), which is what a
    // list of past clients wants anyway. The agent can still map it by hand.
    stage: ['stage', 'pipeline stage', 'hub stage'],
    loan_amount: ['loan', 'loan amount', 'loan amt', 'loan size', 'loan quantum', 'quantum', 'outstanding', 'outstanding loan', 'outstanding amount', 'os', 'o s', 'loan balance', 'mortgage', 'principal'],
    current_bank: ['bank', 'current bank', 'existing bank', 'lender', 'bank name', 'financier'],
    subsidy: ['subsidy', 'subsidy received', 'legal subsidy', 'cash rebate', 'rebate', 'clawback'],
    property_address: ['address', 'property address', 'unit', 'location', 'property location', 'postal address'],
    property_type: ['property type', 'prop type', 'housing type', 'type of property', 'hdb private', 'dwelling'],
    remaining_tenure: ['tenure', 'remaining tenure', 'current tenure', 'loan tenure', 'years left', 'tenor', 'remaining years', 'balance tenure', 'remaining loan tenure'],
    current_rate: ['rate', 'current rate', 'interest rate', 'int rate', 'existing rate', 'current interest rate', 'interest', 'package rate', 'current interest', 'rate p a'],
    property_value: ['property value', 'valuation', 'market value', 'property price', 'purchase price', 'market price', 'property valuation', 'val', 'house value'],
    year_of_purchase: ['year of purchase', 'purchase year', 'year purchased', 'yop', 'year bought', 'bought in', 'purchased year', 'purchase date', 'date of purchase'],
    outstanding_equity_loan: ['equity loan', 'outstanding equity loan', 'equity loan outstanding', 'equity os', 'equity o s', 'equity balance', 'existing equity loan', 'equity loan amount'],
    equity_loan_tenure: ['equity tenure', 'equity loan tenure', 'equity remaining tenure', 'remaining equity tenure'],
    clawback_end_date: ['clawback end', 'clawback end date', 'clawback expiry', 'clawback date', 'clawback period end', 'subsidy clawback end'],
    property_use: ['property use', 'usage', 'own stay', 'own stay investment', 'owner occupied', 'investment', 'occupancy', 'purpose'],
    borrower_age: ['age', 'dob', 'd o b', 'date of birth', 'birthday', 'birth date', 'borrower age', 'client age', 'year of birth'],
    borrower_income: ['income', 'monthly income', 'salary', 'monthly salary', 'basic salary', 'basic', 'gross income', 'gross monthly income', 'borrower income'],
    borrower_variable: ['bonus', 'annual bonus', 'variable', 'variable income', 'commission', 'annual variable', 'aws', 'noa'],
    borrower_commitments: ['commitments', 'monthly commitments', 'liabilities', 'monthly liabilities', 'debts', 'other loans', 'car loan', 'monthly debt'],
    borrower_residency: ['residency', 'residential status', 'citizenship', 'nationality', 'sc pr', 'citizen'],
    extra_remarks: [],   // never auto-matched — the agent chooses it
    lock_in_end_date: ['lock in', 'lock in end', 'lock in end date', 'lockin', 'lock in expiry', 'lock in date', 'lock in period end', 'lock in ends', 'expiry', 'expiry date', 'end of lock in'],
    follow_up_date: ['follow up', 'follow up date', 'followup', 'next follow up', 'reminder', 'reminder date', 'call back', 'next contact'],
    remarks: ['remarks', 'remark', 'notes', 'note', 'comments', 'comment', 'description', 'memo'],
}

/**
 * Ambiguous headings: they could mean more than one field ("Property" is the
 * type in one agent's sheet and the address in another's). Only an exact match
 * counts, it scores low, and the column's CONTENT decides — so a "Property"
 * column holding "HDB 4-rm" / "Condo" becomes the property type, while one
 * holding addresses falls through to address (or to the agent on the mapping screen).
 */
const AMBIGUOUS: Partial<Record<MatchField, string[]>> = {
    property_type: ['property', 'type'],
    property_address: ['property'],
    case_type: ['type'],
    loan_amount: ['amount', 'balance'],
    property_value: ['price', 'value'],
}
const WEAK_SCORE = 40

export function normaliseHeader(h: unknown): string {
    return String(h ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
}

/** Score how well a header names a field: exact synonym 100, contains one 60+, ambiguous 40, else 0. */
function headerScore(header: string, field: MatchField): number {
    if (!header) return 0
    if (AMBIGUOUS[field]?.includes(header)) return WEAK_SCORE
    let best = 0
    for (const syn of SYNONYMS[field]) {
        if (header === syn) return 100
        // whole-word containment: "client hp no" contains "hp no"
        if (syn.length >= 2 && (` ${header} `).includes(` ${syn} `)) best = Math.max(best, 60 + Math.min(syn.length, 20))
    }
    return best
}

// ─── Content sniffing ────────────────────────────────────────────────────────

const str = (v: unknown) => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v).trim())

function fraction(values: unknown[], test: (v: unknown) => boolean): number {
    const filled = values.filter(v => str(v) !== '')
    if (filled.length === 0) return 0
    return filled.filter(test).length / filled.length
}

const isSgMobile = (v: unknown) => {
    const d = str(v).replace(/\D/g, '')
    return /^[689]\d{7}$/.test(d) || /^65[689]\d{7}$/.test(d)
}
const isEmail = (v: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(v))
const isBigMoney = (v: unknown) => { const n = parseMoney(v); return n != null && !isNaN(n) && n >= 50_000 && n <= 50_000_000 && !isSgMobile(v) }
const ADDRESS_WORDS = /\b(blk|block|road|rd|ave|avenue|street|st|drive|dr|lane|ln|crescent|cres|boulevard|blvd|walk|hill|park|close|singapore)\b|#\s?\d|\b\d{6}\b/i
const PROPERTY_WORDS = /\b(hdb|condo|condominium|landed|ec|executive condo|terrace|semi d|bungalow|private|apartment|flat)\b/i

/** Content-only score (max 50) — always below a real header match, so headers win ties. */
function contentScore(values: unknown[], field: MatchField, banks: readonly string[]): number {
    const bankKeys = banks.map(b => b.toLowerCase().replace(/[^a-z0-9]/g, ''))
    switch (field) {
        case 'client_mobile': return 50 * fraction(values, isSgMobile)
        case 'client_email': return 50 * fraction(values, isEmail)
        case 'current_bank': return 45 * fraction(values, v => {
            const k = str(v).toLowerCase().replace(/[^a-z0-9]/g, '')
            return !!k && bankKeys.some(b => b === k || (k.length >= 3 && b.startsWith(k)))
        })
        case 'property_type': return 40 * fraction(values, v => PROPERTY_WORDS.test(normaliseHeader(v)) && str(v).length <= 30)
        case 'loan_amount': return 30 * fraction(values, isBigMoney)
        case 'property_address': return 35 * fraction(values, v => ADDRESS_WORDS.test(str(v)) && str(v).length >= 8)
        default: return 0   // dates are ambiguous (lock-in vs follow-up) — header only
    }
}

// ─── Header row ──────────────────────────────────────────────────────────────

/**
 * Which row holds the headers. Real sheets often start with a title or a blank
 * row ("My Clients 2024"), so look at the first 10 rows and take the one whose
 * cells match the most synonyms; fall back to the first row with 2+ filled cells.
 */
export function findHeaderRow(grid: unknown[][]): number {
    let bestRow = -1, bestHits = 0
    const limit = Math.min(grid.length, 10)
    for (let r = 0; r < limit; r++) {
        const hits = (grid[r] ?? []).filter(c => {
            const h = normaliseHeader(c)
            return h && MATCH_FIELDS.some(f => headerScore(h, f) >= 60)
        }).length
        if (hits > bestHits) { bestHits = hits; bestRow = r }
    }
    if (bestRow >= 0 && bestHits >= 1) return bestRow
    const firstFilled = grid.findIndex(row => (row ?? []).filter(c => str(c) !== '').length >= 2)
    return firstFilled >= 0 ? firstFilled : 0
}

// ─── Mapping ─────────────────────────────────────────────────────────────────

export type Mapping = (MatchField | null)[]

export interface ColumnGuess {
    field: MatchField | null
    /** 'header' = matched by column name, 'content' = by what's in it, null = no guess */
    via: 'header' | 'content' | null
}

const MIN_SCORE = 25

/**
 * Best field per column, each field used at most once (highest score wins).
 * `rows` are data rows (header excluded); only the first ~50 are sampled.
 */
export function guessMapping(headers: unknown[], rows: unknown[][], banks: readonly string[] = []): ColumnGuess[] {
    const sample = rows.slice(0, 50)
    const candidates: { col: number; field: MatchField; score: number; via: 'header' | 'content' }[] = []

    headers.forEach((h, col) => {
        const header = normaliseHeader(h)
        const values = sample.map(r => r[col])
        if (values.every(v => str(v) === '')) return   // empty column: nothing to import
        for (const field of MATCH_FIELDS) {
            const hs = headerScore(header, field)
            const cs = contentScore(values, field, banks)
            // A header match is confirmed (or not) by content: "Contact" holding phone
            // numbers beats "Contact" holding names.
            if (hs === WEAK_SCORE) {
                // Ambiguous heading: only a guess if the content backs it up.
                if (cs >= MIN_SCORE / 2) candidates.push({ col, field, score: hs + cs, via: 'header' })
            } else if (hs > 0) candidates.push({ col, field, score: hs + cs / 5, via: 'header' })
            else if (cs >= MIN_SCORE) candidates.push({ col, field, score: cs, via: 'content' })
        }
    })

    candidates.sort((a, b) => b.score - a.score)
    const guesses: ColumnGuess[] = headers.map(() => ({ field: null, via: null }))
    const usedFields = new Set<MatchField>()
    for (const c of candidates) {
        if (guesses[c.col].field || usedFields.has(c.field)) continue
        // A full name and first/last name together would double up — prefer the full name.
        if (c.field === 'client_name' && (usedFields.has('first_name') || usedFields.has('last_name'))) continue
        if ((c.field === 'first_name' || c.field === 'last_name') && usedFields.has('client_name')) continue
        guesses[c.col] = { field: c.field, via: c.via }
        usedFields.add(c.field)
    }
    return guesses
}

/** What the agent must map before continuing. */
export function mappingProblems(mapping: Mapping): string[] {
    const has = (f: MatchField) => mapping.includes(f)
    const problems: string[] = []
    if (!has('client_name') && !has('first_name') && !has('last_name')) problems.push('Pick which column has the client name')
    if (!has('client_mobile')) problems.push('Pick which column has the mobile number')
    const dupes = MATCH_FIELDS.filter(f => f !== 'extra_remarks' && mapping.filter(m => m === f).length > 1)
    for (const f of dupes) problems.push(`"${FIELD_LABELS[f]}" is picked for more than one column`)
    return problems
}

/**
 * Apply the confirmed mapping to one data row → the loose intake shape
 * validateIntake() takes. `headers` labels the "Add to remarks" lines.
 */
export function applyMapping(row: unknown[], mapping: Mapping, headers: unknown[] = []): RawIntake {
    const raw: RawIntake = {}
    let first = '', last = ''
    const extra: string[] = []
    mapping.forEach((field, col) => {
        if (!field) return
        const v = row[col]
        if (v == null || str(v) === '') return
        if (field === 'first_name') first = str(v)
        else if (field === 'last_name') last = str(v)
        else if (field === 'extra_remarks') extra.push(`${String(headers[col] ?? 'Note').trim()}: ${str(v)}`)
        else raw[field] = v
    })
    if (!raw.client_name && (first || last)) raw.client_name = `${first} ${last}`.trim()
    if (extra.length) raw.remarks = [raw.remarks != null ? str(raw.remarks) : '', ...extra].filter(Boolean).join('\n')
    return raw
}

/**
 * Identifies a layout, so a mapping the agent confirmed once is re-applied
 * automatically next time they upload a file from the same source.
 */
export function layoutSignature(headers: unknown[]): string {
    return headers.map(normaliseHeader).join('|')
}
