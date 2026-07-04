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

        const cutoff = new Date()
        cutoff.setMonth(cutoff.getMonth() - 1)   // small grace window for "just happened" meetings

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
                const date = new Date(year, monthIdx, endDay)
                if (date < cutoff) continue
                dates.push(date.toISOString().slice(0, 10))
            }
        }
        return dates
    } catch (e) {
        console.error('[economicCalendar] Fed calendar fetch threw:', String(e))
        return []
    }
}

// ── CPI values (FRED) ────────────────────────────────────────────────────────

async function fetchCpiActualPrevious(): Promise<{ actual: number | null; previous: number | null }> {
    const key = process.env.FRED_API_KEY
    if (!key) {
        console.error('[economicCalendar] FRED_API_KEY not set')
        return { actual: null, previous: null }
    }
    try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&api_key=${key}&file_type=json&units=pc1&sort_order=desc&limit=2`
        const res = await fetch(url, { next: { revalidate: 86400 } })
        if (!res.ok) {
            console.error('[economicCalendar] FRED CPI fetch failed:', res.status)
            return { actual: null, previous: null }
        }
        const json = await res.json()
        const obs = (json.observations ?? []).filter((o: { value: string }) => o.value !== '.')
        return {
            actual: obs[0] ? parseFloat(obs[0].value) : null,
            previous: obs[1] ? parseFloat(obs[1].value) : null,
        }
    } catch (e) {
        console.error('[economicCalendar] FRED CPI fetch threw:', String(e))
        return { actual: null, previous: null }
    }
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
export async function refreshAll(): Promise<{ fomcUpserted: number; cpiUpdated: number }> {
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

    const [{ actual, previous }, forecast] = await Promise.all([
        fetchCpiActualPrevious(),
        fetchInflationExpectation(),
    ])

    let cpiUpdated = 0
    if (actual != null || previous != null || forecast != null) {
        // Apply the latest FRED snapshot to the nearest upcoming release (forecast
        // + previous, since it hasn't happened yet) and the most recent past
        // release still missing an actual (backfills once real data lands).
        const { data: upcoming } = await admin
            .from('economic_calendar_events')
            .select('id')
            .eq('event_key', 'us_cpi')
            .gte('event_date', today)
            .order('event_date', { ascending: true })
            .limit(1)
        if (upcoming?.[0]) {
            await admin.from('economic_calendar_events')
                .update({ previous, forecast, updated_at: new Date().toISOString() })
                .eq('id', upcoming[0].id)
            cpiUpdated++
        }

        if (actual != null) {
            const { data: pastRows } = await admin
                .from('economic_calendar_events')
                .select('id')
                .eq('event_key', 'us_cpi')
                .lt('event_date', today)
                .is('actual', null)
                .order('event_date', { ascending: false })
                .limit(1)
            if (pastRows?.[0]) {
                await admin.from('economic_calendar_events')
                    .update({ actual, updated_at: new Date().toISOString() })
                    .eq('id', pastRows[0].id)
                cpiUpdated++
            }
        }
    }

    return { fomcUpserted, cpiUpdated }
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
