/**
 * Knowledge questions that are sums, answered by the HUB's own calculators and
 * never by AI. Recognises the question, reads the figures in it, and asks for
 * the ones that are missing.
 */

import { absdRate, computeBsdBreakdown, type Residency } from '@/lib/insurance/stampDuty'
import { CANCELLATION_FEE_RATE, MIN_TENURE, monthlyInstallment } from '@/lib/insurance/loanCalc'
import { computePurchase, locksOutstandingToZero, OPTION_MATRIX, optionTenure, propertyMeta, PURCHASE_PROPERTY_TYPES, type OutstandingLoans, type PurchasePropertyType } from '@/lib/insurance/purchaseCalc'
import { REFI_PROPERTY_TYPES, refiPropertyMeta, tenureRange, type RefiPropertyType } from '@/lib/insurance/refiCalc'

export interface CalcField { key: string; label: string; type: 'number' | 'select'; options?: { value: string; label: string }[]; min?: number; max?: number }
export type CalcKind = 'tenure_buy' | 'tenure_refi' | 'bsd' | 'absd' | 'cancellation' | 'instalment' | 'max_loan'
export const CALC_KINDS: CalcKind[] = ['tenure_buy', 'tenure_refi', 'bsd', 'absd', 'cancellation', 'instalment', 'max_loan']
export type CalcValues = Record<string, string | number>
/** `main` = the answer itself; the rest is how it was reached. */
export interface CalcLine { label: string; value: string; main?: boolean }
export interface CalcReply {
    kind: CalcKind
    title: string
    fields: CalcField[]
    values: CalcValues
    missing: string[]
    result: { lines: CalcLine[]; notes: string[] } | null
    error: string | null
}

const num = (key: string, label: string, min: number, max: number): CalcField => ({ key, label, type: 'number', min, max })
const sel = (key: string, label: string, options: { value: string; label: string }[]): CalcField => ({ key, label, type: 'select', options })

const BUY = sel('property', 'Property', PURCHASE_PROPERTY_TYPES.map(p => ({ value: p.value, label: p.label })))
const AGE = num('age', "Borrower's age", 21, 100)
const LOANS = sel('loans', 'Existing housing loans', [{ value: '0', label: 'None' }, { value: '1', label: '1' }, { value: '2plus', label: '2 or more' }])
const PRICE = num('price', 'Property price ($)', 1000, 500_000_000)
const LOAN = num('loan', 'Loan amount ($)', 1000, 500_000_000)

const FIELDS: Record<CalcKind, { title: string; fields: CalcField[] }> = {
    tenure_buy: { title: 'Longest loan tenure: buying', fields: [BUY, AGE] },
    tenure_refi: { title: 'Longest loan tenure: refinancing', fields: [sel('refi_property', 'Property', REFI_PROPERTY_TYPES.map(p => ({ value: p.value, label: p.label }))), AGE, num('year', 'Year of purchase', 1960, 2100)] },
    bsd: { title: "Buyer's Stamp Duty (residential)", fields: [PRICE] },
    absd: { title: "Additional Buyer's Stamp Duty", fields: [PRICE, sel('residency', 'Buyer', [{ value: 'singaporean', label: 'Singapore Citizen' }, { value: 'pr', label: 'Permanent Resident' }, { value: 'foreigner', label: 'Foreigner' }]), sel('count', 'This will be their', [{ value: '1', label: '1st home' }, { value: '2', label: '2nd home' }, { value: '3', label: '3rd or later' }])] },
    cancellation: { title: 'Cancellation fee on an undisbursed loan', fields: [num('undisbursed', 'Undisbursed amount ($)', 1, 500_000_000)] },
    instalment: { title: 'Monthly instalment', fields: [LOAN, num('rate', 'Interest rate (% a year)', 0.01, 20), num('years', 'Tenure (years)', 1, 35)] },
    max_loan: { title: 'Loan amount for a purchase', fields: [BUY, PRICE, num('income', 'Fixed monthly income, all borrowers ($)', 1, 10_000_000), num('debts', 'Monthly debt payments ($, 0 if none)', 0, 10_000_000), num('age', "Borrower's age (weighted if several)", 21, 100), LOANS] },
}

