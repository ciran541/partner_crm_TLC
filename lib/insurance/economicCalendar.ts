/**
 * Economic Calendar — FOMC meetings, US CPI releases, MAS Monetary Policy
 * Statements. Three event types, three different sourcing paths feeding one
 * shared table, each verified live during planning rather than assumed:
 *
 *  - fomc_meeting: scraped from the Fed's own official calendar page
 *    (federalreserve.gov) — confirmed reachable and parseable, unlike most
 *    other .gov sources tried during planning (MAS, BLS block automated
 *    requests entirely).
 *  - us_cpi: release *dates* come from BLS's own iCalendar feed
 *    (bls.gov/schedule/news_release/bls.ics) — BUT BLS blocks automated
 *    fetches of this exact file too (confirmed: 403 even with a browser
 *    User-Agent), so an admin downloads it manually in their own browser and
 *    pastes the content in via importCpiIcsDates(). BLS publishes ~18 months
 *    ahead, so this is a rare (roughly annual) admin action, not routine
 *    data entry. Actual/previous/forecast *values* come from FRED
 *    automatically — CPIAUCSL (units=pc1, the YoY % figure) for actual/
 *    previous, and EXPINF1YR (1-year inflation expectation) as a free,
 *    honestly-labeled forecast proxy — literal analyst "consensus" figures
 *    aren't available without a paid calendar API.
 *  - mas_mps: no accessible schedule or API exists — checked MAS's own
 *    108-product API catalog directly (search: "monetary policy", "policy
 *    statement", "exchange rate" — no match) and their news pages (blocked
 *    site-wide). Admin-entered, quarterly (MAS's own Advance Release Calendar
 *    shows Monetary Policy Statement as a quarterly release — Jan/Apr/Jul/Oct
 *    — not semi-annual as originally assumed), whenever MAS's own Advance
 *    Release Calendar (mas.gov.sg/monetary-policy/advance-release-calendar,
 *    also blocked to automated fetches) shows the next "NLT" (Not Later Than)
 *    date.
 *
 * Admin-owned columns (impact_stars, hidden, admin_notes, and any value an
 * admin manually corrects) are never touched by upsert(..., ignoreDuplicates:
 * true) — same pattern as sora.ts and news.ts.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { EconomicCalendarEvent, EconomicCalendarEventInput, EventKey } from '@/lib/types/calendar'
import { EVENT_KEYS } from '@/lib/types/calendar'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
}

// ── FOMC (scraped) ───────────────────────────────────────────────────────────

async function fetchFomcDates(): Promise<string[]> {
    try {
        const res = await fetch('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            next: { revalidate: 86400 },
        })
        if (!res.ok) {
            console.error('[economicCalendar] Fed calendar fetch failed:', res.status)
            return []
        }
        const html = await res.text()
        const text = stripHtml(html)
        const parts = text.split(/(\d{4}) FOMC Meetings/)

        // Grace window for "just happened" meetings, as a plain YYYY-MM-DD string.
        const c = new Date()
        c.setUTCMonth(c.getUTCMonth() - 1)
        const cutoff = c.toISOString().slice(0, 10)

        const dates: string[] = []
        for (let i = 1; i < parts.length; i += 2) {
            const year = parseInt(parts[i], 10)
            const content = parts[i + 1] ?? ''
            const monthPattern = new RegExp(`(${MONTHS.join('|')})\\s+(\\d{1,2})-(\\d{1,2})\\*?`, 'g')
            let m: RegExpExecArray | null
            while ((m = monthPattern.exec(content))) {
                const monthIdx = MONTHS.indexOf(m[1])
                const endDay = parseInt(m[3], 10)
                if (monthIdx < 0 || !endDay) continue
                // Build the date string directly. `new Date(y, m, d).toISOString()` was
                // used here before, which reads the components as LOCAL midnight and
                // then converts to UTC — in any timezone ahead of UTC that lands on the
                // previous day, so the same meeting stored one date when the cron ran on
                // Vercel (UTC) and a different one when it ran from a dev machine (SGT),
                // producing duplicate rows a day apart under two external_keys.
                const date = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`
                if (date < cutoff) continue
                dates.push(date)
            }
        }
        return dates
    } catch (e) {
        console.error('[economicCalendar] Fed calendar fetch threw:', String(e))
        return []
    }
}

// ── Result links ─────────────────────────────────────────────────────────────
// Each event type's published result lives at a different kind of address. All
// three were confirmed live with Node's fetch() rather than assumed — note that
// curl gets a 403 from BLS and a decoy "Maintenance" page from MAS where Node's
// fetch() succeeds, so a curl failure is not evidence a source is unreachable.

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/**
 * The Fed publishes each statement at a predictable URL keyed to the meeting's
 * FINAL day — which is exactly the date fetchFomcDates() stores. Verified live
 * against three past meetings (all HTTP 200). No fetch needed to build it.
 */
