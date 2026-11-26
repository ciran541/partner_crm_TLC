// Groups a bank's packages into "ladders": one product (e.g. SCB 2Y Fixed) with a
// step per loan size. Also finds packages that look wrong. Pure, no AI, no writes.

import type { MortgagePackage, RateScheduleEntry } from '@/lib/types/rates'
import { isExpired, restrictedTo } from '@/lib/insurance/rateFilters'

export interface LadderIssue { level: 'check' | 'info'; packageIds: string[]; text: string }

export interface RateLadder {
    key: string
    bank: string
    category: string
    label: string
    lockinYears: number
    steps: MortgagePackage[]
    sharedFeatures: string[]
    issues: LadderIssue[]
}

const STALE_DAYS = 30
export const money = (n: number) => n >= 1e6 ? `${n / 1e6}m` : `${n / 1e3}k`
export const normFeature = (f: string) => f.toLowerCase().replace(/[^a-z0-9%$]/g, '')

const fixedYears = (p: MortgagePackage) => p.rate_schedule.filter(e => e.type === 'fixed' && !e.thereafter).length

/** "3Y Fixed" / "3 Years Fixed" in the name. "Fixed Rates 2 Years Lock-In" states the lock-in, so it doesn't count. */
export function namedFixedYears(name: string): number | null {
    const m = name.match(/(\d)\s*-?\s*y(?:ears?|rs?)?\s*fixed/i)
    return m ? Number(m[1]) : null
}

/** Months until free conversion: 0 = anytime, null = none stated. */
export function conversionMonths(p: Pick<MortgagePackage, 'features' | 'lockin_years'>): number | null {
    const f = p.features.find(x => /conver/i.test(x))
    if (!f) return null
    const m = f.match(/conver\D*?(\d+)\s*months?/i)
    if (m) return Number(m[1])
    return /after lock/i.test(f) ? p.lockin_years * 12 : 0
}

const tag = (p: MortgagePackage): string => [
    /\bflex/i.test(p.package_name) && 'Flex',
    /green/i.test(p.package_name) && 'Green',
    /hdb\s*(only|exclusive)/i.test(p.package_name) && 'HDB only',
].filter(Boolean).join(' ')

const yearOneRef = (p: MortgagePackage) => p.rate_schedule.find(e => e.type === 'floating')?.reference ?? ''

function productLabel(p: MortgagePackage): string {
    if (p.product) return p.product
    const years = namedFixedYears(p.package_name) ?? fixedYears(p)
    const base = p.category === 'Fixed'
        ? (years ? `${years}Y Fixed` : 'Fixed')
        : `${yearOneRef(p)} ${p.category === 'BUC' ? 'BUC' : 'Floating'}`
    return [base, tag(p)].filter(Boolean).join(' ')
}

export const overlap = (a: string, b: string) => a === b
    || (a === 'HDB / Private' && b !== 'Executive Condominium')
    || (b === 'HDB / Private' && a !== 'Executive Condominium')
const sameBuyer = (a: MortgagePackage, b: MortgagePackage) =>
    restrictedTo(a) === restrictedTo(b) && overlap(a.property_type, b.property_type)
const sameStep = (a: MortgagePackage, b: MortgagePackage) =>
    Number(a.min_loan_size) === Number(b.min_loan_size) && sameBuyer(a, b)

function pairs<T>(xs: T[]): [T, T][] {
    return xs.flatMap((a, i) => xs.slice(i + 1).map(b => [a, b] as [T, T]))
}

const firstEntry = (p: MortgagePackage) => p.rate_schedule.find(e => !e.thereafter)
function cost(e: RateScheduleEntry): number | undefined {
    if (e.type === 'fixed') return e.rate
    if (e.spread == null) return undefined
    return e.spreadSign === '-' ? -e.spread : e.spread
}
const comparable = (a: RateScheduleEntry, b: RateScheduleEntry) =>
    a.type === b.type && (a.type === 'fixed' || a.reference === b.reference)

