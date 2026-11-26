// Turns what a banker SAID (read by AI, see readRateMessage.ts) into proposed changes
// to the master. Matching, carry-forward and checks are plain code: free, testable,
// and unable to invent a rate. Nothing here saves anything.

import type { MortgagePackage, RateCategory, RateScheduleEntry } from '@/lib/types/rates'
import { PROPERTY_TYPES } from '@/lib/types/rates'
import { cleanReference, deriveFirstYearRate, formatRateEntry } from '@/lib/insurance/rateSchedule'
import { restrictedTo } from '@/lib/insurance/rateFilters'
import { buildLadders, conversionMonths, money, normFeature, overlap, type RateLadder } from '@/lib/insurance/rateLadders'

// ── What the AI read ────────────────────────────────────────────────────────

export interface ReadItem {
    action: 'offer' | 'remove'
    name: string
    category: RateCategory
    fixed_years: number | null
    lockin_years: number | null       // null = not stated
    reference: string | null
    property_type: string | null      // null = not stated
    min_loan: number | null           // null = not stated
    priority_min_loan: number | null
    restricted_to: string | null
    rates: RateScheduleEntry[]
    features: string[]
    lines: number[]                   // source lines (text messages only)
}

export interface RateRead {
    scope: 'full' | 'partial' | 'unclear'
    categories: RateCategory[]
    valid_until: string | null
    notes: string[]
    ignored: { text: string; lines: number[] }[]
    items: ReadItem[]
}

const CATEGORIES: RateCategory[] = ['Fixed', 'Floating (Completed)', 'BUC']

/** "200K", "1.5m", "$500,000" → SGD; null when there is no number. */
export function parseMinSize(token: unknown): number | null {
    const m = String(token ?? '').replace(/[,$\s<>≥]/g, '').toLowerCase().match(/^(\d+(?:\.\d+)?)(k|mil|m)?/)
    if (!m) return null
    return Math.round(parseFloat(m[1]) * (m[2] === 'k' ? 1_000 : m[2] ? 1_000_000 : 1))
}

const num = (v: unknown): number | null => v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null
const str = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : []
const ints = (v: unknown) => arr(v).map(Number).filter(Number.isInteger)

function toRates(v: unknown): RateScheduleEntry[] {
    const out: RateScheduleEntry[] = []
    for (const x of arr(v) as Record<string, unknown>[]) {
        const rate = num(x?.rate), spread = num(x?.spread), ref = str(x?.reference)
        const entry: RateScheduleEntry = ref || spread != null
            ? { type: 'floating', ...(ref ? { reference: cleanReference(ref) } : {}), ...(spread != null ? { spread: Math.abs(spread), ...(spread < 0 ? { spreadSign: '-' as const } : {}) } : {}) }
            : { type: 'fixed', ...(rate != null ? { rate } : {}) }
        if (x?.thereafter === true) { out.push({ ...entry, thereafter: true }); continue }
        const year = num(x?.year)
        if (year != null && year >= 1 && year <= 10) out.push({ ...entry, year })
    }
    return out
}

/** The model's reply → a clean RateRead. Never fills in anything that wasn't stated. */
export function normalizeRead(raw: unknown): RateRead | null {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    if (!Array.isArray(o.items)) return null
    const items: ReadItem[] = (o.items as Record<string, unknown>[]).flatMap(x => {
        const category = CATEGORIES.find(c => c === x?.category)
        if (!category) return []
        const base: Omit<ReadItem, 'property_type' | 'min_loan'> = {
            action: x.action === 'remove' ? 'remove' : 'offer',
            name: str(x.name) ?? '',
            category,
            fixed_years: num(x.fixed_years),
            lockin_years: num(x.lockin_years),
            reference: str(x.reference) ? cleanReference(String(x.reference)) : null,
            priority_min_loan: parseMinSize(x.priority_min),
            restricted_to: str(x.restricted_to),
            rates: toRates(x.rates),
            features: arr(x.features).map(f => String(f).trim()).filter(Boolean),
            lines: ints(x.lines),
        }
        // One item per property type, so "HDB (Min 200K) / PTE (Min 300K)" can't lose a row.
        const mins = arr(x.mins) as Record<string, unknown>[]
        return (mins.length ? mins : [{}]).map(m => ({
            ...base,
            rates: base.rates.map(r => ({ ...r })),
            property_type: PROPERTY_TYPES.find(p => p === m?.property_type) ?? null,
            min_loan: parseMinSize(m?.min),
        }))
    })
    const valid = str(o.valid_until)
    return {
        scope: o.scope === 'full' || o.scope === 'partial' ? o.scope : 'unclear',
        categories: CATEGORIES.filter(c => arr(o.categories).includes(c)),
        valid_until: valid && /^\d{4}-\d{2}-\d{2}$/.test(valid) ? valid : null,
        notes: arr(o.notes).map(String).filter(Boolean),
        ignored: (arr(o.ignored) as Record<string, unknown>[]).map(i => ({ text: str(i?.text) ?? '', lines: ints(i?.lines) })),
        items,
    }
}