function fomcStatementUrl(eventDate: string): string {
    return `https://www.federalreserve.gov/newsevents/pressreleases/monetary${eventDate.replace(/-/g, '')}a.htm`
}

/** BLS archives each CPI release as cpi_MMDDYYYY.htm — verified live (200 via Node fetch). */
function cpiReleaseUrl(eventDate: string): string {
    const [y, m, d] = eventDate.split('-')
    return `https://www.bls.gov/news.release/archives/cpi_${m}${d}${y}.htm`
}

/**
 * A constructed URL is a guess until proven otherwise, so nothing derived from a
 * date is stored without checking it resolves. This also handles the legitimate
 * "not published yet" case — a statement for a meeting that ended hours ago 404s
 * until the Fed posts it, and the next nightly run picks it up.
 *
 * HEAD is not used: some .gov hosts answer it differently from a real page load.
 */
async function urlResolves(url: string): Promise<boolean> {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
            signal: AbortSignal.timeout(15_000),
        })
        return res.ok
    } catch {
        return false
    }
}

/**
 * MAS publishes each MPS under /news/monetary-policy-statements/. There's no
 * schedule API (see the file header), but the already-published releases are
 * findable through the same site-search API that powers Mortgage News —
 * filtering on the URL path isolates them cleanly from general MAS news.
 * Returns date (YYYY-MM-DD) → absolute URL.
 */
async function fetchMasMpsLinks(): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    try {
        const url = 'https://www.mas.gov.sg/api/v1/search?json.nl=map&indent=on'
            + '&q=*%3A*&fq=page_url_s%3A*monetary-policy-statement*&sort=mas_date_tdt+desc&rows=20'
        const res = await fetch(url, {
            // Same WAF workaround as news.ts — without a browser UA + Referer this
            // endpoint returns a decoy HTML "Maintenance" page instead of JSON.
            headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA, Referer: 'https://www.mas.gov.sg/news' },
        })
        if (!res.ok) {
            console.error('[economicCalendar] MAS MPS search failed:', res.status)
            return out
        }
        const text = await res.text()
        if (text.startsWith('<')) {
            console.error('[economicCalendar] MAS MPS search returned the decoy HTML page, not JSON')
            return out
        }
        const docs: { page_url_s?: string; mas_date_tdt?: string }[] = JSON.parse(text)?.response?.docs ?? []
        for (const doc of docs) {
            const date = (doc.mas_date_tdt ?? '').slice(0, 10)
            // The listing page itself ("Monetary Policy Statements") also matches the
            // path filter — only individual dated releases carry a /news/ URL.
            if (!date || !doc.page_url_s?.startsWith('/news/')) continue
            if (!out.has(date)) out.set(date, `https://www.mas.gov.sg${doc.page_url_s}`)
        }
    } catch (e) {
        console.error('[economicCalendar] MAS MPS search threw:', String(e))
    }
    return out
}

// ── CPI values (FRED) ────────────────────────────────────────────────────────

/**
 * Fed funds target range, upper bound — the numeric outcome of an FOMC meeting.
 * FRED is already a dependency here (CPI values) and elsewhere in the app.
 */
