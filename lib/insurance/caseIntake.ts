/**
 * Case intake — the ONE set of rules for turning typed-in client details into a
 * `cases` row. Used by both the "+ New Case" form and the mass upload, so a row
 * the upload accepts is exactly a row the form would have accepted.
 *
 * Pure (no DB, no DOM) so it's unit-tested in __tests__/caseIntake.test.ts.
 *
 * Inputs are deliberately loose — spreadsheets hand us "$1,200,000", Excel
 * date serials, "12/3/2027", "+65 9123 4567", "decoupling" — and normalised
 * here once, instead of making the agent reformat their data.
 */

import type { CaseType, PipelineStage } from '@/lib/types'
import { CREATABLE_STAGES, OPEN_STAGES } from '@/lib/insurance/stages'
import { todaySgt } from '@/lib/insurance/promotions'
import { defaultNewCaseFollowUp, followUpLimit } from '@/lib/insurance/followUps'
import { LEAD_SOURCES, matchLeadSource, type LeadSource } from '@/lib/insurance/leadSources'

// ─── Options ─────────────────────────────────────────────────────────────────

export const INTAKE_CASE_TYPES: { value: CaseType; label: string }[] = [
    { value: 'Refinancing', label: 'Refinancing' },
    { value: 'Purchase',    label: 'Purchase' },
    { value: 'Decouple',    label: 'Decoupling' },
    { value: 'Equity Loan', label: 'Equity Loan' },
]

/** Same strings the workflows write into cases.property_type (see extractCaseFields). */
export const INTAKE_PROPERTY_TYPES = ['HDB', 'Private Condo', 'Landed', 'EC (Executive Condo)'] as const

export const DEFAULT_CASE_TYPE: CaseType = 'Refinancing'
export const DEFAULT_STAGE: PipelineStage = 'Inactive'

// ─── Shape ───────────────────────────────────────────────────────────────────

export interface CaseIntake {
    client_name: string
    client_mobile: string
    client_email?: string
    case_type: CaseType
    stage: PipelineStage
    loan_amount?: number
    current_bank?: string
    subsidy?: number
    property_address?: string
    property_type?: string
    remaining_tenure?: number
    current_rate?: number       // % p.a., e.g. 2.6
    property_value?: number
    year_of_purchase?: number
    outstanding_equity_loan?: number
    equity_loan_tenure?: number          // remaining years on the existing equity loan
    clawback_end_date?: string           // YYYY-MM-DD
    property_use?: 'own_stay' | 'investment'
    borrower_age?: number                // main borrower (from age or date of birth)
    borrower_income?: number             // monthly
    borrower_variable?: number           // annual bonus / variable
    borrower_commitments?: number        // monthly
    borrower_residency?: 'singaporean' | 'pr' | 'foreigner'
    lock_in_end_date?: string   // YYYY-MM-DD
    follow_up_date?: string     // YYYY-MM-DD
    remarks?: string
    lead_source?: LeadSource    // where the lead came from (lib/insurance/leadSources.ts)
    lead_source_other?: string  // free text when lead_source = 'others'
}

/** Loose input: strings from a form, or whatever an Excel cell held. */
export type RawIntake = Partial<Record<keyof CaseIntake, unknown>>

/** Problem message per field — lets the review screen highlight the exact cell. */
export type FieldErrors = Partial<Record<keyof CaseIntake, string>>

export type IntakeResult =
    | { ok: true; value: CaseIntake }
    | { ok: false; errors: string[]; fieldErrors: FieldErrors }

// ─── Normalisers ─────────────────────────────────────────────────────────────

const text = (v: unknown): string => {
    if (v == null) return ''
    if (typeof v === 'object' && 'text' in (v as object)) return String((v as { text: unknown }).text ?? '').trim() // Excel rich text / hyperlink
    return String(v).trim()
}

const blank = (v: unknown) => text(v) === ''