// ── Checks on the read (no AI) ──────────────────────────────────────────────

const PCT = /(\d+(?:\.\d+)?)\s*%/g
const numbersIn = (text: string) => new Set([...text.matchAll(/\d+(?:\.\d+)?/g)].map(m => Number(m[0])))
const rateOf = (e: RateScheduleEntry) => e.type === 'fixed' ? e.rate : e.spread

/** Lines that hold a percentage but that no package or ignored note accounts for. */
export function unreadRateLines(text: string, read: RateRead): { line: number; text: string }[] {
    const used = new Set([...read.items.flatMap(i => i.lines), ...read.ignored.flatMap(i => i.lines)])
    return text.split(/\r?\n/)
        .map((t, i) => ({ line: i + 1, text: t.trim() }))
        .filter(l => l.text.match(PCT) && !used.has(l.line))
}

/** Rates in an item that aren't in its own source lines (or anywhere, when it has none). */
export function inventedRates(text: string, item: ReadItem): number[] {
    const lines = text.split(/\r?\n/)
    const own = item.lines.length ? item.lines.map(n => lines[n - 1] ?? '').join('\n') : text
    const seen = numbersIn(own)
    return [...new Set(item.rates.map(rateOf).filter((n): n is number => n != null && !seen.has(n)))]
}

// ── Matching to the master ──────────────────────────────────────────────────

export type Level = 'green' | 'amber' | 'red'
export interface FieldDiff { field: string; from: string; to: string; state: 'changed' | 'same' | 'kept' | 'missing' }

export interface Proposal {
    id: string
    kind: 'change' | 'same' | 'new' | 'remove' | 'ask'
    level: Level
    item: ReadItem | null
    current: MortgagePackage | null
    proposed: MortgagePackage | null
    ladderKey: string | null
    /** For 'ask': the products this could be. */
    candidates: { key: string; label: string }[]
    diffs: FieldDiff[]
    warnings: string[]
    /** Real differences in a feature; HUB's is kept unless the admin chooses the banker's. */
    featureDiffs: FeatureDiff[]
    /** Said by the banker, not in HUB, not added. */
    mentions: string[]
    accepted: boolean
}

export interface RateAlias { banker: string; phrase: string; ladder_key: string }
/** Who last changed a package, to spot two bankers disagreeing. */
export interface RecentSource { package_id: string; banker: string; on: string }

export interface MatchContext {
    bank: string
    packages: MortgagePackage[]
    read: RateRead
    text: string | null               // null for PDFs and screenshots
    banker: string
    today: string
    aliases?: RateAlias[]
    recent?: RecentSource[]
    /** The admin said this is the bank's full list for the categories it covers. */
    fullList: boolean
    newId: () => string
}

export const phraseOf = (i: ReadItem) =>
    [i.category, i.fixed_years != null ? `${i.fixed_years}y` : '', i.reference ?? '', i.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()].filter(Boolean).join('|')

const fixedYearsOf = (l: RateLadder) => {
    const m = l.label.match(/^(\d)Y Fixed/)
    return m ? Number(m[1]) : l.steps[0].rate_schedule.filter(e => e.type === 'fixed' && !e.thereafter).length
}
const refOf = (l: RateLadder) => l.steps[0].rate_schedule.find(e => e.type === 'floating')?.reference ?? ''
const TAGS: [RegExp, RegExp][] = [[/\bflex/i, /\bflex/i], [/green/i, /\bgreen/i], [/hdb\s*(only|exclusive)/i, /hdb only/i]]

/** Products in the master an item could be, best evidence first. */
export function candidateLadders(item: ReadItem, ladders: RateLadder[]): RateLadder[] {
    const itemRef = item.reference ?? item.rates.find(r => r.type === 'floating')?.reference ?? null
    let found = ladders.filter(l => l.category === item.category
        && (item.lockin_years == null || l.lockinYears === item.lockin_years)
        && (item.category === 'Fixed'
            ? item.fixed_years == null || fixedYearsOf(l) === item.fixed_years
            : itemRef == null || refOf(l).toLowerCase() === itemRef.toLowerCase()))
    // A stated tag (green, HDB only…) must match; an unstated one excludes tagged products.
    const words = `${item.name} ${item.features.join(' ')}`
    for (const [inItem, inLabel] of TAGS) {
        const said = inItem.test(item.name) || (inLabel.source.includes('green') && inItem.test(words))
        const narrowed = found.filter(l => inLabel.test(l.label) === said)
        if (said || narrowed.length) found = narrowed
    }
    if (found.length > 1 && item.lockin_years != null) {
        const conv = conversionMonths({ features: item.features, lockin_years: item.lockin_years })
        const narrowed = conv == null ? [] : found.filter(l => l.steps.some(s => conversionMonths(s) === conv))
        if (narrowed.length) found = narrowed
    }
    return found
}