async function fetchFedTargetRate(): Promise<number | null> {
    const key = process.env.FRED_API_KEY
    if (!key) return null
    try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=DFEDTARU&api_key=${key}&file_type=json&sort_order=desc&limit=1`
        const res = await fetch(url, { next: { revalidate: 86400 } })
        if (!res.ok) {
            console.error('[economicCalendar] FRED DFEDTARU fetch failed:', res.status)
            return null
        }
        const json = await res.json()
        const obs = (json.observations ?? []).filter((o: { value: string }) => o.value !== '.')
        return obs[0] ? parseFloat(obs[0].value) : null
    } catch (e) {
        console.error('[economicCalendar] FRED DFEDTARU fetch threw:', String(e))
        return null
    }
}

/**
 * CPI year-on-year by REFERENCE MONTH, keyed 'YYYY-MM'.
 *
 * Each release reports the previous calendar month (the 14 Jul 2026 release
 * carries June 2026 data), so an actual can only be assigned by matching the
 * release to its reference month. An earlier version instead stamped whatever
 * FRED's latest reading happened to be onto "the most recent past release still
 * missing an actual", one row per nightly run — which wrote the same figure
 * across six different months of releases.
 */
async function fetchCpiSeries(): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    const key = process.env.FRED_API_KEY
    if (!key) {
        console.error('[economicCalendar] FRED_API_KEY not set')
        return out
    }
    try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&api_key=${key}&file_type=json&units=pc1&sort_order=desc&limit=36`
        const res = await fetch(url, { next: { revalidate: 86400 } })
        if (!res.ok) {
            console.error('[economicCalendar] FRED CPI fetch failed:', res.status)
            return out
        }
        const json = await res.json()
        for (const o of (json.observations ?? []) as { date: string; value: string }[]) {
            if (o.value === '.') continue
            out.set(o.date.slice(0, 7), parseFloat(o.value))
        }
    } catch (e) {
        console.error('[economicCalendar] FRED CPI fetch threw:', String(e))
    }
    return out
}

/** The reference month a release reports on — the calendar month before it. */
function cpiReferenceMonth(releaseDate: string): string {
    const [y, m] = releaseDate.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 2, 1))   // m is 1-based; -2 steps back one month
    return d.toISOString().slice(0, 7)
}

async function fetchInflationExpectation(): Promise<number | null> {
    const key = process.env.FRED_API_KEY
    if (!key) return null
    try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=EXPINF1YR&api_key=${key}&file_type=json&sort_order=desc&limit=1`
        const res = await fetch(url, { next: { revalidate: 86400 } })
        if (!res.ok) {
            console.error('[economicCalendar] FRED EXPINF1YR fetch failed:', res.status)
            return null
        }
        const json = await res.json()
        const obs = (json.observations ?? []).filter((o: { value: string }) => o.value !== '.')
        return obs[0] ? parseFloat(obs[0].value) : null
    } catch (e) {
        console.error('[economicCalendar] FRED EXPINF1YR fetch threw:', String(e))
        return null
    }
}

// ── CPI release dates (admin-pasted BLS ICS) ────────────────────────────────

/** Parses a raw .ics calendar (BLS's own export) for "Consumer Price Index" release dates. */
export function parseIcsCpiDates(icsContent: string): string[] {
    const dates: string[] = []
    const blocks = icsContent.split('BEGIN:VEVENT').slice(1)
    for (const block of blocks) {
        if (!/SUMMARY:Consumer Price Index/i.test(block)) continue
        const m = block.match(/DTSTART(?:;[^:\r\n]*)?:(\d{8})/)
        if (!m) continue
        const raw = m[1]
        dates.push(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`)
    }
    return dates
}

export async function importCpiIcsDates(icsContent: string): Promise<{ imported: number; skipped: number }> {
    const admin = createAdminClient()
    const dates = parseIcsCpiDates(icsContent)
    let imported = 0, skipped = 0
    for (const eventDate of dates) {
        const { error } = await admin.from('economic_calendar_events').upsert({
            event_key: 'us_cpi',
            event_name: 'US CPI',
            event_date: eventDate,
            unit: '%',
            impact_stars: 4,
            external_key: `cpi:${eventDate}`,
            fetched_at: new Date().toISOString(),
        }, { onConflict: 'external_key', ignoreDuplicates: true })
        if (error) { console.error('[economicCalendar] CPI ICS import row failed:', error.message); skipped++ }
        else imported++
    }
    return { imported, skipped }
}

// ── Cron entrypoint ──────────────────────────────────────────────────────────

/**
 * Refreshes FOMC dates (scrape) and CPI actual/previous/forecast (FRED).
 * Does NOT touch CPI release dates — those only change via importCpiIcsDates(),
 * an explicit admin action, since they can't be fetched automatically.
 */
