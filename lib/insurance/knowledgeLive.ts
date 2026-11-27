/** Knowledge questions about today's figures, read from the HUB itself. No AI. */

import { getAllBenchmarks, getCurrentSora, type SoraRates } from '@/lib/insurance/sora'
import { loadPackages } from '@/lib/insurance/ratesCache'
import { loadPromotions } from '@/lib/insurance/promotionsCache'
import { isActive, todaySgt } from '@/lib/insurance/promotions'
import { formatRateEntry, isSoraStale } from '@/lib/insurance/rateSchedule'
import { fixedRateYears, shortLoan, stripBankPrefix } from '@/lib/insurance/rateFilters'
import { money } from '@/lib/insurance/knowledgeCalc'
import { effectiveRate } from '@/lib/insurance/rateRecommend'
import type { MortgagePackage, RateCategory } from '@/lib/types/rates'

export type LiveKind = 'sora' | 'rates' | 'promotions'
export interface LiveRow {
    title: string
    subtitle?: string
    facts: string[]
    detail?: string
    warn?: string
    value: string
    valueNote?: string
    big?: boolean
}
export interface LiveReply {
    kind: LiveKind
    title: string
    asOf?: string
    stats?: { label: string; value: string }[]
    rows?: LiveRow[]
    /** Several lists in one answer, each ranked. */
    sections?: { heading: string; rows: LiveRow[] }[]
    /** Rows are lowest first. */
    ranked?: boolean
    /** One tap to narrow the list; each is an ordinary question. */
    filters?: { label: string; question: string; on: boolean }[]
    warning?: string | null
    notes: string[]
    href: string
    hrefLabel: string
}

/** How agents write each bank → its name in the HUB's packages. */
const BANKS: [RegExp, string][] = [
    [/\b(dbs|posb)\b/, 'DBS'], [/\bocbc\b/, 'OCBC'], [/\buob\b/, 'UOB'], [/\bhsbc\b/, 'HSBC'], [/\bmaybank\b|\bmbb\b/, 'Maybank'],
    [/\b(scb|stan\s?chart|standard chartered)\b/, 'Standard Chartered'], [/\b(boc|bank of china)\b/, 'Bank of China'],
    [/\bciti(bank)?\b/, 'Citibank'], [/\brhb\b/, 'RHB'], [/\bcimb\b/, 'CIMB'], [/\b(hlf|hong leong)\b/, 'Hong Leong'], [/\b(sbi|state bank of india)\b/, 'State Bank of India'],
]
export const banksIn = (question: string) => BANKS.filter(([re]) => re.test(question.toLowerCase())).map(([, name]) => name)
const isBank = (p: { bank: string }, banks: string[]) => !banks.length || banks.some(b => b.toLowerCase() === p.bank.trim().toLowerCase())

export function detectLive(question: string): LiveKind | null {
    const q = question.toLowerCase()
    if (/promo(tion)?s?\b|cash rebate|campaign/.test(q) && !/clawback|return/.test(q)) return 'promotions'
    if (isRateQuestion(q)) return 'rates'
    if (/\bsora\b/.test(q) && /(current|latest|today|now|how much|rate\b)/.test(q) && !/fixed|\bvs\b|versus|spread|package/.test(q)) return 'sora'
    return null
}

const LOWEST = /\b(lowest|best|cheapest|current|latest|today|now)\b/
const FLOATING = /floating|variable rate|sora (rate|package|loan)s?\b/
const BUC = /\bbuc\b|under construction|uncompleted|new launch/