/** "$1,200,000" / "1.2m" / 1200000 → 1200000. undefined when blank, NaN when unreadable. */
export function parseMoney(v: unknown): number | undefined {
    if (typeof v === 'number') return isFinite(v) ? v : NaN
    const s = text(v).toLowerCase().replace(/[$,\s]|sgd/g, '')
    if (!s) return undefined
    const m = s.match(/^(\d+(?:\.\d+)?)(k|m)?$/)
    if (!m) return NaN
    const n = parseFloat(m[1]) * (m[2] === 'm' ? 1_000_000 : m[2] === 'k' ? 1_000 : 1)
    return isFinite(n) ? n : NaN
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number): string | null => {
    const dt = new Date(Date.UTC(y, m - 1, d))
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
        ? `${y}-${pad(m)}-${pad(d)}` : null
}

/**
 * Date → 'YYYY-MM-DD'. Accepts a JS Date (Excel date cell), an Excel serial
 * number, ISO 'YYYY-MM-DD', or Singapore-style day-first 'D/M/YYYY' / 'D-M-YY'.
 * undefined when blank, null when unreadable.
 */
export function parseDate(v: unknown): string | null | undefined {
    if (v == null || v === '') return undefined
    if (v instanceof Date) {
        if (isNaN(v.getTime())) return null
        // Excel dates arrive as UTC midnight; read the UTC parts so SGT doesn't shift the day.
        return iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate())
    }
    if (typeof v === 'number') {
        if (v < 20000 || v > 80000) return null   // ~1954 – 2119: anything else isn't a date serial
        const dt = new Date(Math.round((v - 25569) * 86_400_000))
        return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
    }
    const s = text(v)
    if (!s) return undefined
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (m) return iso(+m[1], +m[2], +m[3])
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
    if (m) {
        const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
        return iso(y, +m[2], +m[1])   // day-first, as Singapore writes dates
    }
    return null
}

/** Keep digits (and a leading +). '+65 9123 4567' → '+6591234567', '9123-4567' → '91234567'. */
export function normaliseMobile(v: unknown): string {
    const s = text(v)
    const plus = s.startsWith('+')
    const digits = s.replace(/\D/g, '')
    return digits ? (plus ? '+' : '') + digits : ''
}

/**
 * Duplicate key: the last 8 digits, so '+65 9123 4567', '6591234567' and
 * '91234567' are all recognised as the same Singapore number.
 */
export function mobileKey(v: unknown): string {
    const digits = text(v).replace(/\D/g, '')
    return digits.length >= 8 ? digits.slice(-8) : digits
}

function matchCaseType(v: unknown): CaseType | null | undefined {
    const s = text(v).toLowerCase().replace(/[^a-z]/g, '')
    if (!s) return undefined
    if (['refinancing', 'refinance', 'refi'].includes(s)) return 'Refinancing'
    if (['purchase', 'newpurchase', 'buy'].includes(s)) return 'Purchase'
    if (['decoupling', 'decouple'].includes(s)) return 'Decouple'
    if (['equityloan', 'equity', 'cashout'].includes(s)) return 'Equity Loan'
    return null
}

function matchStage(v: unknown): PipelineStage | null | undefined {
    const s = text(v).toLowerCase().replace(/[^a-z]/g, '')
    if (!s) return undefined
    if (s === 'active') return OPEN_STAGES[0]   // "Active" in plain English = start of the live pipeline
    return CREATABLE_STAGES.find(st => st.toLowerCase().replace(/[^a-z]/g, '') === s) ?? null
}

function matchFromList(v: unknown, list: readonly string[]): string | null | undefined {
    const s = text(v)
    if (!s) return undefined
    const key = s.toLowerCase().replace(/[^a-z0-9]/g, '')
    return list.find(o => o.toLowerCase().replace(/[^a-z0-9]/g, '') === key) ?? null
}

/**
 * Property type in the words agents actually use ("condo", "terrace", "Exec
 * Condo", "HDB 4-rm") → one of INTAKE_PROPERTY_TYPES. null when unrecognised.
 */
function matchPropertyType(v: unknown): string | null | undefined {
    const s = text(v).toLowerCase()
    if (!s) return undefined
    if (/\bec\b|executive/.test(s)) return 'EC (Executive Condo)'
    if (/\bhdb\b|\bflat\b|\b\d\s?-?\s?(rm|room)\b|maisonette|\bbto\b/.test(s)) return 'HDB'
    if (/landed|terrace|semi|bungalow|detached|cluster|good class/.test(s)) return 'Landed'
    if (/condo|private|apartment|executive condominium/.test(s)) return 'Private Condo'
    return null
}