export async function refreshAll(): Promise<{ fomcUpserted: number; cpiUpdated: number; resultsLinked: number }> {
    const admin = createAdminClient()
    const today = new Date().toISOString().slice(0, 10)

    const fomcDates = await fetchFomcDates()
    let fomcUpserted = 0
    for (const eventDate of fomcDates) {
        const { error } = await admin.from('economic_calendar_events').upsert({
            event_key: 'fomc_meeting',
            event_name: 'FOMC Meeting',
            event_date: eventDate,
            unit: null,
            impact_stars: 5,
            external_key: `fomc:${eventDate}`,
            fetched_at: new Date().toISOString(),
        }, { onConflict: 'external_key', ignoreDuplicates: true })
        if (!error) fomcUpserted++
    }

    const [cpiSeries, forecast] = await Promise.all([
        fetchCpiSeries(),
        fetchInflationExpectation(),
    ])

    const latestMonth = [...cpiSeries.keys()].sort().pop() ?? null
    const latestCpi = latestMonth ? cpiSeries.get(latestMonth)! : null

    let cpiUpdated = 0

    // Nearest upcoming release: it hasn't happened, so it gets the last published
    // reading as "previous" plus the inflation-expectation proxy as "forecast".
    if (latestCpi != null || forecast != null) {
        const { data: upcoming } = await admin
            .from('economic_calendar_events')
            .select('id')
            .eq('event_key', 'us_cpi')
            .gte('event_date', today)
            .order('event_date', { ascending: true })
            .limit(1)
        if (upcoming?.[0]) {
            await admin.from('economic_calendar_events')
                .update({ previous: latestCpi, forecast, updated_at: new Date().toISOString() })
                .eq('id', upcoming[0].id)
            cpiUpdated++
        }
    }

    // Past releases: each gets the figure for the month it actually reported on.
    // Scraped rows are corrected if they disagree with FRED (FRED is authoritative
    // for this number); admin-created rows are left alone.
    if (cpiSeries.size) {
        const { data: pastCpi } = await admin
            .from('economic_calendar_events')
            .select('id, event_date, actual, previous, is_manual')
            .eq('event_key', 'us_cpi')
            .lt('event_date', today)
            .order('event_date', { ascending: false })
            .limit(36)
        for (const row of (pastCpi ?? []) as { id: string; event_date: string; actual: number | null; previous: number | null; is_manual: boolean }[]) {
            if (row.is_manual) continue
            const refMonth = cpiReferenceMonth(row.event_date)
            const actual = cpiSeries.get(refMonth)
            if (actual == null) continue
            const prevMonth = cpiReferenceMonth(`${refMonth}-01`)
            const previous = cpiSeries.get(prevMonth) ?? null
            if (row.actual === actual && row.previous === previous) continue
            await admin.from('economic_calendar_events')
                .update({ actual, previous, updated_at: new Date().toISOString() })
                .eq('id', row.id)
            cpiUpdated++
        }
    }

    const resultsLinked = await linkResults(today)

    return { fomcUpserted, cpiUpdated, resultsLinked }
}

/**
 * Attaches published results to events that have already happened: a source link
 * for all three event types, plus the post-meeting Fed target rate as the FOMC
 * "actual". Only ever fills gaps — a row that already has a source_url is left
 * alone, so an admin correction is never overwritten (same rule as impact_stars
 * and admin_notes).
 */