const restrictionMatches = (item: ReadItem, p: MortgagePackage) => {
    const a = item.restricted_to?.toLowerCase(), b = restrictedTo(p)?.toLowerCase()
    return !a === !b && (!a || !b || a === b || a.includes(b.split(' ')[0]) || b.includes(a.split(' ')[0]))
}

function findStep(item: ReadItem, steps: MortgagePackage[]): MortgagePackage[] {
    return steps.filter(p => restrictionMatches(item, p)
        && (item.property_type == null || overlap(item.property_type, p.property_type))
        && (item.min_loan == null || Number(p.min_loan_size) === item.min_loan))
}

const TOPICS: [string, RegExp][] = [
    ['conversion', /conver|\bfc\b/i], ['waiver due to sale', /waive|wdts|due to sale/i],
    ['prepayment', /partial|pre-?payment|repayment/i], ['credit card', /credit card/i],
    ['fire insurance', /fire insurance/i], ['cash reward', /cash (incentive|gift|rebate|reward)|subsid/i],
    ['funding', /\bfund(ing|ed)?\b|deposit/i], ['offset', /offset|smart ?mortgage|mortgageone/i],
]
const topicsOf = (f: string) => TOPICS.filter(([, re]) => re.test(f)).map(([t]) => t)

/** A cash reward is not a package feature (unless it is one option among real features). */
export const isCash = (f: string) => topicsOf(f).join() === 'cash reward'

/** The figures that make two lines about one topic really differ. null = not stated. */
function facts(f: string, lockinYears: number) {
    const t = f.toLowerCase()
    const months = t.match(/(\d+)\s*(?:months?|mths?)\b/)
    const pct = t.match(/(\d+(?:\.\d+)?)\s*%/)
    return {
        timing: months ? Number(months[1]) : /any\s?time|any point/.test(t) ? 0 : /after (the )?lock/.test(t) ? lockinYears * 12 : null,
        pct: pct ? Number(pct[1]) : /\bfull\b/.test(t) ? 100 : null,
        none: /not applicable|\bn\/a\b|no waiver|not allowed/.test(t),
    }
}

/** to = '' means the feature is removed for this package. */
export interface FeatureDiff { from: string; to: string; reason?: string; removeByDefault?: boolean }

/** The loan size a feature is limited to: "(>400k)", "loan sizes > $400k", "above $1M". */
export function loanThreshold(f: string): number | null {
    const m = f.match(/(?:>|≥|above|more than|at least|from)\s*(?:S?\$)?\s*(\d+(?:\.\d+)?)\s*(k|mil|m)\b/i)
    return m ? parseMinSize(m[1] + m[2]) : null
}

/** A step covers loans from its minimum up to the next step's minimum. */
export interface LoanRange { min: number; max: number | null }

/**
 * HUB's features are kept: bankers reword the same terms in every message. Only a real
 * difference in timing, percentage or availability is reported, for a person to decide.
 */
export function compareFeatures(current: string[], said: string[], lockinYears: number, range?: LoanRange): { differ: FeatureDiff[]; mentions: string[] } {
    const differ: FeatureDiff[] = [], mentions: string[] = []
    const one = (f: string) => { const t = topicsOf(f); return t.length === 1 ? t[0] : null }
    const agree = (x: string, y: string) => {
        const p = facts(x, lockinYears), q = facts(y, lockinYears)
        return p.none === q.none && (p.timing == null || q.timing == null || p.timing === q.timing) && (p.pct == null || q.pct == null || p.pct === q.pct)
    }
    const stated = said.filter(f => !isCash(f))
    for (const f of stated) {
        const topic = one(f)
        if (!topic || !current.some(c => topicsOf(c).includes(topic))) {
            if (!current.some(c => normFeature(c) === normFeature(f))) mentions.push(f)
        }
    }
    for (const c of current) {
        const topic = one(c)
        if (!topic || !['conversion', 'waiver due to sale', 'prepayment'].includes(topic)) continue
        const same = stated.filter(f => one(f) === topic)
        const agreed = same.find(f => agree(c, f))
        if (same.length && !agreed) { differ.push({ from: c, to: same[0] }); continue }
        // Same feature, but only above a loan size. Our step may be below it, or straddle it.
        const t = agreed ? loanThreshold(agreed) : null
        if (!t || !range || range.min >= t || loanThreshold(c)) continue
        // Judged by the package's minimum loan (product decision 2026-11-26): below the limit = not offered.
        differ.push({ from: c, to: '', reason: `The banker says this is only for loans above ${money(t)}, and this package starts at ${money(range.min)}`, removeByDefault: true })
    }
    return { differ, mentions }
}

