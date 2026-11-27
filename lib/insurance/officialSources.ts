/**
 * Official sources for Knowledge: read approved government pages when due,
 * notice when their rules change, and draft TLC's own short answers.
 *
 * Only a fingerprint of each page is stored, never its text. Drafts are normal
 * knowledge_articles (status 'draft') that an admin approves. When a page's
 * rules text changes, every article drafted from it goes back to draft with
 * source_changed_at set, so agents never see an answer based on an old page.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { callFreeFirst } from '@/lib/ai/freeFirst'
import { fingerprint, htmlToText, mainText, robotsAllows } from '@/lib/insurance/officialPageText'
import { checkNotes, NOTES_SCHEMA, NOTES_SYSTEM, notesPrompt, parseNotes } from '@/lib/insurance/officialNotes'
import { evidence, matchPages, suggestDays, type Evidence } from '@/lib/insurance/officialEvidence'

// Same browser-like header as the news feeds: HDB and MAS refuse requests without one.
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-SG,en;q=0.9',
}
/** MAS asks for 2 seconds between requests; used for every site. */
const GAP_MS = 2_000
const MIN_TEXT = 300

export interface OfficialSite { id: string; domain: string; name: string; bots_allowed: boolean; note: string | null }
export interface OfficialPage {
    id: string; site_id: string; url: string; section: string; title: string | null; check_days: number
    status: 'new' | 'ok' | 'changed' | 'failed' | 'blocked'
    fingerprint: string | null; checked_at: string | null; changed_at: string | null; drafts_written_at: string | null
    error: string | null; fail_count: number
}
type PageWithSite = OfficialPage & { site: OfficialSite }

/** The approved site a URL belongs to (www. and sub-paths allowed); null when not approved. */
export function siteFor(url: string, sites: OfficialSite[]): OfficialSite | null {
    if (!URL.canParse(url)) return null
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    const host = u.hostname.replace(/^www\./, '')
    return sites.find(s => host === s.domain || host.endsWith(`.${s.domain}`)) ?? null
}

/** Due when never checked, or checked longer ago than its interval. */
export function isDue(p: Pick<OfficialPage, 'checked_at' | 'check_days'>, now = Date.now()): boolean {
    return !p.checked_at || now - Date.parse(p.checked_at) >= p.check_days * 86_400_000 - 3_600_000
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export interface PageRead { ok: true; title: string | null; text: string }
export interface PageFail { ok: false; blocked?: boolean; error: string }

const robotsCache = new Map<string, Promise<string>>()
function robotsFor(origin: string): Promise<string> {
    if (!robotsCache.has(origin)) {
        robotsCache.set(origin, fetch(`${origin}/robots.txt`, { headers: HEADERS, signal: AbortSignal.timeout(10_000) })
            .then(r => (r.ok && /text\/plain/.test(r.headers.get('content-type') ?? 'text/plain') ? r.text() : ''))
            .catch(() => ''))
    }
    return robotsCache.get(origin)!
}

/** Reads one page's rules text; respects the site's robots.txt. */
export async function readPage(url: string): Promise<PageRead | PageFail> {
    const u = new URL(url)
    if (!robotsAllows(await robotsFor(u.origin), u.pathname + u.search)) {
        return { ok: false, blocked: true, error: "The site's robots.txt doesn't allow reading this page." }
    }
    let res: Response
    try {
        res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(20_000) })
    } catch (e) {
        return { ok: false, error: `Couldn't reach the page (${e instanceof Error ? e.message : 'network error'}).` }
    }
    if (res.status === 404 || res.status === 410) return { ok: false, error: 'The page no longer exists (moved or removed). Update its link.' }
    if (!res.ok) return { ok: false, error: `The site answered ${res.status}.` }
    const html = await res.text()
    const text = mainText(html)
    if (text.length < MIN_TEXT) return { ok: false, error: 'No readable text: the page may need a browser to show its content.' }
    // The first heading with words in it (MAS's first <h1> is its logo), else the <title>.
    const heading = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => htmlToText(m[1])).find(t => t.length > 3)
    const title = (heading ?? htmlToText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')).split('\n')[0]?.replace(/\s*\|.*$/, '').trim() || null
    return { ok: true, title, text }
}