async function linkResults(today: string): Promise<number> {
    const admin = createAdminClient()
    let linked = 0

    const { data: past } = await admin
        .from('economic_calendar_events')
        .select('id, event_key, event_date, actual, source_url')
        .lt('event_date', today)
        .is('source_url', null)
        .order('event_date', { ascending: false })
        .limit(60)
    if (!past?.length) return 0

    const rows = past as { id: string; event_key: EventKey; event_date: string; actual: number | null; source_url: string | null }[]

    // One lookup for every MAS row, rather than per row.
    const masLinks = rows.some(r => r.event_key === 'mas_mps') ? await fetchMasMpsLinks() : new Map<string, string>()
    // The target rate that came out of the most recent meeting — only meaningful
    // for the latest past FOMC row, so older ones get a link but no actual.
    const latestFomcId = rows.find(r => r.event_key === 'fomc_meeting' && r.actual == null)?.id
    const fedRate = latestFomcId ? await fetchFedTargetRate() : null

    for (const row of rows) {
        const patch: { source_url?: string; actual?: number; updated_at: string } = { updated_at: new Date().toISOString() }

        if (row.event_key === 'fomc_meeting') {
            const url = fomcStatementUrl(row.event_date)
            if (!(await urlResolves(url))) continue
            patch.source_url = url
            if (row.id === latestFomcId && fedRate != null) patch.actual = fedRate
        } else if (row.event_key === 'us_cpi') {
            const url = cpiReleaseUrl(row.event_date)
            if (!(await urlResolves(url))) continue
            patch.source_url = url
        } else if (row.event_key === 'mas_mps') {
            // MAS's own published date is authoritative; fall back to the stored
            // scheduled date, which for MPS is an admin-entered "not later than".
            const url = masLinks.get(row.event_date)
                ?? [...masLinks.entries()].find(([d]) => Math.abs(Date.parse(d) - Date.parse(row.event_date)) <= 7 * 86400_000)?.[1]
            if (!url) continue
            patch.source_url = url
        } else {
            continue
        }

        const { error } = await admin.from('economic_calendar_events').update(patch).eq('id', row.id)
        if (!error) linked++
    }

    return linked
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getUpcomingEvents(fromDate: string, toDate: string): Promise<EconomicCalendarEvent[]> {
    const admin = createAdminClient()
    const { data } = await admin
        .from('economic_calendar_events')
        .select('*')
        .eq('hidden', false)
        .gte('event_date', fromDate)
        .lte('event_date', toDate)
        .order('event_date', { ascending: true })
    return (data ?? []) as EconomicCalendarEvent[]
}

export async function getAllEvents(): Promise<EconomicCalendarEvent[]> {
    const admin = createAdminClient()
    const { data } = await admin
        .from('economic_calendar_events')
        .select('*')
        .order('event_date', { ascending: false })
        .limit(300)
    return (data ?? []) as EconomicCalendarEvent[]
}

/** Nearest upcoming event per event_key — powers the 3 countdown badges. */
export function getNearestByKey(events: EconomicCalendarEvent[], today: string): Partial<Record<EventKey, EconomicCalendarEvent>> {
    const result: Partial<Record<EventKey, EconomicCalendarEvent>> = {}
    for (const key of EVENT_KEYS) {
        const upcoming = events
            .filter(e => e.event_key === key && e.event_date >= today)
            .sort((a, b) => a.event_date.localeCompare(b.event_date))
        if (upcoming[0]) result[key] = upcoming[0]
    }
    return result
}

// ── Admin QA (manual MAS MPS entry + overrides — not the automated path) ────

const DEFAULT_STARS: Record<EventKey, number> = { fomc_meeting: 5, us_cpi: 4, mas_mps: 5 }

export async function createManualEvent(input: EconomicCalendarEventInput): Promise<EconomicCalendarEvent | null> {
    const admin = createAdminClient()
    const externalKey = `manual:${input.event_key}:${input.event_date}:${Date.now()}`
    const { data, error } = await admin
        .from('economic_calendar_events')
        .insert({
            ...input,
            external_key: externalKey,
            is_manual: true,
            impact_stars: input.impact_stars ?? DEFAULT_STARS[input.event_key] ?? 3,
        })
        .select()
        .single()
    if (error) {
        console.error('[economicCalendar] createManualEvent failed:', error.message)
        return null
    }
    return data as EconomicCalendarEvent
}

export async function updateEvent(id: string, patch: Partial<EconomicCalendarEventInput>): Promise<boolean> {
    const admin = createAdminClient()
    const { error } = await admin
        .from('economic_calendar_events')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
    return !error
}

export async function deleteEvent(id: string): Promise<boolean> {
    const admin = createAdminClient()
    const { error } = await admin.from('economic_calendar_events').delete().eq('id', id)
    return !error
}

export async function setHidden(id: string, hidden: boolean): Promise<boolean> {
    const admin = createAdminClient()
    const { error } = await admin
        .from('economic_calendar_events')
        .update({ hidden, updated_at: new Date().toISOString() })
        .eq('id', id)
    return !error
}