/** The admin's own wording. A question about a line they rewrote or deleted is settled by that. */
export function setFeatures(p: Proposal, features: string[]): Proposal {
    if (!p.proposed) return p
    const proposed = { ...p.proposed, features: features.map(f => f.trim()).filter(Boolean) }
    const has = (f: string) => proposed.features.includes(f)
    const featureDiffs = p.featureDiffs.filter(d => has(d.from) || (d.to ? has(d.to) : p.proposed!.features.includes(d.from) === has(d.from)))
    const diffs = diffPackages(p.current, proposed, p.item)
    const kind = p.current ? (diffs.some(x => x.state === 'changed') ? 'change' as const : 'same' as const) : p.kind
    return { ...p, proposed, diffs, kind, featureDiffs }
}

/** "Use banker's" for one difference, on every proposal that has it. */
export function applyFeatureChoice(ps: Proposal[], d: FeatureDiff, useBanker: boolean): Proposal[] {
    return ps.map(p => {
        if (!p.proposed || !p.featureDiffs.some(x => x.from === d.from && x.to === d.to)) return p
        const [out, into] = useBanker ? [d.from, d.to] : [d.to, d.from]
        const has = (f: string) => p.proposed!.features.includes(f)
        const back = (list: string[]) => {
            // A restored feature goes back where it was.
            const at = (p.current?.features ?? []).indexOf(into)
            return at < 0 ? [...list, into] : [...list.slice(0, at), into, ...list.slice(at)]
        }
        const features = has(out) ? p.proposed.features.map(f => f === out ? into : f) : has(into) || !into ? p.proposed.features : back(p.proposed.features)
        const proposed = { ...p.proposed, features: features.filter(Boolean) }
        const diffs = diffPackages(p.current, proposed, p.item)
        const kind = p.current ? (diffs.some(x => x.state === 'changed') ? 'change' as const : 'same' as const) : p.kind
        return { ...p, proposed, diffs, kind }
    })
}

const sameEntry = (a: RateScheduleEntry, b: RateScheduleEntry) => formatRateEntry(a) === formatRateEntry(b)

/**
 * Stated years replace current ones. Later years are kept only when the banker gave no
 * thereafter rate: "Y1&2 1.85%, TA 1M+1.00" means Year 3 IS the thereafter rate.
 */
export function mergeSchedule(current: RateScheduleEntry[], stated: RateScheduleEntry[]) {
    const years = stated.filter(e => !e.thereafter).sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
    const ta = stated.find(e => e.thereafter)
    const curYears = current.filter(e => !e.thereafter)
    const curTa = current.find(e => e.thereafter)
    const out: RateScheduleEntry[] = []
    const last = Math.max(0, ...years.map(e => e.year ?? 0), ...(ta && years.length ? [] : curYears.map(e => e.year ?? 0)))
    const kept: number[] = []
    for (let y = 1; y <= last; y++) {
        const s = years.find(e => e.year === y), c = curYears.find(e => e.year === y)
        if (s) out.push({ ...s, year: y })
        else if (c) { out.push({ ...c }); kept.push(y) }
    }
    const end = ta ?? curTa
    if (end) out.push({ ...end })
    return { schedule: out, keptYears: kept, keptThereafter: !ta && !!curTa }
}

const show = (e?: RateScheduleEntry) => e ? formatRateEntry(e).split(': ').slice(1).join(': ') : 'none'
const size = (n: number | null | undefined) => n == null ? 'none' : money(Number(n))

export function diffPackages(a: MortgagePackage | null, b: MortgagePackage, item: ReadItem | null): FieldDiff[] {
    const out: FieldDiff[] = []
    const push = (field: string, from: string, to: string, stated: boolean) =>
        out.push({ field, from, to, state: a && from !== to ? 'changed' : !stated ? (to === 'none' || to === '' ? 'missing' : 'kept') : a ? 'same' : 'changed' })
    const years = Math.max(0, ...[a, b].map(p => p?.rate_schedule.filter(e => !e.thereafter).length ?? 0))
    for (let y = 1; y <= years; y++) {
        push(`Year ${y}`, show(a?.rate_schedule.find(e => !e.thereafter && e.year === y)), show(b.rate_schedule.find(e => !e.thereafter && e.year === y)), !item || item.rates.some(r => r.year === y))
    }
    push('Thereafter', show(a?.rate_schedule.find(e => e.thereafter)), show(b.rate_schedule.find(e => e.thereafter)), !item || item.rates.some(r => r.thereafter))
    push('Lock-in', a ? `${a.lockin_years}Y` : 'none', `${b.lockin_years}Y`, !item || item.lockin_years != null)
    push('Minimum loan', size(a?.min_loan_size), size(b.min_loan_size), !item || item.min_loan != null)
    push('Property', a?.property_type ?? 'none', b.property_type, !item || item.property_type != null)
    const pa = size(a?.priority_min_loan), pb = size(b.priority_min_loan)
    if (pa !== 'none' || pb !== 'none') push('Priority minimum', pa, pb, !item || item.priority_min_loan != null)
    const ra = a ? restrictedTo(a) ?? 'Everyone' : 'none', rb = restrictedTo(b) ?? 'Everyone'
    if (ra !== rb && (a || rb !== 'Everyone')) push('Who', ra, rb, true)
    const va = a?.valid_until ?? 'none', vb = b.valid_until ?? 'none'
    if (va !== vb) push('Valid until', va, vb, true)
    const na = new Set(a?.features.map(normFeature) ?? []), nb = new Set(b.features.map(normFeature))
    const gone = a?.features.filter(f => !nb.has(normFeature(f))) ?? []
    const added = b.features.filter(f => !na.has(normFeature(f)))
    if (gone.length || added.length) out.push({ field: 'Features', from: gone.join('\n') || 'none', to: added.join('\n') || 'none', state: 'changed' })
    else out.push({ field: 'Features', from: '', to: b.features.join('\n') || 'none', state: b.features.length ? 'kept' : 'missing' })
    return out
}