export function buildLadders(packages: MortgagePackage[], today: string): RateLadder[] {
    const groups = new Map<string, MortgagePackage[]>()
    const add = (m: Map<string, MortgagePackage[]>, k: string, p: MortgagePackage) => m.set(k, [...(m.get(k) ?? []), p])
    for (const p of packages) add(groups, [p.bank, p.category, productLabel(p), p.lockin_years].join('|'), p)

    const out: RateLadder[] = []
    for (const [key, group] of groups) {
        // Two packages on one step means two products; the conversion term tells them apart.
        const clash = !group[0].product && pairs(group).some(([a, b]) => sameStep(a, b) && conversionMonths(a) !== conversionMonths(b))
        const split = new Map<string, MortgagePackage[]>()
        for (const p of group) add(split, clash ? String(conversionMonths(p)) : '', p)
        for (const [suffix, steps] of split) out.push(toLadder(suffix ? `${key}|${suffix}` : key, suffix, steps, today))
    }
    return out.sort((a, b) =>
        a.bank.localeCompare(b.bank) || a.category.localeCompare(b.category) || a.label.localeCompare(b.label))
}

function conversionLabel(suffix: string): string {
    if (suffix === '') return ''
    if (suffix === 'null') return ' (no conversion)'
    return suffix === '0' ? ' (convert anytime)' : ` (convert after ${suffix}m)`
}

function toLadder(key: string, suffix: string, unsorted: MortgagePackage[], today: string): RateLadder {
    const steps = [...unsorted].sort((a, b) => Number(a.min_loan_size) - Number(b.min_loan_size))
    const first = steps[0]
    return {
        key,
        bank: first.bank,
        category: first.category,
        lockinYears: first.lockin_years,
        label: productLabel(first) + conversionLabel(suffix),
        steps,
        sharedFeatures: first.features.filter(f => steps.every(s => s.features.some(x => normFeature(x) === normFeature(f)))),
        issues: findIssues(steps, today),
    }
}

function findIssues(steps: MortgagePackage[], today: string): LadderIssue[] {
    const issues: LadderIssue[] = []
    const check = (ps: MortgagePackage[], text: string) =>
        issues.push({ level: 'check', packageIds: ps.map(p => p.id), text })

    for (const p of steps) {
        const at = money(Number(p.min_loan_size))
        const named = namedFixedYears(p.package_name)
        const actual = fixedYears(p)
        if (named != null && named !== actual) check([p], `${at}: the name says ${named}Y fixed, but fixed years saved = ${actual}`)
        if (p.category === 'Fixed' && named == null && actual === 0) check([p], `${at}: saved as Fixed with no fixed year`)
        if (!Number(p.min_loan_size)) check([p], 'No minimum loan saved')
        if (!p.rate_schedule.some(e => e.thereafter)) check([p], `${at}: no thereafter rate`)
        const refs = [...new Set(p.rate_schedule.filter(e => e.type === 'floating').map(e => e.reference))]
        if (refs.length > 1) check([p], `${at}: the benchmark changes within the package (${refs.join(', then ')})`)
        if (p.features.some(f => /expir/i.test(f))) check([p], `${at}: marked as expiring`)
        const who = restrictedTo(p)
        if (who) issues.push({ level: 'info', packageIds: [p.id], text: `${at}: only for ${who}` })
        if (isExpired(p, today)) check([p], `${at}: the rate ended on ${p.valid_until}`)
    }

    for (const [a, b] of pairs(steps)) {
        const at = money(Number(a.min_loan_size))
        if (sameStep(a, b)) { check([a, b], `${at}: two packages on the same step`); continue }
        const ea = firstEntry(a)
        const eb = firstEntry(b)
        if (!ea || !eb || a.min_loan_size === b.min_loan_size || !sameBuyer(a, b) || !comparable(ea, eb)) continue
        const ca = cost(ea)
        const cb = cost(eb)
        if (ca != null && cb != null && ca < cb) check([a, b], `${at} (${ca}) is cheaper than ${money(Number(b.min_loan_size))} (${cb})`)
    }

    const ta = [...new Set(steps.map(s => s.rate_schedule.find(e => e.thereafter)?.reference).filter(Boolean))]
    if (ta.length > 1) check(steps, `Thereafter uses different benchmarks across steps (${ta.join(', ')})`)

    const oldest = steps.map(s => s.confirmed_on ?? s.last_updated).sort()[0]
    const days = Math.floor((Date.parse(today) - Date.parse(oldest)) / 86_400_000)
    if (days > STALE_DAYS) issues.push({ level: 'info', packageIds: [], text: `Last confirmed ${oldest} (${days} days ago)` })
    return issues
}
