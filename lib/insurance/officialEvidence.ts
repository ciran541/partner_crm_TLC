/**
 * Where a draft's figures appear on its official page, so an admin can check it
 * in seconds. Pure: pinned by __tests__/officialSources.test.ts.
 *
 * Read live for the admin when they review; nothing here is stored.
 */

import { figureTokens, figureValues } from '@/lib/insurance/figures'


export interface FigureCheck { text: string; found: boolean }
export interface Evidence { figures: FigureCheck[]; lines: string[]; /** Every figure value on the page, for re-checking edits. */ pageFigures: number[] }

const STOP = new Set('what which when where does with from that this have will your their they there about into than then them also only must under over more less each other such been being were shall would could should within whether while after before above below between'.split(' '))
const words = (s: string) => [...new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter(w => !STOP.has(w))

export function evidence(question: string, answer: string, pageText: string, max = 5): Evidence {
    const known = new Set(figureValues(pageText))
    const figures = figureTokens(answer).map(text => ({ text, found: figureValues(text).every(v => known.has(v)) }))
    const wanted = new Set(figures.flatMap(f => figureValues(f.text)))
    const keys = words(`${question} ${answer}`)

    const scored = pageText.split('\n').map((line, i) => {
        const l = line.toLowerCase()
        const figs = figureValues(line).filter(v => wanted.has(v)).length
        const hits = keys.filter(k => l.includes(k)).length
        return { i, line: line.length > 400 ? `${line.slice(0, 400)}…` : line, score: figs * 3 + hits, figs }
    })
    // Lines holding the answer's figures are the proof; a few word matches add context.
    const withFigures = scored.filter(s => s.figs > 0).sort((a, b) => b.score - a.score).slice(0, max)
    const context = scored.filter(s => s.figs === 0 && s.score >= 3).sort((a, b) => b.score - a.score).slice(0, withFigures.length ? 1 : 3)
    const best = [...withFigures, ...context].sort((a, b) => a.i - b.i)
    return { figures, lines: best.map(s => s.line), pageFigures: [...known] }
}

/** "…/housing-loan-from-hdb" → "Housing loan from hdb". */
export function titleFromUrl(url: string): string {
    const seg = decodeURIComponent(new URL(url).pathname.replace(/\/+$/, '').split('/').pop() ?? '')
    const t = seg.replace(/\.(html?|aspx)$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
    return t ? t[0].toUpperCase() + t.slice(1) : url
}

/** Notices, forms and statistics: rarely the rules themselves, so listed last. */
const MINOR = /terms-and-conditions|get-help|letters-to-keos|statistics|media-releases?|news|speeches|tender|careers|privacy|forms?\b|faq/i

/** Pages whose address contains every word searched for, main topic pages first. */
export function matchPages(urls: string[], query: string, skip: Set<string>, limit = 40): { url: string; title: string }[] {
    const q = query.toLowerCase().split(/\s+/).filter(Boolean)
    const hits: { url: string; minor: boolean; depth: number }[] = []
    for (const url of [...new Set(urls)]) {
        if (skip.has(url) || !URL.canParse(url) || /\.(pdf|jpg|png|docx?|xlsx?)$/i.test(url)) continue
        const path = decodeURIComponent(new URL(url).pathname).toLowerCase()
        if (q.length && !q.every(w => path.replace(/[-_/]+/g, ' ').includes(w))) continue
        hits.push({ url, minor: MINOR.test(path), depth: path.split('/').filter(Boolean).length })
    }
    return hits.sort((a, b) => Number(a.minor) - Number(b.minor) || a.depth - b.depth || a.url.length - b.url.length)
        .slice(0, limit).map(h => ({ url: h.url, title: titleFromUrl(h.url) }))
}

/** Weekly for the rules that can change overnight; monthly for the rest. */
export const suggestDays = (title: string) => (/absd|bsd|ssd|stamp|tdsr|msr|ltv|loan.to.value|cooling/i.test(title) ? 7 : 30)
