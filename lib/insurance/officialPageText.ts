/**
 * Official pages → the rules text only (no menus, banners or footers).
 * Pure: pinned by __tests__/officialPageText.test.ts.
 *
 * The text is used to write TLC's own short answers and to notice when a page
 * changes. It is never stored or shown to agents.
 */

import { createHash } from 'node:crypto'

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', le: '≤', ge: '≥', hellip: '…' }

export function decodeEntities(s: string): string {
    return s
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
}

/** HTML fragment → readable lines. Table cells are kept apart with " | " so rows stay readable. */
export function htmlToText(html: string): string {
    return decodeEntities(html
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|button|template)\b[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<\/(td|th)>/gi, ' | ')
        .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/table|\/section|\/article|\/ul|\/ol)\b[^>]*>/gi, '\n')
        .replace(/<li\b[^>]*>/gi, '\n• ')
        .replace(/<[^>]+>/g, ' '))
        .split('\n')
        .map(l => l.replace(/\s+/g, ' ').replace(/(\s*\|\s*)+$/, '').trim())
        .filter(l => l && l !== '|' && l !== '•')
        .join('\n')
}

// Next.js sites (HDB) carry the page body as HTML strings inside their page data.
const BODY_KEY = /^(bodyContent|bodyContentVal|richText|content|text|body|description|title|heading)$/i
const SKIP_KEY = /^(sidebarData|menuData|header|footer|navigation|breadcrumbs?|metaDescription|seo|href|url|image|icon)$/i

function nextDataText(html: string): string | null {
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
    if (!m) return null
    let data: unknown
    try { data = JSON.parse(m[1]) } catch { return null }
    const out: string[] = []
    const seen = new Set<string>()
    const walk = (o: unknown, key: string) => {
        if (SKIP_KEY.test(key)) return
        if (typeof o === 'string') {
            if (!BODY_KEY.test(key)) return
            const t = htmlToText(o)
            // Titles are short; bodies are paragraphs. Anything else is labels.
            if (t.length >= (/title|heading/i.test(key) ? 6 : 60) && !seen.has(t)) { seen.add(t); out.push(t) }
            return
        }
        if (Array.isArray(o)) { o.forEach(v => walk(v, key)); return }
        if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, k === 'value' ? key : k)
    }
    walk((data as { props?: { pageProps?: unknown } }).props?.pageProps ?? data, '')
    const text = out.join('\n')
    return text.length > 300 ? text : null
}

/** Lines that change without the rules changing. */
const NOISE = [
    /^you are using an outdated browser/i,
    /^(decrease|increase) font size/i,
    /^print this page$/i,
    /^(last (updated|revised|modified)|published)( date)?\s*:?.{0,30}$/i,
    /^(share|back to top|previous|next|on this page:?)$/i,
    /scheduled maintenance/i,
    /session is about to time out|you have been inactive/i,
]

/** The rules text of an official page; '' when nothing readable was found. */
export function mainText(html: string): string {
    const raw = nextDataText(html)
        ?? htmlToText((html.match(/<main\b[\s\S]*<\/main>/i)?.[0]) ?? (html.match(/<body\b[\s\S]*<\/body>/i)?.[0]) ?? html)
    return raw.split('\n').filter(l => !NOISE.some(r => r.test(l))).join('\n').trim()
}

/** Same rules text → same fingerprint; spacing and letter case don't count. */
export function fingerprint(text: string): string {
    return createHash('sha256').update(text.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex')
}

/** robots.txt rules for every crawler ("User-agent: *"): is this path allowed? */
export function robotsAllows(robots: string, path: string): boolean {
    let applies = false, inGroup = false
    const rules: { allow: boolean; prefix: string }[] = []
    for (const line of robots.split(/\r?\n/)) {
        const [k, ...rest] = line.replace(/#.*/, '').split(':')
        const key = k.trim().toLowerCase(), val = rest.join(':').trim()
        if (key === 'user-agent') {
            if (!inGroup) applies = false
            inGroup = true
            if (val === '*') applies = true
        } else if (key === 'allow' || key === 'disallow') {
            inGroup = false
            if (applies && val) rules.push({ allow: key === 'allow', prefix: val })
        } else if (key) inGroup = false
    }
    // Longest matching rule wins, as crawlers read it.
    const hit = rules.filter(r => path.startsWith(r.prefix.replace(/\*.*$/, ''))).sort((a, b) => b.prefix.length - a.prefix.length)[0]
    return hit ? hit.allow : true
}