const BIG_JUMP = 0.5
const CONFLICT_DAYS = 14

function defaultName(bank: string, i: ReadItem): string {
    if (i.name) return i.name
    const what = i.category === 'Fixed' ? `${i.fixed_years ?? ''}Y Fixed`.replace(/^Y /, '') : `${i.reference ?? 'SORA'} ${i.category === 'BUC' ? 'BUC' : 'Floating'}`
    return `${bank} - ${what} - ${i.lockin_years ? `${i.lockin_years} Years Lock-In` : i.lockin_years === 0 ? 'No Lock-In' : ''}`.replace(/ - $/, '')
}

/** Build the proposal for an item, once we know which product it is (null = a new product). */
export function resolveItem(item: ReadItem, ladder: RateLadder | null, ctx: MatchContext, id: string): Proposal[] {
    const found = ladder ? findStep(item, ladder.steps) : []
    if (item.action === 'remove') {
        const targets = ladder ? found : []
        return targets.map((p, n) => ({
            id: `${id}-${n}`, kind: 'remove' as const, level: 'amber' as const, item, current: p, proposed: null, ladderKey: ladder!.key,
            candidates: [], diffs: [], featureDiffs: [], mentions: [], warnings: ['The banker says this is removed'], accepted: true,
        }))
    }
    // "All loan sizes" style items (no minimum) update every step of the product.
    if (found.length > 1 && item.min_loan == null) {
        return found.map((p, n) => build(item, p, p, ladder!, ctx, `${id}-${n}`, ['No loan size stated: applied to every step of this product. Please check']))
    }
    // HDB + Private rows can both answer to an "HDB / Private" item at the same size.
    if (found.length > 1) return found.map((p, n) => build({ ...item, property_type: null }, p, p, ladder!, ctx, `${id}-${n}`, ['More than one package on this step. Please check']))
    if (found.length === 1) return [build(item, found[0], found[0], ladder!, ctx, id, [])]

    // New step: copy what isn't stated from the nearest step of the SAME product.
    const pool = ladder ? (ladder.steps.filter(p => restrictionMatches(item, p)).length ? ladder.steps.filter(p => restrictionMatches(item, p)) : ladder.steps) : []
    const near = item.min_loan == null ? pool[0] : [...pool].sort((a, b) => Math.abs(Number(a.min_loan_size) - item.min_loan!) - Math.abs(Number(b.min_loan_size) - item.min_loan!))[0]
    return [build(item, null, near ?? null, ladder, ctx, id, near
        ? [`New step. Anything not stated is copied from ${money(Number(near.min_loan_size))}`]
        : ['New product: nothing to copy from, so fill any gaps'])]
}

