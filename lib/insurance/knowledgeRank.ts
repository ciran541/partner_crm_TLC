/**
 * Free ranking of Knowledge articles: word match first, meaning (embedding) as a
 * tie-breaker. The embedder alone can't judge relevance: it scores "best chicken
 * rice in town" above 0.7 against mortgage articles.
 */

export interface RankableArticle { id: string; title: string; content: string; tags: string[] | null }
export type Confidence = 'direct' | 'related' | 'none'

const STOP = new Set(('a an the is are was were be been am do does did can could will would should may might must i my me you your we our us they their he she it its '
    + 'this that these those what which who whom when where why how if then than and or but not no of to in on at for from with by as about into after before over under '
    + 'client clients customer borrower borrowers have has had get got give need needed want much many long count calculate calculated work works tell explain please know '
    + 'there here any some all just only also still now so take taking make happen happens apply applies singapore mean means meaning using use used property properties '
    + 'loan loans bank banks buy buying purchase purchasing purchased full want allowed possible ok okay recognise recognised counted still fail failed').split(' '))

/** Agent wording → the wording articles use. */
const PHRASES: [RegExp, string][] = [
    [/\b(cash[\s-]?out|term loan|gearing up|equity term loan)\b/g, 'equity'],
    [/\b(refi|refinanc\w*)\b/g, 'refinance'],
    [/\b(decoupl\w*|part purchase)\b/g, 'decouple'],
    [/\b(second|2nd)\b/g, 'second'],
    [/\b(third|3rd)\b/g, 'third'],
    [/\b(loan[\s-]to[\s-]value|ltv)\b/g, 'ltv'],
    [/\b(max|maximum|highest|longest|biggest|most)\b/g, 'maximum'],
    [/\b(min|minimum|lowest|smallest|least)\b/g, 'minimum'],
    [/\b(self[\s-]employed|noa|freelance\w*)\b/g, 'selfemployed'],
    [/\b(commission\w*|bonus\w*|variable income)\b/g, 'variable'],
    [/\b(executive condo\w*|ecs?)\b/g, 'ec'],
    [/\b(permanent resident|s?prs?)\b/g, 'pr'],
    [/\b(singaporeans?|singapore citizens?|sc)\b/g, 'citizen'],
    [/\b(foreigners?|expats?)\b/g, 'foreigner'],
    [/\b(additional buyer'?s stamp duty|absd)\b/g, 'absd'],
    [/\b(seller'?s stamp duty|ssd)\b/g, 'ssd'],
    [/\b(buyer'?s stamp duty|bsd)\b/g, 'bsd'],
    [/\b(in[\s-]principle[\s-]approval|aip|ipa)\b/g, 'ipa'],
    [/\b(letter of offer|loo?)\b/g, 'loo'],
    [/\b(option to purchase|otp)\b/g, 'otp'],
    [/\b(weighted (average )?age|iwaa)\b/g, 'iwaa'],
    [/\b(lock[\s-]?in)\b/g, 'lockin'],
    [/\b(claw[\s-]?back)\b/g, 'clawback'],
    [/\b(down[\s-]?payments?)\b/g, 'downpayment'],
    [/\b(married|spouses?|husband|wife|couples?)\b/g, 'couple'],
    [/\b(buc|under construction|incomplete(d)?)\b/g, 'incomplete'],
    [/\b(income haircut|haircut)\b/g, 'haircut'],
]

const stem = (w: string) => w.length > 4 ? w.replace(/(ies)$/, 'y').replace(/(?<!s)s$/, '') : w

export function terms(text: string): string[] {
    let t = text.toLowerCase().replace(/[’]/g, "'")
    for (const [re, to] of PHRASES) t = t.replace(re, ` ${to} `)
    return t.replace(/[^a-z0-9]+/g, ' ').split(' ')
        // Amounts and ages aren't topics.
        .filter(w => w.length > 1 && !/^\d+(k|m|yr|yrs)?$/.test(w) && !STOP.has(w))
        .map(stem)
}

/** One edit apart, counting a swap of neighbours ("calwback") as one. */
export function oneEditApart(a: string, b: string): boolean {
    if (a === b || Math.abs(a.length - b.length) > 1) return false
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    const ra = a.slice(i), rb = b.slice(i)
    return ra.slice(1) === rb.slice(1) || ra.slice(1) === rb || ra === rb.slice(1)
        || (ra.length > 1 && ra[0] === rb[1] && ra[1] === rb[0] && ra.slice(2) === rb.slice(2))
}

/** Share of the question's wording an article must cover. */
const DIRECT = 0.8
const RELATED = 0.25
/** The direct answer must beat the runner-up by this much. */
const LEAD = 0.12

export interface Ranked<T> { article: T; coverage: number; score: number }

export function rankArticles<T extends RankableArticle>(question: string, articles: T[], similarity: Map<string, number> = new Map()): { ranked: Ranked<T>[]; confidence: Confidence } {
    const docs = articles.map(a => ({
        article: a,
        title: new Set(terms(a.title)),
        tags: new Set(terms((a.tags ?? []).join(' '))),
        content: new Set(terms(a.content)),
    }))
    const seenIn = new Map<string, number>()
    for (const d of docs) for (const w of new Set([...d.title, ...d.tags, ...d.content])) seenIn.set(w, (seenIn.get(w) ?? 0) + 1)

    const query = [...new Set(terms(question).map(w => {
        if (seenIn.has(w) || w.length < 5) return w
        // Prefer the commonest word one typo away.
        return [...seenIn].filter(([v]) => v.length >= 4 && oneEditApart(w, v)).sort((x, y) => y[1] - x[1])[0]?.[0] ?? w
    }))]
    if (!query.length) return { ranked: [], confidence: 'none' }

    // A word no article uses weighs most: it is usually the point of the question.
    const weight = (w: string) => Math.log(1 + docs.length / (seenIn.get(w) ?? 1))
    const total = query.reduce((s, w) => s + weight(w), 0)

    const ranked = docs.map(d => {
        const coverage = query.reduce((s, w) => s + weight(w) * (d.title.has(w) ? 1 : d.tags.has(w) ? 0.9 : d.content.has(w) ? 0.6 : 0), 0) / total
        // How much of the title the question is about: "TDSR limit" is closer to "What is TDSR and what is the limit?" than to a long scenario.
        const titleHit = d.title.size ? query.filter(w => d.title.has(w)).length / d.title.size : 0
        const meaning = Math.max(0, Math.min(1, ((similarity.get(d.article.id) ?? 0) - 0.75) / 0.2))
        return { article: d.article, coverage, score: coverage + 0.2 * titleHit + 0.35 * meaning }
    }).filter(r => r.coverage >= RELATED).sort((x, y) => y.score - x.score)

    if (!ranked.length) return { ranked, confidence: 'none' }
    const lead = ranked[0].score - (ranked[1]?.score ?? 0)
    return { ranked, confidence: query.length > 1 && ranked[0].coverage >= DIRECT && lead >= LEAD ? 'direct' : 'related' }
}

/** Case, spacing and end punctuation don't matter; every word does. */
const wordingKey = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim().replace(/[?!.\s]+$/, '')
/** A single word ("cpf") is a topic, not a question, so it never forces an article. */
const wordings = (a: Pick<RankableArticle, 'title' | 'tags'>) => [a.title, ...(a.tags ?? [])].map(wordingKey).filter(w => w.includes(' '))

/** The one article listing exactly this wording, or null when none or several do. */
export function exactMatch<T extends RankableArticle>(question: string, articles: T[]): T | null {
    const key = wordingKey(question)
    const hits = articles.filter(a => wordings(a).includes(key))
    return hits.length === 1 ? hits[0] : null
}

/** The first wording of `draft` another article already uses. */
export function clashes<T extends RankableArticle>(draft: { id: string; title: string; tags: string[] }, articles: T[]): { wording: string; article: T } | null {
    for (const w of wordings(draft)) {
        const article = articles.find(a => a.id !== draft.id && wordings(a).includes(w))
        if (article) return { wording: w, article }
    }
    return null
}