/** Bank package rates, as opposed to a rule that merely has "rate" in it. */
function isRateQuestion(q: string): boolean {
    if (!/\b(rates?|packages?)\b/.test(q) && !(FLOATING.test(q) && LOWEST.test(q))) return false
    if (!LOWEST.test(q) && !banksIn(q).length) return false
    if (/stamp|absd|\bbsd\b|\bssd\b|tdsr|\bmsr\b|stress|deposit|cpf|clawback|subsid|penalt|\bfees?\b|valuation|legal|income|haircut|calculat|instal|accrued|hdb('s)? (concessionary )?loan (interest )?rate|reference rate|thereafter/.test(q)) return false
    if (/\bsora\b/.test(q) && !/floating|package|fixed/.test(q) && !banksIn(q).length) return false
    // "Fixed or floating?" asks for an explanation, unless they want the lowest.
    if (/\b(or|vs|versus|difference|between)\b/.test(q) && !/lowest|cheapest/.test(q) && banksIn(q).length < 2) return false
    return true
}

const wantsHdb = (q: string) => /\bhdb\b/.test(q)
const wantsPrivate = (q: string) => /condo|private(?! (client|bank))|landed/.test(q)
const wantedYears = (q: string) => { const m = q.match(/\b([1-5])[\s-]*(?:years?|yrs?)\b/); return m ? +m[1] : null }
const wantsPriority = (q: string) => /priority|premier|treasures|citigold|privilege|private (client|bank)/.test(q)
function wantedCategories(q: string): RateCategory[] {
    if (BUC.test(q)) return ['BUC']
    const fixed = /fixed/.test(q), floating = FLOATING.test(q)
    return fixed === floating ? ['Fixed', 'Floating (Completed)', 'BUC'] : fixed ? ['Fixed'] : ['Floating (Completed)']
}

/** Only for special clients. "Priority Banking: min $500K" isn't: that is a lower minimum beside the normal one. */
export const isRestricted = (p: MortgagePackage) => !!p.restricted_to || !!p.min_loan_note && (/\bonly\b|aum|private client|citigold/i.test(p.min_loan_note) || !/\d/.test(p.min_loan_note))

/** Year 1 rate today; null when the HUB can't price it. */
const todayRate = (p: MortgagePackage, sora: SoraRates | null) => p.rate_schedule[0] ? effectiveRate(p.rate_schedule[0], sora).rate : null

/** The bank-set rate (such as FHR6) a package is priced from, if it is one of `keys`. */
const bankRateOf = (p: MortgagePackage, keys: string[]) => {
    const e = p.rate_schedule[0]
    return e?.type === 'floating' ? keys.find(k => (e.reference ?? '').toLowerCase().includes(k.toLowerCase())) : undefined
}

export interface RankedPackage { pkg: MortgagePackage; rate: number }

/** Each bank's lowest (or one named bank's packages), lowest first. */
export function lowestRates(packages: MortgagePackage[], category: RateCategory, question: string, sora: SoraRates | null, count = 5, staleKeys: string[] = []): RankedPackage[] {
    const q = question.toLowerCase()
    const years = wantedYears(q)
    const banks = banksIn(q)
    const loan = money(q)
    return packages
        .filter(p => p.status === 'published' && p.category === category
            && (category !== 'Fixed' || p.rate_schedule[0]?.type === 'fixed')
            && (wantsPriority(q) || !isRestricted(p))
            && isBank(p, banks) && (loan == null || p.min_loan_size <= loan)
            && (!/\bno lock/.test(q) || p.lockin_years === 0)
            && (!wantsHdb(q) || /hdb/i.test(p.property_type))
            && (!wantsPrivate(q) || /private/i.test(p.property_type))
            && (!years || (category !== 'Fixed' || /lock/.test(q) ? p.lockin_years : fixedRateYears(p)) === years))
        .flatMap(pkg => { const rate = todayRate(pkg, sora); return rate == null ? [] : [{ pkg, rate }] })
        // A price resting on an outdated bank rate never outranks a current one.
        .sort((a, b) => Number(bankRateOf(a.pkg, staleKeys) != null) - Number(bankRateOf(b.pkg, staleKeys) != null) || a.rate - b.rate || a.pkg.min_loan_size - b.pkg.min_loan_size)
        .filter((x, i, all) => banks.length === 1 || all.findIndex(y => y.pkg.bank === x.pkg.bank) === i)
        .slice(0, count)
}

export const niceDate = (ymd: string) => new Date(`${ymd.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

const HEADING: Record<RateCategory, string> = { Fixed: 'Fixed', 'Floating (Completed)': 'Floating', BUC: 'Under construction (BUC)' }

export function ratesReply(packages: MortgagePackage[], question: string, sora: SoraRates | null, benchmarkDates: Record<string, string> = {}, today = todaySgt()): LiveReply {
    const q = question.toLowerCase()
    const categories = wantedCategories(q)
    const only = categories.length === 1 ? categories[0] : null
    const oldBefore = new Date(Date.parse(today) - 30 * 86_400_000).toISOString().slice(0, 10)
    const staleKeys = Object.keys(benchmarkDates).filter(k => benchmarkDates[k].slice(0, 10) < oldBefore)
    const groups = categories.map(c => ({ c, top: lowestRates(packages, c, question, sora, only ? 5 : 3, staleKeys) })).filter(g => g.top.length)
    const all = groups.flatMap(g => g.top)
    const years = wantedYears(q)
    const type = wantsHdb(q) ? 'hdb' : wantsPrivate(q) ? 'private' : ''
    const banks = banksIn(q)
    const loan = money(q)
    const noLock = /\bno lock/.test(q)
    const priority = wantsPriority(q)
    const lock = /lock/.test(q) && !noLock
    const word = only === 'Fixed' ? 'fixed' : only === 'BUC' ? 'buc' : only ? 'floating' : ''
    // A filter keeps everything else the agent asked for; tapping a chosen one removes it.
    const ask = (o: { word?: string; type?: string; years?: number | null; priority?: boolean }) => {
        const x = { word, type, years, priority, ...o }
        return [banks.join(' '), 'lowest', x.years && `${x.years} year${lock ? ' lock-in' : ''}`, x.word, 'rate', noLock && 'no lock-in', x.type && `for ${x.type}`, x.priority && 'priority banking', loan && `loan $${loan}`, 'now'].filter(Boolean).join(' ')
    }
    const chip = (label: string, on: boolean, o: Parameters<typeof ask>[0], off: Parameters<typeof ask>[0]) => ({ label, on, question: ask(on ? off : o) })

    const dates = all.map(x => x.pkg.last_updated).sort()
    const allOld = dates.length > 0 && dates.every(d => d < oldBefore)
    const floats = all.some(x => x.pkg.rate_schedule[0].type === 'floating')
    const soraOld = floats && isSoraStale(sora?.value_date)
    const scope = [banks.join(' and '), years && `${years}-year${lock || (only && only !== 'Fixed') ? ' lock-in' : ''}`, type === 'hdb' ? 'HDB' : type === 'private' ? 'private property' : '', noLock && 'no lock-in', loan && `${shortLoan(loan)} loan`].filter(Boolean).join(', ')

    const row = ({ pkg: p, rate }: RankedPackage): LiveRow => {
        const first = p.rate_schedule[0]
        const stale = bankRateOf(p, staleKeys)
        return {
            title: p.bank,
            subtitle: stripBankPrefix(p.package_name, p.bank),
            facts: [
                p.lockin_years ? `${p.lockin_years}-year lock-in` : 'No lock-in',
                ...(p.min_loan_size ? [`Loan from ${shortLoan(p.min_loan_size)}`] : []),
                ...(p.min_loan_note ? [p.min_loan_note] : []),
                p.property_type,
            ],
            detail: p.rate_schedule.slice(first.type === 'floating' ? 0 : 1).map(formatRateEntry).join(' · ') || undefined,
            warn: [
                stale && `${stale} last set ${niceDate(benchmarkDates[stale])}`,
                p.last_updated < oldBefore && !allOld && `Updated ${niceDate(p.last_updated)}`,
            ].filter(Boolean).join(' · ') || undefined,
            value: `${rate.toFixed(2)}%`, valueNote: first.type === 'floating' ? 'year 1, today' : 'year 1', big: true,
        }
    }
    const name = only ? `Lowest ${only === 'BUC' ? 'BUC' : HEADING[only].toLowerCase()} rates` : 'Lowest rates'
    return {
        kind: 'rates', ranked: true,
        title: `${name}${scope ? `: ${scope}` : ''}`,
        filters: [
            chip('Fixed', only === 'Fixed', { word: 'fixed' }, { word: '', years: null }),
            chip('Floating', only === 'Floating (Completed)', { word: 'floating', years: null }, { word: '' }),
            chip('BUC', only === 'BUC', { word: 'buc', years: null }, { word: '' }),
            chip('HDB', type === 'hdb', { type: 'hdb' }, { type: '' }),
            chip('Private', type === 'private', { type: 'private' }, { type: '' }),
            ...(only === 'Fixed' ? [1, 2, 3].map(y => chip(`${y}-year`, years === y, { years: y }, { years: null })) : []),
            chip('Priority banking', priority, { priority: true }, { priority: false }),
        ],
        ...(only ? { rows: groups[0]?.top.map(row) ?? [] } : { sections: groups.map(g => ({ heading: HEADING[g.c], rows: g.top.map(row) })) }),
        warning: [
            allOld && `These rates were last updated ${[...new Set([dates[0], dates.at(-1)!])].map(niceDate).join(' to ')}. Confirm with the bank before quoting.`,
            soraOld && `SORA is from ${niceDate(sora!.value_date)}, so floating rates may be out of date.`,
        ].filter(Boolean).join(' ') || null,
        notes: all.length ? [
            `${banks.length === 1 ? 'Lowest year 1 rate first.' : 'Each bank’s lowest year 1 rate.'}${loan ? '' : ' Smaller loans may get a higher rate.'} Check the full package before quoting.`,
            ...(floats && sora ? [`Floating rates use SORA on ${niceDate(sora.value_date)} and move with it. 1M/3M SORA uses the lower one.`] : []),
            ...(priority ? [] : ['Packages only for priority banking clients are left out.']),
        ] : [`The HUB has no matching package${banks.length ? ` from ${banks.join(' or ')}` : ''}. Try another filter.`],
        href: '/insurance/dashboard/rates', hrefLabel: 'See all packages',
    }
}

/**
 * The SORA figures a question asks for: "3M SORA" gets only 3M, "1M or 3M SORA"
 * both, plain "SORA" all three. Answer what was asked, not everything we have.
 */
export function soraReply(s: SoraRates, question: string): LiveReply {
    const q = question.toLowerCase()
    const p = (n: number | null) => n == null ? '–' : `${n.toFixed(4)}%`
    const all = [
        { key: '1m', ask: /\b(1|one)[\s-]?m(th|onth)?s?\b/, short: '1M SORA', label: '1-month compounded', value: p(s.comp_sora_1m) },
        { key: '3m', ask: /\b(3|three)[\s-]?m(th|onth)?s?\b/, short: '3M SORA', label: '3-month compounded', value: p(s.comp_sora_3m) },
        { key: 'daily', ask: /\b(daily|overnight|o\/n)\b/, short: 'Daily SORA', label: 'Daily', value: p(s.sora) },
        // Rarely used for home loans: shown only when asked for.
        { key: '6m', ask: /\b(6|six)[\s-]?m(th|onth)?s?\b/, short: '6M SORA', label: '6-month compounded', value: p(s.comp_sora_6m), onlyIfAsked: true },
    ]
    // "1M/3M SORA" names both, so "1m/3m" is split before matching.
    const asked = all.filter(x => x.ask.test(q.replace(/\//g, ' ')))
    const shown = asked.length ? asked : all.filter(x => !('onlyIfAsked' in x))
    return {
        kind: 'sora', title: asked.length === 1 ? asked[0].short : 'SORA', asOf: niceDate(s.value_date),
        href: '/insurance/dashboard/rates', hrefLabel: asked.length ? 'All SORA rates' : 'Open Rates',
        stats: shown.map(({ label, value }) => ({ label, value })),
        warning: isSoraStale(s.value_date) ? 'This figure is more than 5 days old. Check MAS before quoting.' : null,
        notes: ['Source: MAS.'],
    }
}

export async function runLive(kind: LiveKind, question: string): Promise<LiveReply | null> {
    if (kind === 'sora') {
        const s = await getCurrentSora()
        return s ? soraReply(s, question) : null
    }
    if (kind === 'rates') {
        const [packages, sora, marks] = await Promise.all([loadPackages(), getCurrentSora(), getAllBenchmarks()])
        return ratesReply(packages, question, sora, Object.fromEntries(marks.map(m => [m.key, m.updated_at ?? ''])))
    }
    const banks = banksIn(question)
    const open = (await loadPromotions()).filter(p => p.status === 'published' && isActive(p) && isBank(p, banks))
    return {
        kind, title: open.length ? `${banks.join(' and ') || 'Bank'} promotions open today` : `No ${banks.join(' or ') || 'bank'} promotions are open today`, asOf: niceDate(todaySgt()),
        href: '/insurance/dashboard/rates', hrefLabel: 'Open Rates',
        rows: open.map(p => ({
            title: p.bank, subtitle: p.title, facts: [],
            warn: p.audience === 'agent' ? 'Agent only. Do not show clients.' : undefined,
            value: p.ends_on ? niceDate(p.ends_on) : 'Open-ended', valueNote: p.ends_on ? 'last day' : undefined,
        })),
        notes: open.length ? ['Check each promotion’s conditions before quoting.'] : [],
    }
}