function build(item: ReadItem, current: MortgagePackage | null, base: MortgagePackage | null, ladder: RateLadder | null, ctx: MatchContext, id: string, notes: string[]): Proposal {
    const warnings = [...notes]
    let level: Level = current && !notes.length ? 'green' : 'amber'
    const amber = (w: string) => { warnings.push(w); if (level === 'green') level = 'amber' }
    const red = (w: string) => { warnings.push(w); level = 'red' }

    // On a new step only features the whole product shares are safe to copy.
    const baseFeatures = (current ?? base)?.features ?? []
    const min = Number(current?.min_loan_size ?? item.min_loan ?? 0)
    const sizes = (ladder?.steps ?? []).filter(p => restrictionMatches(item, p) && (!current || overlap(p.property_type, current.property_type))).map(p => Number(p.min_loan_size))
    const above = sizes.filter(n => n > min)
    const range: LoanRange = { min, max: above.length ? Math.min(...above) : null }
    const feats = base ? compareFeatures(baseFeatures, item.features, item.lockin_years ?? base.lockin_years, range) : { differ: [], mentions: [] }
    const { schedule, keptYears } = mergeSchedule(base?.rate_schedule ?? [], item.rates)
    const tidy = (p: MortgagePackage): MortgagePackage => ({ ...p, first_year_rate: deriveFirstYearRate(p.rate_schedule) })
    const proposed = tidy({
        id: current?.id ?? ctx.newId(),
        bank: ctx.bank,
        property_type: item.property_type && !current ? item.property_type : current?.property_type ?? base?.property_type ?? 'HDB / Private',
        category: item.category,
        min_loan_size: item.min_loan ?? Number(current?.min_loan_size ?? 0),
        package_name: current?.package_name ?? base?.package_name ?? defaultName(ctx.bank, item),
        lockin_years: item.lockin_years ?? base?.lockin_years ?? 0,
        rate_schedule: schedule,
        first_year_rate: null,
        features: base ? baseFeatures : item.features.filter(f => !isCash(f)),
        subsidies: current?.subsidies ?? null,
        remarks: current?.remarks ?? null,
        min_loan_note: current?.min_loan_note ?? null,
        status: current?.status ?? 'published',
        last_updated: current?.last_updated ?? ctx.today,
        priority_min_loan: item.priority_min_loan ?? current?.priority_min_loan ?? null,
        restricted_to: current ? restrictedTo(current) : item.restricted_to,
        valid_until: ctx.read.valid_until ?? (current?.valid_until && current.valid_until >= ctx.today ? current.valid_until : null),
        confirmed_on: ctx.today,
        product: base?.product ?? null,
    })

    if (!schedule.some(e => !e.thereafter)) red('No rate to save')
    if (schedule.some(e => rateOf(e) == null || (e.type === 'floating' && !e.reference))) red('A rate or benchmark is missing')
    if (schedule.some((e, i) => !e.thereafter && e.year !== i + 1)) red('A year is missing from the rates')
    if (!schedule.some(e => e.thereafter)) amber('No thereafter rate stated or on record')
    if (!current && item.min_loan == null) red('No minimum loan stated')
    if (!base && item.lockin_years == null) red('Lock-in not stated and nothing to copy from')
    if (!base && item.property_type == null) amber('Property type not stated: saved as HDB / Private')
    if (item.fixed_years != null) {
        const n = schedule.filter(e => e.type === 'fixed' && !e.thereafter).length
        if (n !== item.fixed_years) red(`${item.fixed_years}Y fixed was stated, but there ${n === 1 ? 'is 1 fixed year' : `are ${n} fixed years`}`)
    }
    if (keptYears.some(y => item.rates.some(r => (r.year ?? 0) > y))) amber(`Year ${keptYears.join(', ')} not stated: kept from the master`)
    if (ctx.text != null) {
        const invented = inventedRates(ctx.text, item)
        if (invented.length) red(`Not found in the message: ${invented.map(n => `${n}%`).join(', ')}`)
    }
    if (current && current.lockin_years !== proposed.lockin_years) amber(`Lock-in changes: ${current.lockin_years}Y to ${proposed.lockin_years}Y`)
    if (current) {
        for (const e of item.rates) {
            const c = current.rate_schedule.find(x => !!x.thereafter === !!e.thereafter && (e.thereafter || x.year === e.year))
            const a = c && rateOf(c), b = rateOf(e)
            if (c && a != null && b != null && c.type === e.type && Math.abs(a - b) > BIG_JUMP) amber(`Large change: ${show(c)} to ${show(e)}`)
            if (c && c.type === 'floating' && e.type === 'floating' && c.reference !== e.reference) amber(`Benchmark changes: ${show(c)} to ${show(e)}`)
        }
        const r = ctx.recent?.find(x => x.package_id === current.id)
        if (r && r.banker && r.banker !== ctx.banker && daysBetween(r.on, ctx.today) <= CONFLICT_DAYS && !sameRates(current, proposed)) {
            amber(`${r.banker} gave a different rate on ${r.on}. The latest isn't always right`)
        }
    }

    const diffs = diffPackages(current, proposed, item)
    const changed = !current || diffs.some(d => d.state === 'changed')
    // Nothing changed, so there is nothing to decide: it only refreshes "last confirmed".
    const kind = !current ? 'new' : changed ? 'change' : 'same'
    const built: Proposal = {
        id, kind, level, item, current, proposed, ladderKey: ladder?.key ?? null, candidates: [], diffs, warnings: [...new Set(warnings)],
        featureDiffs: feats.differ, mentions: feats.mentions, accepted: level === 'green',
    }
    return feats.differ.filter(d => d.removeByDefault).reduce((p, d) => applyFeatureChoice([p], d, true)[0], built)
}