async function loadPage(id: string): Promise<PageWithSite | null> {
    const { data } = await createAdminClient().from('official_pages').select('*, site:official_sites(*)').eq('id', id).maybeSingle()
    return (data as PageWithSite | null) ?? null
}

/** Draft notes for one page from text already read. Returns how many were kept. */
async function writeDrafts(page: PageWithSite, text: string): Promise<{ written: number; dropped: number; error?: string }> {
    const db = createAdminClient()
    const raw = await callFreeFirst({
        label: 'officialNotes',
        system: NOTES_SYSTEM,
        user: notesPrompt(page.site.name, page.section, text),
        schema: NOTES_SCHEMA,
        maxTokens: 4000,
        thinking: 'off',
        freeTimeoutMs: 25_000,
        timeoutMs: 30_000,
        accept: t => parseNotes(t).length > 0,
    })
    const notes = raw ? parseNotes(raw) : []
    if (!notes.length) return { written: 0, dropped: 0, error: 'AI could not write drafts this time. Try again later.' }

    const { data: existing } = await db.from('knowledge_articles').select('title')
    const { keep, dropped } = checkNotes(notes, text, (existing ?? []).map(a => a.title))
    if (keep.length) {
        const { error } = await db.from('knowledge_articles').insert(keep.map(n => ({
            title: n.question, content: n.answer, tags: n.asks, source: page.url, status: 'draft', category: 'General',
            official_page_id: page.id,
        })))
        if (error) return { written: 0, dropped: dropped.length, error: error.message }
    }
    await db.from('official_pages').update({ drafts_written_at: new Date().toISOString() }).eq('id', page.id)
    if (dropped.length) console.log('[official] drafts dropped:', dropped)
    return { written: keep.length, dropped: dropped.length }
}

export interface CheckResult { pageId: string; outcome: 'unchanged' | 'first' | 'changed' | 'failed' | 'blocked'; drafts?: number; dropped?: number; error?: string }

/**
 * Reads one page and records what it found. A first read also writes drafts;
 * a change pulls its articles back for an admin to check.
 */
export async function checkPage(page: PageWithSite, opts: { drafts?: boolean } = {}): Promise<CheckResult> {
    const db = createAdminClient()
    const now = new Date().toISOString()
    if (!page.site.bots_allowed) {
        await db.from('official_pages').update({ status: 'blocked', checked_at: now, error: `${page.site.name} is set to be read by hand.` }).eq('id', page.id)
        return { pageId: page.id, outcome: 'blocked' }
    }
    const read = await readPage(page.url)
    if (!read.ok) {
        await db.from('official_pages').update({
            status: read.blocked ? 'blocked' : 'failed', checked_at: now, error: read.error, fail_count: page.fail_count + 1,
        }).eq('id', page.id)
        return { pageId: page.id, outcome: read.blocked ? 'blocked' : 'failed', error: read.error }
    }

    const fp = fingerprint(read.text)
    const first = !page.fingerprint
    const changed = !first && fp !== page.fingerprint
    await db.from('official_pages').update({
        fingerprint: fp, checked_at: now, error: null, fail_count: 0, title: read.title ?? page.title,
        ...(changed ? { status: 'changed', changed_at: now } : page.status === 'changed' ? {} : { status: 'ok' }),
    }).eq('id', page.id)

    if (changed) {
        // Back to draft until an admin checks them against the new page.
        const { error } = await db.from('knowledge_articles')
            .update({ status: 'draft', source_changed_at: now, checked_by: null, checked_on: null })
            .eq('official_page_id', page.id)
        if (error) console.error('[official] articles not pulled back:', error.message)
    }

    if (first || opts.drafts) {
        const d = await writeDrafts(page, read.text)
        return { pageId: page.id, outcome: first ? 'first' : changed ? 'changed' : 'unchanged', drafts: d.written, dropped: d.dropped, error: d.error }
    }
    return { pageId: page.id, outcome: changed ? 'changed' : 'unchanged' }
}

/** Admin: check one page now, optionally writing drafts again. */
export async function checkPageNow(id: string, drafts = false): Promise<CheckResult | null> {
    const page = await loadPage(id)
    return page ? checkPage(page, { drafts }) : null
}