// ─── Validation ──────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Validate + normalise one client. `banks` is the active bank list: a bank that
 * matches (ignoring case/spacing) is stored with the canonical spelling; one
 * that doesn't is kept as typed — the client's current bank can legitimately be
 * one we don't partner with.
 */
export function validateIntake(
    raw: RawIntake,
    banks: readonly string[] = [],
    /** New Case requires a lead source; mass upload may leave it blank ("Not set"). */
    opts: { requireLeadSource?: boolean } = {},
): IntakeResult {
    // One message per field (the first problem found), so the review screen can
    // highlight the exact cell; `errors` is the same messages as a flat list.
    const fieldErrors: FieldErrors = {}
    const fail = (field: keyof CaseIntake, message: string) => { if (!fieldErrors[field]) fieldErrors[field] = message }

    const client_name = text(raw.client_name)
    if (!client_name) fail('client_name', 'Client name is required')
    else if (client_name.length > 120) fail('client_name', 'Client name is too long')

    const client_mobile = normaliseMobile(raw.client_mobile)
    const mobileDigits = client_mobile.replace(/\D/g, '')
    if (!client_mobile) fail('client_mobile', 'Mobile is required')
    else if (mobileDigits.length < 8 || mobileDigits.length > 15) fail('client_mobile', `Mobile "${text(raw.client_mobile)}" doesn't look like a phone number`)

    const email = text(raw.client_email)
    if (email && !EMAIL_RE.test(email)) fail('client_email', `Email "${email}" isn't valid`)

    const case_type = matchCaseType(raw.case_type)
    if (case_type === null) fail('case_type', `Case type "${text(raw.case_type)}" isn't one of: ${INTAKE_CASE_TYPES.map(t => t.label).join(', ')}`)

    const stage = matchStage(raw.stage)
    if (stage === null) {
        const typed = text(raw.stage)
        fail('stage', /closed/i.test(typed)
            ? `Stage "${typed}" can't be set here — close a case from its page so the closure details are captured`
            : `Stage "${typed}" isn't one of: ${CREATABLE_STAGES.join(', ')}`)
    }

    const money = (key: 'loan_amount' | 'subsidy', label: string) => {
        const n = parseMoney(raw[key])
        if (n === undefined) return undefined
        if (isNaN(n) || n < 0) { fail(key, `${label} "${text(raw[key])}" isn't a number`); return undefined }
        if (n > 100_000_000) { fail(key, `${label} looks too large`); return undefined }
        return n
    }
    const loan_amount = money('loan_amount', 'Loan amount')
    const subsidy = money('subsidy', 'Subsidy')

    let remaining_tenure: number | undefined
    if (!blank(raw.remaining_tenure)) {
        const n = typeof raw.remaining_tenure === 'number' ? raw.remaining_tenure : parseFloat(text(raw.remaining_tenure))
        if (!isFinite(n) || n < 0 || n > 35) fail('remaining_tenure', `Remaining tenure "${text(raw.remaining_tenure)}" should be 0–35 years`)
        else remaining_tenure = Math.round(n)
    }

    // Rate: "2.6%", "2.6" or an Excel percentage cell (0.026) — all mean 2.6% p.a.
    let current_rate: number | undefined
    if (!blank(raw.current_rate)) {
        let n = typeof raw.current_rate === 'number' ? raw.current_rate : parseFloat(text(raw.current_rate).replace(/[%\s]|p\.?a\.?/gi, ''))
        if (isFinite(n) && n > 0 && n < 0.2) n = n * 100
        if (!isFinite(n) || n < 0 || n > 15) fail('current_rate', `Current rate "${text(raw.current_rate)}" should be a % between 0 and 15`)
        else current_rate = Math.round(n * 1000) / 1000
    }

    let property_value: number | undefined
    {
        const n = parseMoney(raw.property_value)
        if (n !== undefined) {
            if (isNaN(n) || n < 0 || n > 500_000_000) fail('property_value', `Property value "${text(raw.property_value)}" isn't a number`)
            else property_value = n
        }
    }

    let year_of_purchase: number | undefined
    if (!blank(raw.year_of_purchase)) {
        // Accept a bare year, or pull the year out of a date ("15/03/2019", Excel date cell).
        const iso = /^\d{4}$/.test(text(raw.year_of_purchase)) ? null : parseDate(raw.year_of_purchase)
        const y = iso ? parseInt(iso.slice(0, 4)) : parseInt(text(raw.year_of_purchase))
        if (!isFinite(y) || y < 1960 || y > new Date().getFullYear()) fail('year_of_purchase', `Year of purchase "${text(raw.year_of_purchase)}" isn't a valid year`)
        else year_of_purchase = y
    }

    // ── Second-tier fields (equity loan, clawback, property use, main borrower) ──
    const optMoney = (key: keyof RawIntake, label: string, max = 100_000_000): number | undefined => {
        const n = parseMoney(raw[key])
        if (n === undefined) return undefined
        if (isNaN(n) || n < 0 || n > max) { fail(key, `${label} "${text(raw[key])}" isn't a number`); return undefined }
        return n
    }
    const optYears = (key: keyof RawIntake, label: string): number | undefined => {
        if (blank(raw[key])) return undefined
        const n = typeof raw[key] === 'number' ? (raw[key] as number) : parseFloat(text(raw[key]))
        if (!isFinite(n) || n < 0 || n > 35) { fail(key, `${label} "${text(raw[key])}" should be 0–35 years`); return undefined }
        return Math.round(n)
    }

    const outstanding_equity_loan = optMoney('outstanding_equity_loan', 'Outstanding equity loan')
    const equity_loan_tenure = optYears('equity_loan_tenure', 'Equity loan tenure')

    const clawbackRaw = parseDate(raw.clawback_end_date)
    if (clawbackRaw === null) fail('clawback_end_date', `Clawback end date "${text(raw.clawback_end_date)}" isn't a date (use DD/MM/YYYY)`)
    const clawback_end_date = clawbackRaw ?? undefined

    let property_use: 'own_stay' | 'investment' | undefined
    if (!blank(raw.property_use)) {
        const s = text(raw.property_use).toLowerCase()
        if (/invest|rent|tenant|let\b/.test(s)) property_use = 'investment'
        else if (/own|stay|occup|self|live|yes/.test(s)) property_use = 'own_stay'
        else fail('property_use', `Property use "${text(raw.property_use)}" should be Own stay or Investment`)
    }

    // Age: a number, or a date of birth (any date format above) → age today.
    let borrower_age: number | undefined
    if (!blank(raw.borrower_age)) {
        const t = text(raw.borrower_age)
        const thisYear = new Date().getFullYear()
        const asNum = typeof raw.borrower_age === 'number' && raw.borrower_age < 150 ? raw.borrower_age
            : /^\d{1,3}$/.test(t) ? parseInt(t)
            : /^(19|20)\d{2}$/.test(t) ? thisYear - parseInt(t)          // year of birth
            : typeof raw.borrower_age === 'number' && raw.borrower_age >= 1900 && raw.borrower_age <= thisYear ? thisYear - raw.borrower_age
            : null
        let age = asNum
        if (age == null) {
            const dob = parseDate(raw.borrower_age)
            if (dob) {
                const [y, m, d] = dob.split('-').map(Number)
                const now = new Date()
                age = now.getFullYear() - y - ((now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) ? 1 : 0)
            }
        }
        if (age == null || age < 18 || age > 100) fail('borrower_age', `Borrower age / DOB "${text(raw.borrower_age)}" isn't a valid age or date of birth`)
        else borrower_age = age
    }

    const borrower_income = optMoney('borrower_income', 'Monthly income', 10_000_000)
    const borrower_variable = optMoney('borrower_variable', 'Annual bonus / variable', 50_000_000)
    const borrower_commitments = optMoney('borrower_commitments', 'Monthly commitments', 10_000_000)

    let borrower_residency: 'singaporean' | 'pr' | 'foreigner' | undefined
    if (!blank(raw.borrower_residency)) {
        const s = text(raw.borrower_residency).toLowerCase().replace(/[^a-z]/g, '')
        if (['sc', 'singaporean', 'singaporecitizen', 'citizen', 'singapore'].includes(s)) borrower_residency = 'singaporean'
        else if (['pr', 'permanentresident', 'spr', 'singaporepr'].includes(s)) borrower_residency = 'pr'
        else if (['foreigner', 'foreign', 'fr', 'ep', 'spass', 'nonresident'].includes(s)) borrower_residency = 'foreigner'
        else fail('borrower_residency', `Residency "${text(raw.borrower_residency)}" should be Singaporean, PR or Foreigner`)
    }

    const date = (key: 'lock_in_end_date' | 'follow_up_date', label: string) => {
        const d = parseDate(raw[key])
        if (d === null) fail(key, `${label} "${text(raw[key])}" isn't a date (use DD/MM/YYYY)`)
        return d ?? undefined
    }
    const lock_in_end_date = date('lock_in_end_date', 'Lock-in end date')
    const follow_up_date = date('follow_up_date', 'Follow-up date')
    const fuLimit = followUpLimit({ stage: stage ?? DEFAULT_STAGE, lock_in_end_date }, todaySgt())
    if (follow_up_date && fuLimit && follow_up_date > fuLimit) {
        fail('follow_up_date', `Follow-up can't be later than ${fuLimit.split('-').reverse().join('/')} (2 months before the lock-in ends)`)
    }

    const property_type = matchPropertyType(raw.property_type)
    if (property_type === null) fail('property_type', `Property type "${text(raw.property_type)}" isn't one of: ${INTAKE_PROPERTY_TYPES.join(', ')}`)

    const bankTyped = text(raw.current_bank)
    const current_bank = bankTyped ? (matchFromList(bankTyped, banks) ?? bankTyped) : undefined

    // Spreadsheets carry all sorts of source values (campaign names, "Privyr",
    // a person's name…). On a mass upload an unrecognised one becomes "Others"
    // with the original text kept as the detail, so the row still imports; the
    // New Case form (a dropdown) must send a real one.
    const matchedSource = matchLeadSource(raw.lead_source)
    const lead_source = matchedSource === null && !opts.requireLeadSource ? 'others' : matchedSource
    if (lead_source === null) fail('lead_source', `Lead source "${text(raw.lead_source)}" isn't one of: ${LEAD_SOURCES.map(s => s.label).join(', ')}`)
    else if (lead_source === undefined && opts.requireLeadSource) fail('lead_source', 'Lead source is required')
    const lead_source_other = lead_source !== 'others' ? undefined
        : (text(raw.lead_source_other) || (matchedSource === null ? text(raw.lead_source) : '') || undefined)
    if (lead_source_other && lead_source_other.length > 100) fail('lead_source_other', 'Lead source detail is too long (100 characters max)')

    const property_address = text(raw.property_address) || undefined
    const remarks = text(raw.remarks) || undefined
    if (remarks && remarks.length > 2000) fail('remarks', 'Remarks are too long (2,000 characters max)')

    const errors = Object.values(fieldErrors) as string[]
    if (errors.length) return { ok: false, errors, fieldErrors }
    return {
        ok: true,
        value: {
            client_name,
            client_mobile,
            client_email: email || undefined,
            case_type: case_type ?? DEFAULT_CASE_TYPE,
            stage: stage ?? DEFAULT_STAGE,
            loan_amount, current_bank, subsidy, property_address,
            property_type: property_type ?? undefined,
            remaining_tenure, current_rate, property_value, year_of_purchase,
            outstanding_equity_loan, equity_loan_tenure, clawback_end_date, property_use,
            borrower_age, borrower_income, borrower_variable, borrower_commitments, borrower_residency,
            lock_in_end_date, follow_up_date, remarks,
            lead_source: lead_source ?? undefined, lead_source_other,
        },
    }
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

const money$ = (n: number) => `$${Math.round(n).toLocaleString('en-SG')}`

/**
 * The workflow fields this case type already has a slot for, pre-filled so the
 * agent never re-types them when they later open the workflow. Only unambiguous
 * mappings: "Private Condo" could be completed or under construction, so the
 * refinancing property type is left for the agent to pick.
 */
export function workflowPrefill(c: CaseIntake): Record<string, unknown> {
    const wf: Record<string, unknown> = {}
    const set = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== '') wf[k] = v }

    // Main borrower — every workflow keeps borrowers the same shape (age, employment,
    // salary, bonus, commitments). Income is taken as an employed basic salary; the
    // agent switches to self-employed in the workflow if needed.
    const b: Record<string, unknown> = {}
    if (c.borrower_age != null) b.age = c.borrower_age
    if (c.borrower_income != null || c.borrower_variable != null) b.employment = 'employed'
    if (c.borrower_income != null) b.basic_salary = c.borrower_income
    if (c.borrower_variable != null) b.annual_variable = c.borrower_variable
    if (c.borrower_commitments != null) b.commitments = c.borrower_commitments
    if (c.case_type === 'Purchase' && c.borrower_residency) b.residency = c.borrower_residency
    if (Object.keys(b).length) wf.borrowers = [b]
    if (c.borrower_income != null && c.case_type === 'Refinancing') wf.provide_income = true

    switch (c.case_type) {
        case 'Refinancing':
            set('current_bank', c.current_bank)
            set('outstanding_disbursed', c.loan_amount)
            set('lockin_end_date', c.lock_in_end_date)
            set('current_tenure', c.remaining_tenure)
            set('current_rate', c.current_rate)
            set('market_price', c.property_value)
            set('year_of_purchase', c.year_of_purchase)
            set('outstanding_equity_loan', c.outstanding_equity_loan)
            set('current_equity_loan_tenure', c.equity_loan_tenure)
            set('property_use', c.property_use)
            set('property_type', c.property_type === 'HDB' ? 'hdb' : c.property_type === 'Landed' ? 'landed' : undefined)
            break
        case 'Equity Loan':
            set('current_bank', c.current_bank)
            set('outstanding_disbursed', c.loan_amount)
            set('lockin_end_date', c.lock_in_end_date)
            set('current_tenure', c.remaining_tenure)
            set('current_rate', c.current_rate)
            set('market_price', c.property_value)
            set('year_of_purchase', c.year_of_purchase)
            set('outstanding_equity_loan', c.outstanding_equity_loan)
            set('current_equity_loan_tenure', c.equity_loan_tenure)
            set('property_use', c.property_use)
            set('property_type', c.property_type === 'Landed' ? 'landed' : undefined)
            break
        case 'Decouple':
            set('current_bank', c.current_bank)
            set('outstanding_home_loan', c.loan_amount)
            set('lockin_end_date', c.lock_in_end_date)
            set('current_tenure', c.remaining_tenure)
            set('current_rate', c.current_rate)
            set('property_valuation', c.property_value)
            set('year_of_purchase', c.year_of_purchase)
            set('outstanding_equity_loan', c.outstanding_equity_loan)
            set('current_tenure_equity_loan', c.equity_loan_tenure)
            set('property_use', c.property_use)
            set('property_type', c.property_type === 'Landed' ? 'landed' : undefined)
            break
        case 'Purchase':
            // A purchase workflow starts from the NEW property: only its price maps.
            set('property_price', c.property_value)
            break
    }
    return wf
}