const daysBetween = (a: string, b: string) => Math.abs(Date.parse(b) - Date.parse(a)) / 86_400_000
const sameRates = (a: MortgagePackage, b: MortgagePackage) =>
    a.rate_schedule.length === b.rate_schedule.length && a.rate_schedule.every((e, i) => sameEntry(e, b.rate_schedule[i]))

export function matchRead(ctx: MatchContext): Proposal[] {
    const ladders = buildLadders(ctx.packages, ctx.today)
    const out: Proposal[] = []
    ctx.read.items.forEach((item, n) => {
        const id = String(n)
        let found = candidateLadders(item, ladders)
        if (found.length > 1) {
            const phrase = phraseOf(item)
            const hits = (ctx.aliases ?? []).filter(a => a.phrase === phrase && (a.banker === ctx.banker || a.banker === ''))
            const known = found.find(l => hits.some(h => h.ladder_key === l.key))
            if (known) found = [known]
        }
        // Same product, different lock-in: the bank may have changed it, or HUB may be wrong.
        // Adding it as a new product would leave the old one live, so ask.
        const lockinDiffers = !found.length && item.lockin_years != null
        if (lockinDiffers) found = candidateLadders({ ...item, lockin_years: null }, ladders)
        // When only one of the possible products has this step, that is still a guess: ask.
        if (found.length > 1 || (lockinDiffers && found.length) || (item.action === 'remove' && found.length === 0)) {
            out.push({
                id, kind: 'ask', level: 'amber', item, current: null, proposed: null, ladderKey: null,
                candidates: found.map(l => ({ key: l.key, label: ladderTitle(l) })), diffs: [], featureDiffs: [], mentions: [], accepted: false,
                warnings: [lockinDiffers && found.length ? `The message says ${item.lockin_years ? `${item.lockin_years}Y lock-in` : 'no lock-in'}, but HUB has a different lock-in` : found.length ? 'This could be more than one product' : 'The banker says this is removed, but HUB has no such package'],
            })
        } else out.push(...resolveItem(item, found[0] ?? null, ctx, id))
    })
    flagDuplicates(out)
    if (ctx.fullList) out.push(...unmentioned(ctx, out))
    return out
}

/** Two lines of one message landing on the same package: neither can be trusted alone. */
export function flagDuplicates(ps: Proposal[]) {
    const seen = new Map<string, Proposal[]>()
    for (const p of ps) if (p.current && p.kind !== 'remove') seen.set(p.current.id, [...(seen.get(p.current.id) ?? []), p])
    for (const group of seen.values()) if (group.length > 1) for (const p of group) {
        p.accepted = false
        if (p.level === 'green') p.level = 'amber'
        const w = 'Two parts of the message match this package: choose one'
        if (!p.warnings.includes(w)) p.warnings.push(w)
    }
}

/** Full list only: packages in the covered categories that weren't mentioned. Never pre-ticked. */
export function unmentioned(ctx: MatchContext, ps: Proposal[]): Proposal[] {
    // An unanswered question might still be about any of its products, so don't suggest removing those.
    const open = new Set(ps.filter(p => p.kind === 'ask').flatMap(p => p.candidates.map(c => c.key)))
    const hit = new Set(ps.flatMap(p => p.current ? [p.current.id] : []))
    const covered = new Set(ctx.read.categories.length ? ctx.read.categories : ctx.read.items.map(i => i.category))
    return buildLadders(ctx.packages, ctx.today)
        .filter(l => covered.has(l.category as RateCategory) && !open.has(l.key))
        .flatMap(l => l.steps.filter(p => !hit.has(p.id)).map(p => ({
            id: `gone-${p.id}`, kind: 'remove' as const, level: 'amber' as const, item: null, current: p, proposed: null, ladderKey: l.key,
            candidates: [], diffs: [], featureDiffs: [], mentions: [], warnings: ['Not mentioned in this full list'], accepted: false,
        })))
}

export const ladderTitle = (l: RateLadder) =>
    `${l.label}${l.category === 'BUC' ? '' : l.lockinYears ? `, ${l.lockinYears}Y lock-in` : ', no lock-in'}`

/** The bank's list after the ticked proposals. Everything else stays exactly as it is. */
export function applyProposals(packages: MortgagePackage[], ps: Proposal[]): MortgagePackage[] {
    const ticked = ps.filter(p => p.accepted && p.level !== 'red' && p.kind !== 'ask')
    const gone = new Set(ticked.filter(p => p.kind === 'remove').map(p => p.current!.id))
    const changed = new Map(ticked.filter(p => p.proposed && p.current).map(p => [p.current!.id, p.proposed!]))
    return [
        ...packages.filter(p => !gone.has(p.id)).map(p => changed.get(p.id) ?? p),
        ...ticked.filter(p => p.kind === 'new').map(p => p.proposed!),
    ]
}