/** Daily job: every page that is due, within the time budget. The rest wait for tomorrow. */
export async function checkDuePages(budgetMs = 45_000): Promise<CheckResult[]> {
    const started = Date.now()
    const { data, error } = await createAdminClient()
        .from('official_pages').select('*, site:official_sites(*)')
        .order('checked_at', { ascending: true, nullsFirst: true })
    if (error) throw new Error(error.message)
    const due = (data as PageWithSite[]).filter(p => p.site.bots_allowed && isDue(p))
    const results: CheckResult[] = []
    for (const p of due) {
        if (Date.now() - started > budgetMs) break
        results.push(await checkPage(p))
        await sleep(GAP_MS)
    }
    return results
}

/** Once every article from a changed page is checked again, the page is back to normal. */
export async function settlePage(pageId: string): Promise<void> {
    const db = createAdminClient()
    const { count } = await db.from('knowledge_articles').select('id', { count: 'exact', head: true })
        .eq('official_page_id', pageId).not('source_changed_at', 'is', null)
    if (count === 0) await db.from('official_pages').update({ status: 'ok' }).eq('id', pageId).eq('status', 'changed')
}

// ─── Finding pages and checking drafts (admin screens) ──────────────────────

const pageListCache = new Map<string, { at: number; urls: string[] }>()

/**
 * Every page address HUB knows for a site: its sitemap (HDB, MAS, CPF), else
 * the links on its home page and on pages already watched (IRAS has no sitemap).
 * Kept for an hour.
 */
async function siteUrls(site: OfficialSite, watched: string[]): Promise<string[]> {
    const hit = pageListCache.get(site.domain)
    if (hit && Date.now() - hit.at < 3_600_000) return hit.urls
    const origin = `https://www.${site.domain}`
    const get = (u: string) => fetch(u, { headers: HEADERS, signal: AbortSignal.timeout(20_000) }).then(r => (r.ok ? r.text() : '')).catch(() => '')
    const locs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1])

    let urls: string[] = []
    const map = await get(`${origin}/sitemap.xml`)
    if (/<sitemapindex/i.test(map)) {
        for (const child of locs(map).slice(0, 8)) urls.push(...locs(await get(child)))
    } else urls = locs(map)

    if (!urls.length) {
        for (const u of [origin + '/', ...watched]) {
            const html = await get(u)
            for (const m of html.matchAll(/href="([^"#]+)"/g)) {
                try { urls.push(new URL(m[1].replace(/&amp;/g, '&'), u).href) } catch { /* not a link */ }
            }
        }
    }
    urls = [...new Set(urls)].filter(u => siteFor(u, [site]) === site)
    pageListCache.set(site.domain, { at: Date.now(), urls })
    return urls
}

/** Pages of an approved site matching a search, not already watched. */
export async function findPages(siteId: string, query: string): Promise<{ url: string; title: string; days: number }[]> {
    const db = createAdminClient()
    const [{ data: site }, { data: pages }] = await Promise.all([
        db.from('official_sites').select('*').eq('id', siteId).maybeSingle(),
        db.from('official_pages').select('url, site_id'),
    ])
    if (!site) return []
    const all = (pages ?? []).map(p => p.url)
    const watched = (pages ?? []).filter(p => p.site_id === siteId).map(p => p.url)
    const urls = await siteUrls(site as OfficialSite, watched)
    return matchPages(urls, query, new Set(all)).map(p => ({ ...p, days: suggestDays(p.title) }))
}

/** For reviewing a draft: the lines of its page holding its figures and words, read live. */
export async function draftEvidence(articleId: string): Promise<{ url: string; evidence: Evidence } | { error: string }> {
    const db = createAdminClient()
    const { data: a } = await db.from('knowledge_articles').select('title, content, official_page_id, source').eq('id', articleId).maybeSingle()
    if (!a?.official_page_id) return { error: 'This article was not drafted from an official page.' }
    const { data: page } = await db.from('official_pages').select('url').eq('id', a.official_page_id).maybeSingle()
    const url = page?.url ?? a.source
    if (!url) return { error: 'The page is no longer on the list.' }
    const read = await readPage(url)
    if (!read.ok) return { error: read.error }
    return { url, evidence: evidence(a.title, a.content, read.text) }
}