/** Which sum the question is, or null when it isn't one or isn't a plain case. */
export function detectCalc(question: string): CalcKind | null {
    const q = question.toLowerCase()
    // The calculators behind these need far more than a question can hold.
    if (/decoupl|equity|cash[\s-]?out|divorce|commercial|industrial|pledge|show fund/.test(q)) return null
    const asksAmount = /how much|calculate|work out|compute|amount|what('?s| is| will)?\b.*\b(fee|payable)/.test(q)
    const hasFigure = /\d/.test(q.replace(/\b(1st|2nd|3rd|[13]m sora)\b/g, ''))

    if (/cancel+ation|undisbursed/.test(q) && (hasFigure || /how much/.test(q))) return 'cancellation'
    if (/\babsd\b|additional buyer/.test(q)) {
        // Couple relief and nationality agreements decide these, not a rate table.
        if (/married|spouse|husband|wife|couple|joint|together|co-?own|american|\bus\b|u\.s|usa|swiss|switzerland|norw|iceland|liechtenstein|compan|entity|trust|remission|refund/.test(q)) return null
        return money(q) != null ? 'absd' : null
    }
    if (/\bbsd\b|buyer'?s stamp duty/.test(q)) return money(q) != null || /how much/.test(q) ? 'bsd' : null
    if (/instal+ment|monthly (re)?payment/.test(q) && (asksAmount || hasFigure) && !/tdsr|msr/.test(q)) return 'instalment'
    if (/tenure|how long.*loan|loan.*how long/.test(q) && (ageIn(q) != null || /\bmy client\b|\bage\b/.test(q)) && !/minimum|lock/.test(q)) {
        return /refi|repric/.test(q) ? 'tenure_refi' : 'tenure_buy'
    }
    if (/how much (can|could|loan|will)|how much.*(borrow|loan)|(max\w*|highest) loan (amount|size|for my)|loan eligib/.test(q) && !/refi|subsid|fee|cost|cash|minimum|existing/.test(q) && /loan|borrow|lend/.test(q)) return 'max_loan'
    return null
}

/** "$1.2m", "300k", "1,500,000". A bare small number is not money. */
export function money(q: string): number | null {
    for (const m of q.toLowerCase().matchAll(/(\$|s\$|sgd)?\s*(\d[\d,]*(?:\.\d+)?)\s*(million|mil|m|k|thousand)?\b(?!\s*sora)/g)) {
        const n = parseFloat(m[2].replace(/,/g, '')) * (!m[3] ? 1 : m[3][0] === 'm' ? 1e6 : 1e3)
        if (n >= 10_000) return Math.round(n * 100) / 100
    }
    return null
}

function ageIn(q: string): number | null {
    const m = q.match(/(?:age[ds]?|is|who'?s)\s*(?:is|of|=|:)?\s*(\d{2})\b(?!\s*(%|k|m\b|year tenure|yr tenure))/) ?? q.match(/\b(\d{2})\s*(?:years?|yrs?|yo|y\/o)[\s-]*old/) ?? q.match(/\b(\d{2})\s*yo\b/)
    const n = m ? +m[1] : null
    return n != null && n >= 21 && n <= 100 ? n : null
}

function readValues(kind: CalcKind, question: string): CalcValues {
    const q = question.toLowerCase()
    const v: CalcValues = {}
    const amount = money(q)
    const age = ageIn(q)
    if (age != null) v.age = age
    if (amount != null) {
        if (kind === 'cancellation') v.undisbursed = amount
        else if (kind === 'instalment') v.loan = amount
        else if (kind === 'bsd' || kind === 'absd') v.price = amount
        // max_loan: one figure could be a price or an income, so it is asked.
    }
    if (kind === 'instalment') {
        const rate = q.match(/(\d+(?:\.\d+)?)\s*%/)
        const years = q.match(/\b(\d{1,2})\s*(?:years?|yrs?)\b/)
        if (rate) v.rate = +rate[1]
        if (years) v.years = +years[1]
    }
    if (kind === 'absd') {
        if (/foreigner|expat/.test(q)) v.residency = 'foreigner'
        else if (/\b(s?pr|permanent resident)\b/.test(q)) v.residency = 'pr'
        else if (/singaporean|citizen|\bsc\b/.test(q)) v.residency = 'singaporean'
        if (/\b(1st|first)\b/.test(q)) v.count = '1'
        else if (/\b(2nd|second)\b/.test(q)) v.count = '2'
        else if (/\b(3rd|third)\b/.test(q)) v.count = '3'
        else if (v.residency === 'foreigner') v.count = '1' // same rate for every home
    }
    // Only names that fit one property type; "HDB" could be BTO or resale.
    if (kind === 'tenure_buy' || kind === 'max_loan') {
        if (/\bbto\b/.test(q)) v.property = 'bto'
        else if (/resale (hdb|flat)|hdb resale/.test(q)) v.property = 'resale_hdb'
        else if (/resale condo/.test(q)) v.property = 'resale_condo'
        else if (/new launch condo/.test(q)) v.property = 'new_launch_condo'
        else if (/landed/.test(q)) v.property = 'resale_landed'
    }
    if (kind === 'tenure_refi') {
        if (/\bhdb\b/.test(q)) v.refi_property = 'hdb'
        else if (/landed/.test(q)) v.refi_property = 'landed'
        const year = q.match(/\b(19[6-9]\d|20[0-4]\d)\b/)
        if (year) v.year = +year[1]
    }
    return v
}

const $ = (n: number) => '$' + n.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const $0 = (n: number) => $(Math.floor(n))
const pct = (n: number) => `${+(n * 100).toFixed(2)}%`

/** `given` (the form) wins over what was read from the question. */
export function runCalc(kind: CalcKind, question: string, given: CalcValues = {}, currentYear = new Date().getFullYear()): CalcReply {
    const { title, fields } = FIELDS[kind]
    const raw = { ...readValues(kind, question), ...given }
    const values: CalcValues = {}
    for (const f of fields) {
        const x = raw[f.key]
        if (x === undefined || x === '' || x === null) continue
        if (f.type === 'select') { if (f.options!.some(o => o.value === String(x))) values[f.key] = String(x) }
        else { const n = Number(x); if (Number.isFinite(n) && n >= f.min! && n <= f.max!) values[f.key] = n }
    }
    const missing = fields.filter(f => values[f.key] === undefined).map(f => f.key)
    const reply: CalcReply = { kind, title, fields, values, missing, result: null, error: null }
    if (missing.length) return reply
    const n = (k: string) => Number(values[k])
    const lines: CalcLine[] = []
    const notes: string[] = []

    if (kind === 'bsd') {
        const { total, tiers } = computeBsdBreakdown(n('price'))
        for (const t of tiers) lines.push({ label: `${t.label} at ${pct(t.rate)}`, value: $(t.amount) })
        lines.push({ label: 'Total BSD', value: $0(total), main: true })
        notes.push('Residential property. Based on the price entered: IRAS uses the higher of price and market value.')
    } else if (kind === 'absd') {
        const r = values.residency as Residency
        const rate = absdRate(r, n('count') as 1 | 2 | 3)
        lines.push({ label: 'ABSD rate', value: pct(rate) }, { label: 'ABSD', value: $0(n('price') * rate), main: true })
        notes.push('One buyer, not a joint purchase. Couples may qualify for relief.')
        if (r === 'foreigner') notes.push('Some nationalities get Singapore Citizen treatment under trade agreements. Check the passport with IRAS rules first.')
    } else if (kind === 'cancellation') {
        lines.push({ label: `Fee at ${pct(CANCELLATION_FEE_RATE)}`, value: $(n('undisbursed') * CANCELLATION_FEE_RATE), main: true })
        notes.push('The usual rate used by the HUB. Confirm it in the client’s Letter of Offer.')
    } else if (kind === 'instalment') {
        lines.push({ label: 'Monthly instalment', value: $(Math.round(monthlyInstallment(n('loan'), n('rate'), n('years')) * 100) / 100), main: true })
        notes.push('Assumes the rate stays the same for the whole tenure.')
    } else if (kind === 'tenure_buy') {
        const type = values.property as PurchasePropertyType
        const meta = propertyMeta(type)!
        OPTION_MATRIX['0'].forEach((o, i) => {
            const t = optionTenure(o, meta.hdbClass, Math.ceil(n('age')))
            const all = locksOutstandingToZero(type) ? [o.ltvPct] : (['0', '1', '2plus'] as const).map(k => OPTION_MATRIX[k][i].ltvPct)
            lines.push({ label: `Option ${o.key}: loan up to ${all.map(pct).join(' / ')}${all.length > 1 ? ' (0 / 1 / 2+ housing loans)' : ''}`, value: t < MIN_TENURE ? 'Not available' : `${t} years`, main: true })
        })
        notes.push('Option 1 ends by age 65, Option 2 by age 75. With several borrowers, use the income-weighted age.')
    } else if (kind === 'tenure_refi') {
        if (n('year') > currentYear) return { ...reply, error: "Year of purchase can't be in the future." }
        const t = tenureRange({ ageForTenure: n('age'), tenureCap: refiPropertyMeta(values.refi_property as RefiPropertyType)!.tenureCap, yearOfPurchase: n('year'), currentYear })
        if (t.error) return { ...reply, error: t.error }
        lines.push({ label: 'By age', value: `${t.result1} years` }, { label: 'By year of purchase', value: `${t.result2} years` }, { label: 'Longest tenure (the shorter)', value: `${t.max} years`, main: true })
        notes.push('With several borrowers, use the income-weighted age.')
    } else {
        const type = values.property as PurchasePropertyType
        const c = computePurchase({
            propertyType: type, propertyPrice: n('price'), outstanding: values.loans as OutstandingLoans,
            borrowers: [{ employment: 'employed', basicSalary: n('income'), age: n('age'), commitments: n('debts') }],
        })
        if (locksOutstandingToZero(type) && values.loans !== '0') notes.push('For this property type the HUB counts existing housing loans as none.')
        for (const o of c.options) {
            if (o.tenure < MIN_TENURE) { lines.push({ label: `Option ${o.key}`, value: 'Not available at this age', main: true }); continue }
            lines.push({ label: `Option ${o.key}: ${o.tenure} years, up to ${pct(o.ltvPct)}`, value: $0(o.finalLoan), main: true },
                { label: `Option ${o.key} limited by`, value: o.finalLoan < o.ltvCeiling - 1 ? 'Income' : 'Loan-to-value limit' })
        }
        notes.push('Tested at 4%. If the package’s later (“thereafter”) rate is higher, banks test at that rate and the loan is smaller.',
            'Fixed income only: variable and rental income count at 70%. The bank decides the final amount.')
    }
    return { ...reply, result: { lines, notes } }
}