// ── Before publishing ───────────────────────────────────────────────────────

export interface BankChange { type: 'added' | 'changed' | 'removed' | 'confirmed'; package_id: string; label: string; diffs: FieldDiff[] }

export const packageLabel = (p: MortgagePackage) =>
    `${money(Number(p.min_loan_size))} ${p.package_name}${restrictedTo(p) ? ` (${restrictedTo(p)})` : ''}`

const CONTENT: (keyof MortgagePackage)[] = ['property_type', 'category', 'min_loan_size', 'package_name', 'lockin_years', 'rate_schedule', 'features', 'subsidies', 'remarks', 'min_loan_note', 'status', 'priority_min_loan', 'restricted_to', 'valid_until', 'product']
const sameContent = (a: MortgagePackage, b: MortgagePackage) => CONTENT.every(k =>
    JSON.stringify(canon(a[k])) === JSON.stringify(canon(b[k])))
function canon(v: unknown): unknown {
    if (v == null || v === '') return null
    if (Array.isArray(v)) return v.map(canon)
    if (typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x != null && x !== false).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)]))
    return typeof v === 'string' && v !== '' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v
}

export function bankChanges(before: MortgagePackage[], after: MortgagePackage[]): BankChange[] {
    const old = new Map(before.map(p => [p.id, p]))
    const ids = new Set(after.map(p => p.id))
    const out: BankChange[] = []
    for (const p of after) {
        const o = old.get(p.id)
        if (!o) out.push({ type: 'added', package_id: p.id, label: packageLabel(p), diffs: diffPackages(null, p, null) })
        else if (!sameContent(o, p)) {
            const diffs = diffPackages(o, p, null).filter(d => d.state === 'changed')
            for (const k of ['package_name', 'category', 'subsidies', 'remarks', 'min_loan_note', 'status', 'product'] as const) {
                if (JSON.stringify(canon(o[k])) !== JSON.stringify(canon(p[k]))) diffs.push({ field: k.replace(/_/g, ' '), from: String(o[k] ?? 'none'), to: String(p[k] ?? 'none'), state: 'changed' })
            }
            out.push({ type: 'changed', package_id: p.id, label: packageLabel(o), diffs })
        } else if ((o.confirmed_on ?? null) !== (p.confirmed_on ?? null)) out.push({ type: 'confirmed', package_id: p.id, label: packageLabel(p), diffs: [] })
    }
    for (const p of before) if (!ids.has(p.id)) out.push({ type: 'removed', package_id: p.id, label: packageLabel(p), diffs: [] })
    return out
}

/** Warnings the new list has that the old one didn't. Warn only, never block. */
export function newWarnings(before: MortgagePackage[], after: MortgagePackage[], today: string): string[] {
    const list = (ps: MortgagePackage[]) => buildLadders(ps, today).flatMap(l => l.issues.filter(i => i.level === 'check').map(i => `${l.label}: ${i.text}`))
    const old = new Set(list(before))
    return [...new Set(list(after))].filter(t => !old.has(t))
}

/** Problems that must be fixed before anything is saved. Used by the screen AND the server. */
export function packageErrors(p: MortgagePackage): string[] {
    const errs: string[] = []
    if (!p.package_name?.trim()) errs.push('no name')
    if (!CATEGORIES.includes(p.category)) errs.push('unknown category')
    if (!(PROPERTY_TYPES as readonly string[]).includes(p.property_type)) errs.push('unknown property type')
    const min = Number(p.min_loan_size)
    if (!Number.isFinite(min) || min < 0) errs.push('minimum loan is not a number')
    if (p.priority_min_loan != null && !(Number(p.priority_min_loan) >= 0)) errs.push('Priority minimum is not a number')
    if (!Number.isInteger(p.lockin_years) || p.lockin_years < 0 || p.lockin_years > 10) errs.push('lock-in is not valid')
    const s = Array.isArray(p.rate_schedule) ? p.rate_schedule : []
    const years = s.filter(e => !e.thereafter)
    if (!years.length) errs.push('no yearly rate')
    if (years.some((e, i) => e.year !== i + 1)) errs.push('years are not 1, 2, 3…')
    if (s.filter(e => e.thereafter).length > 1 || s.some((e, i) => e.thereafter && i !== s.length - 1)) errs.push('thereafter must be last, once')
    for (const e of s) {
        const n = rateOf(e), at = e.thereafter ? 'thereafter' : `year ${e.year}`
        if (n == null || !Number.isFinite(n) || n < 0 || n > 20) errs.push(`${at} has no valid rate`)
        if (e.type === 'floating' && !e.reference?.trim()) errs.push(`${at} has no benchmark`)
    }
    if (p.valid_until && !/^\d{4}-\d{2}-\d{2}$/.test(p.valid_until)) errs.push('valid-until is not a date')
    return errs
}