/**
 * The `cases` row to insert. The loan figure goes in the column commission is
 * based on for that case type (caseLoanBase() in commission.ts): the existing
 * loan for refinancing / equity, loan_size otherwise.
 */
export function intakeToCaseRow(c: CaseIntake, createdBy: string, today: string = todaySgt()) {
    const usesExisting = c.case_type === 'Refinancing' || c.case_type === 'Equity Loan'
    return {
        created_by: createdBy,
        case_type: c.case_type,
        stage: c.stage,
        client_name: c.client_name,
        client_mobile: c.client_mobile,
        client_email: c.client_email ?? null,
        existing_loan_amount: usesExisting ? c.loan_amount ?? null : null,
        loan_size: usesExisting ? null : c.loan_amount ?? null,
        current_bank: c.current_bank ?? null,
        subsidy_provided: c.subsidy != null ? money$(c.subsidy) : null,
        property_address: c.property_address ?? null,
        property_type: c.property_type ?? null,
        property_price: c.property_value ?? null,
        lock_in_end_date: c.lock_in_end_date ?? null,
        // Every case needs a follow-up (followUps.ts). Left blank → 3 months
        // before a known lock-in end, else today, so it shows up in the Action Centre.
        follow_up_date: c.follow_up_date ?? defaultNewCaseFollowUp(c.lock_in_end_date, today),
        clawback_end_date: c.clawback_end_date ?? null,
        remarks: c.remarks ?? null,
        lead_source: c.lead_source ?? null,
        lead_source_other: c.lead_source_other ?? null,
        workflow_data: workflowPrefill(c),
    }
}

