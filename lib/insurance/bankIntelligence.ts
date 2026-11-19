/**
 * Banks' Insights — discovery of monthly bank research (PDF or web article) +
 * comprehensive AI summary extraction.
 *
 * Discovery: OCBC/UOB publish PDFs, found by fetching each bank's research
 * listing page directly and parsing with a plain regex (no hidden API, no WAF
 * gotcha for either — confirmed live). HSBC publishes a plain article instead
 * of a PDF, and its listing is entirely client-side rendered, so discovery
 * skips it and constructs the article's predictable URL directly (see
 * fetchHsbcReports). All three are fragile to a frontend/URL-scheme redesign,
 * same trade-off already accepted for URA/HDB's news sourcing.
 *
 * Extraction (extractSummary): DeepSeek (paid plan) reads the report's text
 * primarily, Gemini is the fallback on a hard failure — see the longer note
 * above SUMMARY_SYSTEM for why and what that trades off. PDF sources
 * (OCBC/UOB) go through pdf-parse to get that text; HSBC's article page is
 * already clean HTML, so its text comes straight from stripping tags. The
 * summary is comprehensive (outlook, rates view, FX view, whatever sections
 * the report has), not narrowed to just SORA. Extraction runs automatically
 * on discovery, but publishing is a separate admin-gated step (is_published)
 * — same caution already applied to rate-sheet ingestion (extractPackages.ts):
 * AI reads a messy source, a human confirms before agents see it.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { BANK_SOURCES, isPdfUrl } from '@/lib/types/bankIntelligence'
import type { BankIntelligenceReport, BankIntelligenceReportInput } from '@/lib/types/bankIntelligence'

const FEED_TIMEOUT_MS = 15000
// UOB's server intermittently 500s when only a User-Agent is sent (confirmed
// live: same request with no Accept/Accept-Language headers failed ~half the
// time, this full set was consistently 200) — applied to every fetch in this
// file defensively, not just UOB's.
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}

interface RawReport {
    title: string
    pdfUrl: string
    reportPeriod: string    // 'YYYY-MM-01'
    publishedDate: string | null   // 'YYYY-MM-DD'
    series?: string         // set by banks watched for more than one report type (OCBC, UOB)
    archive?: { bytes: Buffer; path: string }   // keep our own copy (source overwritten in place)
}

// Private bucket for our copies of overwritten-in-place reports (UOB FX).
export const ARCHIVE_BUCKET = 'bank-research'

const MONTHS: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

function firstOfMonth(monthAbbrevOrFull: string, year: string): string {
    const key = monthAbbrevOrFull.slice(0, 3).toLowerCase()
    const mm = MONTHS[key] ?? '01'
    return `${year}-${mm}-01`
}

// OCBC is watched on two of its research pages, via "watch rules": which page
// (category tab), which card label, and optionally which words the title must
// contain. Both pages list every report type in the same flat HTML card
// structure (category / title / date / PDF link) — confirmed live, no WAF.
// Checked live against Jul–Nov 2026 before choosing the keywords: Interest
// Rates Focus publishes ~7–13 notes a month, and these two keywords keep
// exactly the SORA and monthly Central Banks Outlook notes (~1–3 a month)
// while skipping UST/JGB/auction commentary. The Daily Market Outlook / FX
// Weekly / Weekly Macro Views cadences are deliberately not watched — at 15–20
// a month they would swamp the admin review gate.
//
// First matching rule wins, so a title hitting both keywords is filed once.
// To watch another OCBC report type, add a rule here; it backfills itself
// (see seriesWithHistory in discoverReports).
interface OcbcWatchRule {
    series: string                     // label stored on the row and shown to agents
    page: 'macro' | 'fxandrates'       // research-with-filter.page?category=<page>
    cardCategory: string               // text after "Macro Views : " / "FX And Rates : " on the card
    titleMatch?: RegExp                // omit to keep every card in that category
}

export const OCBC_WATCH_RULES: OcbcWatchRule[] = [
    { series: 'Research Monitor',      page: 'macro',      cardCategory: 'Monthly Monitor' },
    { series: 'SORA',                  page: 'fxandrates', cardCategory: 'Interest Rates Focus', titleMatch: /\bSORA\b/i },
    { series: 'Central Banks Outlook', page: 'fxandrates', cardCategory: 'Interest Rates Focus', titleMatch: /\bcentral banks?\b/i },
]

// A rule with no reports yet looks back to this month (product decision:
// insights from July 2026 onwards). Once it has history, only the current
// and previous month are checked — the previous month catches a note OCBC
// posts on the 30th/31st after that day's run.
const OCBC_BACKFILL_FROM = { year: 2026, month: 7 }

/** Months to check, oldest first, as { year, month (1-12) } — in SGT, so a
 *  run just after midnight on the 1st already counts as the new month. */
function ocbcMonthsToCheck(backfill: boolean): { year: number; month: number }[] {
    const sgt = new Date(Date.now() + 8 * 3600 * 1000)
    const end = { year: sgt.getUTCFullYear(), month: sgt.getUTCMonth() + 1 }
    const prev = end.month === 1 ? { year: end.year - 1, month: 12 } : { year: end.year, month: end.month - 1 }
    const start = backfill ? OCBC_BACKFILL_FROM : prev

    const out: { year: number; month: number }[] = []
    for (let y = start.year, m = start.month; y < end.year || (y === end.year && m <= end.month); ) {
        out.push({ year: y, month: m })
        if (++m > 12) { m = 1; y++ }
    }
    return out
}

async function fetchOcbcPage(page: OcbcWatchRule['page'], year: number, month: number): Promise<RawReport[]> {
    // monthParam/yearParam are the page's own "Published in" dropdown fields —
    // confirmed live that passing them in the URL returns that month's cards
    // (the default view only shows the current month).
    const url = `https://www.ocbc.com/group/research/research-with-filter.page?category=${page}&monthParam=${MONTHS_FULL[month - 1]}&yearParam=${year}`
    try {
        const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const html = await res.text()

        const re = /<p>([^<]*)<\/p>\s*<h3[^>]*media-filter-media-listing__article-title[^>]*><strong>([^<]*)<\/strong><\/h3><small>([^<]*)<\/small>[\s\S]*?<a href="([^"]*\.pdf)"[^>]*class="link media-filter-media-listing__read-more"/g
        const out: RawReport[] = []
        let m: RegExpExecArray | null
        while ((m = re.exec(html)) !== null) {
            const [, category, rawTitle, dateText, pdfPath] = m
            const title = rawTitle.trim()
            const rule = OCBC_WATCH_RULES.find(r =>
                r.page === page && category.includes(r.cardCategory) && (!r.titleMatch || r.titleMatch.test(title)))
            if (!rule) continue

            // dateText is "01 Jul 2026" — DD Mon YYYY
            const dm = dateText.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)
            const publishedDate = dm ? `${dm[3]}-${MONTHS[dm[2].slice(0, 3).toLowerCase()] ?? '01'}-${dm[1].padStart(2, '0')}` : null
            const reportPeriod = dm ? firstOfMonth(dm[2], dm[3]) : `${year}-${String(month).padStart(2, '0')}-01`
            out.push({
                title,
                pdfUrl: `https://www.ocbc.com${pdfPath}`,
                reportPeriod,
                publishedDate,
                series: rule.series,
            })
        }
        return out
    } catch (e) {
        console.error(`[bankIntelligence] fetchOcbcPage(${page} ${year}-${month}) threw:`, String(e))
        return []
    }
}

/** backfillSeries: watch-rule series with no stored reports yet — their page
 *  is scanned from OCBC_BACKFILL_FROM instead of just the last two months. */
export async function fetchOcbcReports(backfillSeries: Set<string>): Promise<RawReport[]> {
    const pages = [...new Set(OCBC_WATCH_RULES.map(r => r.page))]
    const requests = pages.flatMap(page => {
        const backfill = OCBC_WATCH_RULES.some(r => r.page === page && backfillSeries.has(r.series))
        return ocbcMonthsToCheck(backfill).map(({ year, month }) => fetchOcbcPage(page, year, month))
    })
    const results = (await Promise.all(requests)).flat()

    const seen = new Set<string>()
    return results.filter(r => !seen.has(r.pdfUrl) && seen.add(r.pdfUrl))
}

// ── UOB Group Research (uobgroup.com/research) ────────────────────────────────
// UOB is watched ONLY here. The retail wealth-insights page
// (uob.com.sg/personal/invest/wealth-insights) was dropped in Nov 2026: its
// "Monthly Investment Insights" was renamed "CIO Signals" (old PDFs deleted)
// and is portfolio/investment advice rather than rates — product decision to
// not collect it. The two UOB reports most useful to mortgage agents are on
// UOB Group's research site instead: the quarterly
// House View and the "FX, Interest Rates & Commodities Forecasts" one-pager
// (SORA/SOFR/Fed funds/USD-SGD by quarter). Both linked from
// research/quarterly-global-outlook.page — confirmed live, plain HTML, no WAF.
const UOB_RESEARCH_PDF_BASE = 'https://www.uobgroup.com/assets/web-resources/research/pdf/'
const UOB_HOUSE_VIEW_SERIES = 'House View'
const UOB_FX_SERIES = 'FX & Rates Forecast'
// 3Q26 (published 19 Jun, covers Jul–Sep) is the first edition covering July
// 2026 — the "insights from July 2026" starting point.
const UOB_HOUSE_VIEW_BACKFILL_FROM = { year: 2026, quarter: 3 }
const MONTH_ABBREV = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A Date as 'YYYY-MM-DD' in SGT. */
function sgtIsoDate(d: Date): string {
    return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

// House View files follow hv-<q>q<yyyy>.pdf — confirmed live for 1Q–4Q 2026
// (1Q27 404s until published, ~Jan). Like HSBC, the address is built rather
// than scraped, so the research page being reorganised doesn't break it; any
// hv-*.pdf link on that page is added too, as a backup in case the naming
// changes. Checks the current and next quarter (a quarter's edition comes out
// in the last weeks of the one before: 3Q26 on 19 Jun), or every quarter
// since the backfill start while the series has no stored reports yet.
export async function fetchUobHouseViews(backfill: boolean): Promise<RawReport[]> {
    const sgt = new Date(Date.now() + 8 * 3600 * 1000)
    const cur = { year: sgt.getUTCFullYear(), quarter: Math.floor(sgt.getUTCMonth() / 3) + 1 }
    const next = cur.quarter === 4 ? { year: cur.year + 1, quarter: 1 } : { year: cur.year, quarter: cur.quarter + 1 }
    const start = backfill ? UOB_HOUSE_VIEW_BACKFILL_FROM : cur

    const candidates = new Map<string, { year: number; quarter: number }>()
    for (let { year: y, quarter: q } = start; y < next.year || (y === next.year && q <= next.quarter); ) {
        candidates.set(`${UOB_RESEARCH_PDF_BASE}hv-${q}q${y}.pdf`, { year: y, quarter: q })
        if (++q > 4) { q = 1; y++ }
    }
    try {
        const res = await fetch('https://www.uobgroup.com/research/quarterly-global-outlook.page', {
            headers: BROWSER_HEADERS, signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        })
        if (res.ok) {
            const html = await res.text()
            for (const m of html.matchAll(/\/assets\/web-resources\/research\/pdf\/hv-(\d)q(\d{4})\.pdf/gi)) {
                candidates.set(`${UOB_RESEARCH_PDF_BASE}hv-${m[1]}q${m[2]}.pdf`, { year: Number(m[2]), quarter: Number(m[1]) })
            }
        }
    } catch (e) {
        console.error('[bankIntelligence] UOB research page fetch threw (using built addresses only):', String(e))
    }

    const found = await Promise.all([...candidates].map(async ([url, { year, quarter }]): Promise<RawReport | null> => {
        if (quarter < 1 || quarter > 4) return null
        try {
            // HEAD: these PDFs are 1–2 MB; only existence + date are needed here.
            const res = await fetch(url, { method: 'HEAD', headers: BROWSER_HEADERS, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) })
            if (!res.ok || !(res.headers.get('content-type') ?? '').includes('pdf')) return null
            const lastModified = res.headers.get('last-modified')
            return {
                title: `UOB House View ${quarter}Q ${year}`,
                pdfUrl: url,
                reportPeriod: `${year}-${QUARTER_START_MONTH[quarter - 1]}-01`,
                publishedDate: lastModified ? sgtIsoDate(new Date(lastModified)) : null,
                series: UOB_HOUSE_VIEW_SERIES,
            }
        } catch {
            return null
        }
    }))
    return found.filter((r): r is RawReport => r !== null)
}

// The FX forecast lives at ONE fixed address that UOB overwrites with each
// new edition (~every 6 weeks: 25 Sep → 6 Nov 2026), so a new edition can't
// be spotted by a new URL like every other source. Instead it is downloaded
// (~140 KB) and identified by the "Updated as of 06 Nov 2026" line printed on
// it — falling back to the server's Last-Modified date (which matched, live)
// if UOB ever rewords that line. The edition date goes into pdf_url as a
// fragment (…FX_Int_Rate.pdf#2026-11-06) so each edition is its own row under
// the unique pdf_url, and the bytes are archived to our private bucket so an
// older summary keeps a link to the edition it was written from. Previous
// editions were already overwritten, so there is no backfill for this one.
export async function fetchUobFxForecast(): Promise<RawReport[]> {
    const url = `${UOB_RESEARCH_PDF_BASE}FX_Int_Rate.pdf`
    try {
        const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(30000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const bytes = Buffer.from(await res.arrayBuffer())

        let asOf: string | null = null
        try {
            const { PDFParse } = await import('pdf-parse')
            const parser = new PDFParse({ data: bytes })
            const { text } = await parser.getText()
            await parser.destroy()
            const m = text.match(/Updated as of\s+(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})/i)
            const mm = m ? MONTHS[m[2].toLowerCase()] : undefined
            if (m && mm) asOf = `${m[3]}-${mm}-${m[1].padStart(2, '0')}`
        } catch (e) {
            console.error('[bankIntelligence] UOB FX pdf-parse threw (falling back to Last-Modified):', String(e))
        }
        if (!asOf) {
            const lastModified = res.headers.get('last-modified')
            if (lastModified) asOf = sgtIsoDate(new Date(lastModified))
        }
        if (!asOf) return []

        const [y, mo, d] = asOf.split('-')
        return [{
            title: `FX, Interest Rates & Commodities Forecasts (${Number(d)} ${MONTH_ABBREV[Number(mo) - 1]} ${y})`,
            pdfUrl: `${url}#${asOf}`,
            reportPeriod: `${y}-${mo}-01`,
            publishedDate: asOf,
            series: UOB_FX_SERIES,
            archive: { bytes, path: `uob/fx-int-rate-${asOf}.pdf` },
        }]
    } catch (e) {
        console.error('[bankIntelligence] fetchUobFxForecast threw:', String(e))
        return []
    }
}

// Maybank's monthly listing page carries every month back to mid-2024 in one
// load, each card's thumbnail image filename encoding the month/year
// (fx/jul2026.jpg) right next to its real <h3> title — confirmed live that
// the PDF sits at the same <month><year>.pdf name under a sibling /pdf/fx/
// path (not /images/fx/), so no separate existence-check request is needed
// per candidate, unlike HSBC. The listing's own "Discover" links point to a
// broken intermediate .page URL (confirmed live: 500), so those are ignored
// entirely in favour of the predictable PDF path. No separate published-date
// field is shown on the card, only the covered month, so publishedDate stays
// null here (not fabricated from the period).
async function fetchMaybankReports(): Promise<RawReport[]> {
    try {
        const res = await fetch('https://www.maybank2u.com.sg/en/personal/investment/maybank-research/insights/market-outlook/monthly/index.page', {
            headers: BROWSER_HEADERS,
            signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const html = await res.text()

        const re = /url\(\/iwov-resources\/sg\/images\/fx\/([a-z]{3})(\d{4})\.jpg\)"[\s\S]{0,400}?<h3>([^<]*)<\/h3>/g
        const out: RawReport[] = []
        let m: RegExpExecArray | null
        while ((m = re.exec(html)) !== null) {
            const [, monthAbbrev, year, title] = m
            const mm = MONTHS[monthAbbrev.toLowerCase()]
            if (!mm) continue
            out.push({
                title: title.trim(),
                pdfUrl: `https://www.maybank2u.com.sg/iwov-resources/sg/pdf/fx/${monthAbbrev}${year}.pdf`,
                reportPeriod: `${year}-${mm}-01`,
                publishedDate: null,
            })
        }
        return out
    } catch (e) {
        console.error('[bankIntelligence] fetchMaybankReports threw:', String(e))
        return []
    }
}

// SC's Wealth Insights page — unlike Maybank's, this one does NOT carry a full
// archive; it only shows the 3 most recent "featured" cards across several
// cadences mixed together (Weekly Market View, Global Market Outlook, CIO
// Equity Newsletter, and — seen elsewhere on the page but not in a scrapable
// card — Market Watch / Thematic Report). Filtered to the "Global Market
// Outlook" category specifically, the closest analog to the other banks'
// broad monthly house view. Its PDF filename embeds a unique per-publication
// subtitle slug ("navigating-shifting-sands") that isn't derivable from the
// date alone, so — unlike Maybank/HSBC — there's no predictable-URL shortcut
// here; discovery has to read whatever the listing currently shows. That
// means it can only ever surface the CURRENT latest one, not backfill
// history, but that's fine for staying current going forward (same as how
// MAS MPS or CPI dates are rare-but-still-correctly-handled elsewhere in this
// app). Actual publish cadence for this specific category isn't confirmed
// beyond one observed date (19 June 2026) — worth revisiting once a few
// months of real discovery runs have accumulated evidence either way.
async function fetchScReports(): Promise<RawReport[]> {
    try {
        const res = await fetch('https://www.sc.com/en/wealth-retail-banking/wealth-solutions/wealth-insights/', {
            headers: BROWSER_HEADERS,
            signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const html = await res.text()

        const re = /<h4 class="card__heading"><a class="card__link">([^<]*)<\/a><\/h4><p class="card__description">([^<]*)(?:<br>)+(\d{1,2} [A-Za-z]+ \d{4})<\/p>[\s\S]{0,300}?href="([^"]*\.pdf)"/g
        const out: RawReport[] = []
        let m: RegExpExecArray | null
        while ((m = re.exec(html)) !== null) {
            const [, category, subtitle, dateText, pdfUrl] = m
            if (category.trim() !== 'Global Market Outlook') continue
            const dm = dateText.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)
            if (!dm) continue
            const mm = MONTHS[dm[2].slice(0, 3).toLowerCase()] ?? '01'
            out.push({
                title: `Global Market Outlook: ${subtitle.trim()}`,
                pdfUrl,
                reportPeriod: `${dm[3]}-${mm}-01`,
                publishedDate: `${dm[3]}-${mm}-${dm[1].padStart(2, '0')}`,
            })
        }
        return out
    } catch (e) {
        console.error('[bankIntelligence] fetchScReports threw:', String(e))
        return []
    }
}

// DBS's listing page (cio-asset-allocation.page) links to several sibling
// pieces per quarter under "Quarterly House Views" — the flagship report
// (CIOInsights3Q26.xml) plus companions with a suffix (_Thematics,
// _Alternatives, _AA, _Video) — filtered to the plain, no-suffix filename
// only, the flagship. That link isn't a PDF itself; it's a further article
// page whose own embedded data holds the real PDF path (ArticlePdfPath) and
// metadata (Title, PublishedDate) — a two-fetch discovery, unlike every other
// source here. The PDF itself is NOT served directly from a static path —
// it's proxied through a wrapper API (wrapperapi/generic/download-pdf?
// pdf_path=...) that takes ArticlePdfPath's value as a query param. This was
// initially misread as requiring a private-banking login (the article page's
// own embedded "PDF" shareOptions entry is marked "access":false) — but a
// clean unauthenticated request to the real download endpoint (found via the
// user's own browser DevTools Network tab, same method used for MAS earlier)
// returned the full PDF with zero cookies/auth, confirming that "access"
// flag governs something else, not this download path. Report period is
// derived from the quarter in the slug (3Q26 -> Jul 2026, the first month of
// that quarter), not the earlier publish date.
const QUARTER_START_MONTH = ['01', '04', '07', '10']

async function fetchDbsReports(): Promise<RawReport[]> {
    const out: RawReport[] = []
    try {
        const listingRes = await fetch('https://www.dbs.com.sg/private-banking/aics/investment-strategy/cio-asset-allocation.page', {
            headers: BROWSER_HEADERS,
            signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        })
        if (!listingRes.ok) throw new Error(`HTTP ${listingRes.status}`)
        const listingHtml = await listingRes.text()

        const re = /href="(templatedata\/article\/generic\/data\/en\/CIO\/\d{6}\/CIOInsights(\d)Q(\d{2}))\.xml"/g
        const articlePaths: { path: string; quarter: number; yy: string }[] = []
        let m: RegExpExecArray | null
        while ((m = re.exec(listingHtml)) !== null) {
            articlePaths.push({ path: m[1], quarter: Number(m[2]), yy: m[3] })
        }

        for (const { path, quarter, yy } of articlePaths) {
            const articleRes = await fetch(`https://www.dbs.com.sg/private-banking/aics/${path}.xml`, {
                headers: BROWSER_HEADERS,
                signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
            })
            if (!articleRes.ok) continue
            const html = await articleRes.text()
            const titleM = html.match(/"Title":"([^"]*)"/)
            const dateM = html.match(/"PublishedDate":"(\d{4})-(\d{2})-(\d{2})/)
            const pdfM = html.match(/"ArticlePdfPath":"([^"]*)"/)
            if (!titleM || !pdfM) continue

            const year = `20${yy}`
            const mm = QUARTER_START_MONTH[Math.min(Math.max(quarter - 1, 0), 3)]
            out.push({
                title: titleM[1],
                pdfUrl: `https://www.dbs.com.sg/wrapperapi/generic/download-pdf?pdf_path=${pdfM[1].replace(/^\//, '')}`,
                reportPeriod: `${year}-${mm}-01`,
                publishedDate: dateM ? `${dateM[1]}-${dateM[2]}-${dateM[3]}` : null,
            })
        }
        return out
    } catch (e) {
        console.error('[bankIntelligence] fetchDbsReports threw:', String(e))
        return out
    }
}

// ── DBS weekly series (archive page) ─────────────────────────────────────────
// Two DBS weeklies carry a SORA forecast table in their PDF (the web article
// doesn't): CIO Weekly (Global Economics) has the "DBS Forecast" table —
// Policy Interest Rates, Singapore = 3M SORA — and Macro Insights Weekly (DBS
// Group Research, publication "E & S Weekly") has a 3M SORA OIS row. Both
// checked live: tables extract cleanly via pdf-parse.
//
// Product decision: ONE issue per series per month — the first one — since the
// forecast moves slowly and four near-identical weekly summaries a month would
// swamp the admin review gate. A month that already has a row for the series
// is skipped entirely (coveredPeriods), so later issues that month are never
// even fetched.
//
// Discovery uses the archive page's own filter fields as URL params
// (archive/index.page?geography=global&publication=<code>), which server-render
// the latest 10 issues as embedded JSON (Elasticsearch hits, `\"`-escaped in a
// script tag). Older pages come only from a client-side call to an internal
// DBS search host — deliberately not used. Instead, a series with no stored
// rows can backfill via a predictable article address when it has one:
// CIO Weekly is <YYMMDD>EconomicsWeekly.xml (verified every Friday 3 Jul–
// 11 Sep 2026). Macro Insights Weekly's addresses are irregular (other
// weekdays, mislabelled folders), so it has no backfill and starts from what
// the archive shows (late Sep 2026 — product decision).
//
// extraTitleMatch: issues whose title matches are collected IN ADDITION to the
// first-of-month one, regardless of month coverage (product decision: every
// CIO Weekly with "Fed" in the title, ~1 a month — e.g. 13 Nov "Fed Unlikely to
// Endorse a 50 bps Hike" alongside 6 Nov "Blue Waves"). Their backfill keys off
// "no stored title of this series matches yet" rather than seriesWithHistory,
// so it still runs once for a series that already had first-of-month rows.
interface DbsWeeklySeries {
    series: string
    publication: string        // archive "Publication" facet code
    titleMatch?: RegExp        // E & S Weekly also carries one-off notes (Gold, USD Rates…)
    extraTitleMatch?: RegExp   // also collect every issue whose title matches
    everyIssue?: boolean       // collect every issue, not one per month
    startFrom: { year: number; month: number }
    articlePathFor?: (date: Date) => string   // predictable address, for backfill
}

const DBS_AICS_BASE = 'https://www.dbs.com.sg/private-banking/aics/'

export const DBS_WEEKLY_SERIES: DbsWeeklySeries[] = [
    {
        series: 'CIO Weekly (Economics)',
        publication: 'CIOWEcons',
        extraTitleMatch: /\bFed\b/,   // case-sensitive: "Fed", "Fed’s" — not "federal"/"fed up"
        startFrom: { year: 2026, month: 7 },
        articlePathFor: d => {
            const yy = String(d.getUTCFullYear()).slice(2)
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
            const dd = String(d.getUTCDate()).padStart(2, '0')
            return `templatedata/article/generic/data/en/CIO/${mm}${d.getUTCFullYear()}/${yy}${mm}${dd}EconomicsWeekly.xml`
        },
    },
    {
        series: 'Macro Insights Weekly',
        publication: 'ESW',
        titleMatch: /^Macro Insights Weekly\b/i,
        // Product decision (after first-of-month skipped e.g. 10 Nov "Implications
        // of a slowdown in AI buildout"): every issue, ~4 a month. The listing's
        // latest 10 covers ~10 weeks, so a daily check never misses one.
        everyIssue: true,
        startFrom: { year: 2026, month: 9 },
    },
]

interface DbsArticleRef { path: string; title: string; date: string }   // date 'YYYY-MM-DD'

/** The latest ~10 issues of one publication, from the archive page's embedded JSON. */
async function fetchDbsArchiveListing(publication: string): Promise<DbsArticleRef[]> {
    const url = `${DBS_AICS_BASE}archive/index.page?geography=global&publication=${encodeURIComponent(publication)}`
    try {
        const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const html = (await res.text()).split('\\"').join('"')
        const re = /"_source":\{"results_data":(\{[^{}]*\}),"date_sort":\{"PublishedDate":"(\d{4}-\d{2}-\d{2})/g
        const out: DbsArticleRef[] = []
        const seen = new Set<string>()
        let m: RegExpExecArray | null
        while ((m = re.exec(html)) !== null) {
            try {
                const data = JSON.parse(m[1]) as { Title?: string; RelativeDCRPath?: string }
                if (!data.RelativeDCRPath || !data.Title || seen.has(data.RelativeDCRPath)) continue
                seen.add(data.RelativeDCRPath)
                out.push({ path: data.RelativeDCRPath, title: data.Title.trim(), date: m[2] })
            } catch {
                // one malformed hit shouldn't drop the rest
            }
        }
        return out
    } catch (e) {
        console.error(`[bankIntelligence] DBS archive listing (${publication}) threw:`, String(e))
        return []
    }
}

/** Opens an article page; returns its title, date and PDF download URL (null if missing / no PDF). */
async function resolveDbsArticle(path: string): Promise<{ title: string; date: string | null; pdfUrl: string } | null> {
    try {
        const res = await fetch(`${DBS_AICS_BASE}${path}`, {
            headers: BROWSER_HEADERS, signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
            redirect: 'manual',   // a missing article 307s to an error page
        })
        if (res.status !== 200) return null
        const html = await res.text()
        const titleM = html.match(/"Title":"([^"]*)"/)
        const pdfM = html.match(/"ArticlePdfPath":"([^"]*)"/)
        if (!titleM || !pdfM) return null
        const dateM = html.match(/"PublishedDate":"(\d{4}-\d{2}-\d{2})/)
        return {
            title: titleM[1].trim(),
            date: dateM ? dateM[1] : null,
            pdfUrl: `https://www.dbs.com.sg/wrapperapi/generic/download-pdf?pdf_path=${pdfM[1].replace(/^\//, '')}`,
        }
    } catch {
        return null
    }
}

/** Backfill: issues at the predictable address in a month (Thu/Fri, so a Friday
 *  holiday moved a day earlier is still found), only dates before `before`
 *  (the listing already covers the rest). firstOnly stops at the first hit. */
async function probeDbsIssues(
    s: DbsWeeklySeries, year: number, month: number, opts: { firstOnly: boolean; before: string | null },
): Promise<DbsArticleRef[]> {
    const articlePathFor = s.articlePathFor
    if (!articlePathFor) return []
    const dates: Date[] = []
    for (let day = 1; day <= 31; day++) {
        const d = new Date(Date.UTC(year, month - 1, day))
        if (d.getUTCMonth() !== month - 1 || d.getTime() > Date.now()) break
        if (opts.before && d.toISOString().slice(0, 10) >= opts.before) break
        if (d.getUTCDay() === 4 || d.getUTCDay() === 5) dates.push(d)
    }
    const probe = async (d: Date): Promise<DbsArticleRef | null> => {
        const path = articlePathFor(d)
        const article = await resolveDbsArticle(path)
        return article ? { path, title: article.title, date: article.date ?? d.toISOString().slice(0, 10) } : null
    }
    if (opts.firstOnly) {
        for (const d of dates) {
            const ref = await probe(d)
            if (ref) return [ref]
        }
        return []
    }
    return (await Promise.all(dates.map(probe))).filter((r): r is DbsArticleRef => r !== null)
}

/** What discovery already knows from stored rows. */
interface DiscoveryContext {
    seriesWithHistory: Set<string>          // "<bank>:<series>" with any stored row
    coveredPeriods: Set<string>             // "<bank>:<series>:<YYYY-MM-01>" with a stored row
    titlesBySeries: Map<string, string[]>   // "<bank>:<series>" → stored titles
}

export async function fetchDbsWeeklies(ctx: DiscoveryContext): Promise<RawReport[]> {
    const out: RawReport[] = []
    for (const s of DBS_WEEKLY_SERIES) {
        const key = `dbs:${s.series}`
        const floor = `${s.startFrom.year}-${String(s.startFrom.month).padStart(2, '0')}-01`
        const periodOf = (r: DbsArticleRef) => `${r.date.slice(0, 7)}-01`
        const refs = (await fetchDbsArchiveListing(s.publication)).filter(r => !s.titleMatch || s.titleMatch.test(r.title))

        // Earliest issue per month, for months on/after the start that aren't covered yet.
        const firstByMonth = new Map<string, DbsArticleRef>()
        const consider = (r: DbsArticleRef) => {
            const period = periodOf(r)
            if (period < floor || ctx.coveredPeriods.has(`${key}:${period}`)) return
            const cur = firstByMonth.get(period)
            if (!cur || r.date < cur.date) firstByMonth.set(period, r)
        }
        // Extras — not limited to one per month: every issue (everyIssue) or title-matched ones.
        const extras = new Map<string, DbsArticleRef>()
        const considerExtra = (r: DbsArticleRef) => {
            if ((s.everyIssue || s.extraTitleMatch?.test(r.title)) && periodOf(r) >= floor) extras.set(r.path, r)
        }
        refs.forEach(r => { consider(r); considerExtra(r) })

        // Backfill what the listing can't reach (it only holds ~10 weeks) — incl.
        // a month whose first issue already scrolled off it (listing starts
        // 11 Sep, first issue was 4 Sep).
        if (s.articlePathFor) {
            const oldestListed = refs.reduce<string | null>((min, r) => (!min || r.date < min ? r.date : min), null)
            const backfillFirsts = !ctx.seriesWithHistory.has(key)
            const backfillExtras = !!s.extraTitleMatch &&
                !(ctx.titlesBySeries.get(key) ?? []).some(t => s.extraTitleMatch!.test(t))
            if (backfillFirsts || backfillExtras) {
                for (const { year, month } of monthsFrom(s.startFrom)) {
                    const period = `${year}-${String(month).padStart(2, '0')}-01`
                    if (oldestListed && period > `${oldestListed.slice(0, 7)}-01`) break
                    const needFirst = backfillFirsts && !ctx.coveredPeriods.has(`${key}:${period}`)
                    if (!needFirst && !backfillExtras) continue
                    const found = await probeDbsIssues(s, year, month, { firstOnly: !backfillExtras, before: oldestListed })
                    for (const r of found) {
                        if (needFirst) consider(r)
                        if (backfillExtras) considerExtra(r)
                    }
                }
            }
        }

        const picked = new Map<string, DbsArticleRef>([...firstByMonth.values(), ...extras.values()].map(r => [r.path, r]))
        for (const ref of picked.values()) {
            const article = await resolveDbsArticle(ref.path)
            if (!article) continue
            out.push({
                title: article.title || ref.title,
                pdfUrl: article.pdfUrl,
                reportPeriod: periodOf(ref),
                publishedDate: article.date ?? ref.date,
                series: s.series,
            })
        }
    }
    return out
}

/** { year, month } from a start month through the current SGT month. */
function monthsFrom(start: { year: number; month: number }): { year: number; month: number }[] {
    const sgt = new Date(Date.now() + 8 * 3600 * 1000)
    const end = { year: sgt.getUTCFullYear(), month: sgt.getUTCMonth() + 1 }
    const out: { year: number; month: number }[] = []
    for (let y = start.year, m = start.month; y < end.year || (y === end.year && m <= end.month); ) {
        out.push({ year: y, month: m })
        if (++m > 12) { m = 1; y++ }
    }
    return out
}

const MONTHS_FULL = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
]

// ── HSBC ─────────────────────────────────────────────────────────────────────
// Two monthly series, neither with a SORA forecast (both are global views —
// accepted as context, product decision):
//
// 1. Private Bank "Monthly View" (Global CIO). Its House Views listing is
//    client-side rendered, but each edition sits at a PREDICTABLE address
//    (monthly-view-<month>-<year>/, live Aug–Nov 2026). Nov 2026: that page
//    became a VIDEO page — its article text is a ~370-char blurb, and the old
//    <h1 class="article-title"> is gone, which made discovery silently find
//    nothing. The real content is a summary PDF linked from the page, whose
//    filename AND folder vary per edition (…summary-aug-2026.pdf,
//    …summary-october-2026.pdf, a video-transcripts/ folder for November), so
//    extraction reads the link off the page (hsbcMonthlyViewPdfUrl) rather than
//    guessing it. pdf_url stays the page URL — stable for dedupe with older
//    rows, and agents' link opens the page with the video + downloads.
//    Editions publish the month BEFORE the month they cover (Nov ed. 22 Oct),
//    so next month is checked too; first available edition is Aug 2026.
//
// 2. HSBC Singapore "Macro Monthly" (wealth insights). PDF at a predictable
//    address (macro-monthly-<mon>-<yyyy>.pdf — Sep/Oct/Nov 2026 live; Jul/Aug
//    exist under no name tried, so it starts Sep 2026). Titles come from the
//    two latest article pages on the Macro Monthly listing (each links its
//    PDF); an older PDF found only by address gets a generic title.
const HSBC_MONTHLY_VIEW_SERIES = 'Monthly View'
const HSBC_MACRO_MONTHLY_SERIES = 'Macro Monthly'
const HSBC_MONTHLY_VIEW_FROM = { year: 2026, month: 8 }
const HSBC_MACRO_MONTHLY_FROM = { year: 2026, month: 9 }
const HSBC_MACRO_MONTHLY_PDF_BASE = 'https://www.hsbc.com.sg/content/dam/hsbc/en/docs/wealth-insights/market-outlook/macro-monthly/'

/** Previous, current and next month (SGT) — or every month from `from` through
 *  next month when backfilling. Next month: HSBC publishes editions early. */
function hsbcMonthsToCheck(backfill: boolean, from: { year: number; month: number }): { year: number; month: number }[] {
    const sgt = new Date(Date.now() + 8 * 3600 * 1000)
    const shift = (n: number) => {
        const d = new Date(Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth() + n, 1))
        return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
    }
    const next = shift(1)
    const start = backfill ? from : shift(-1)
    const out: { year: number; month: number }[] = []
    for (let y = start.year, m = start.month; y < next.year || (y === next.year && m <= next.month); ) {
        out.push({ year: y, month: m })
        if (++m > 12) { m = 1; y++ }
    }
    return out
}

async function fetchHsbcMonthlyViews(backfill: boolean): Promise<RawReport[]> {
    const found = await Promise.all(hsbcMonthsToCheck(backfill, HSBC_MONTHLY_VIEW_FROM).map(async ({ year, month }): Promise<RawReport | null> => {
        const url = `https://www.privatebanking.hsbc.com/wih/investments-Insights/House-views/monthly-view-${MONTHS_FULL[month - 1]}-${year}/`
        try {
            const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) })
            if (!res.ok) return null
            const html = await res.text()
            const title = (html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1] ?? html.match(/<title>([^<|]+)/)?.[1] ?? '').trim()
            if (!title) return null
            const dateMatch = html.match(/<span class="A-TYP16R-RW-ALL">([A-Za-z]+ \d{1,2}, \d{4})<\/span>/)
            return {
                title,
                pdfUrl: url,
                reportPeriod: `${year}-${String(month).padStart(2, '0')}-01`,
                publishedDate: dateMatch ? parseHsbcDate(dateMatch[1]) : null,
                series: HSBC_MONTHLY_VIEW_SERIES,
            }
        } catch (e) {
            console.error(`[bankIntelligence] HSBC Monthly View ${year}-${month} threw:`, String(e))
            return null
        }
    }))
    return found.filter((r): r is RawReport => r !== null)
}

/** The Monthly View page's content PDF: the GIC summary if linked, else the video transcript. */
function hsbcMonthlyViewPdfUrl(html: string): string | null {
    const links = [...new Set([...html.matchAll(/href="([^"]+\.pdf)"/gi)].map(m => m[1]))]
    const pick = links.find(l => /summary/i.test(l)) ?? links.find(l => /transcript/i.test(l))
    if (!pick) return null
    return pick.startsWith('http') ? pick : `https://www.privatebanking.hsbc.com${pick}`
}

async function fetchHsbcMacroMonthly(backfill: boolean): Promise<RawReport[]> {
    const byUrl = new Map<string, RawReport>()

    // Titles + PDF links from the latest article pages on the listing.
    try {
        const res = await fetch('https://www.hsbc.com.sg/wealth/insights/market-outlook/macro-monthly/', {
            headers: BROWSER_HEADERS, signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        })
        if (res.ok) {
            const html = await res.text()
            const articles = new Map<string, string>()   // path → title
            for (const m of html.matchAll(/href="(\/wealth\/insights\/market-outlook\/macro-monthly\/[^"]+\/)"[^>]*>\s*<span class="link text">\s*([^<]+?)\s*<\/span>/g)) {
                articles.set(m[1], m[2].replace(/&amp;/g, '&').trim())
            }
            await Promise.all([...articles].map(async ([path, title]) => {
                try {
                    const art = await fetch(`https://www.hsbc.com.sg${path}`, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) })
                    if (!art.ok) return
                    const pdf = (await art.text()).match(/href="([^"]*\/macro-monthly\/macro-monthly-([a-z]{3})-(\d{4})\.pdf)"/i)
                    const mm = pdf ? MONTHS[pdf[2].toLowerCase()] : undefined
                    if (!pdf || !mm) return
                    const pdfUrl = pdf[1].startsWith('http') ? pdf[1] : `https://www.hsbc.com.sg${pdf[1]}`
                    byUrl.set(pdfUrl, { title, pdfUrl, reportPeriod: `${pdf[3]}-${mm}-01`, publishedDate: null, series: HSBC_MACRO_MONTHLY_SERIES })
                } catch { /* fall back to the address probe below */ }
            }))
        }
    } catch (e) {
        console.error('[bankIntelligence] HSBC Macro Monthly listing threw:', String(e))
    }

    // Predictable PDF addresses — catches anything the listing no longer shows,
    // and supplies the publish date (Last-Modified) for every edition.
    await Promise.all(hsbcMonthsToCheck(backfill, HSBC_MACRO_MONTHLY_FROM).map(async ({ year, month }) => {
        const pdfUrl = `${HSBC_MACRO_MONTHLY_PDF_BASE}macro-monthly-${MONTH_ABBREV[month - 1].toLowerCase()}-${year}.pdf`
        try {
            const res = await fetch(pdfUrl, { method: 'HEAD', headers: BROWSER_HEADERS, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) })
            if (!res.ok || !(res.headers.get('content-type') ?? '').includes('pdf')) return
            const lastModified = res.headers.get('last-modified')
            const publishedDate = lastModified ? sgtIsoDate(new Date(lastModified)) : null
            const known = byUrl.get(pdfUrl)
            byUrl.set(pdfUrl, known ? { ...known, publishedDate } : {
                title: `Macro Monthly (${MONTH_ABBREV[month - 1]} ${year})`,
                pdfUrl,
                reportPeriod: `${year}-${String(month).padStart(2, '0')}-01`,
                publishedDate,
                series: HSBC_MACRO_MONTHLY_SERIES,
            })
        } catch { /* not published (yet) */ }
    }))

    const floor = `${HSBC_MACRO_MONTHLY_FROM.year}-${String(HSBC_MACRO_MONTHLY_FROM.month).padStart(2, '0')}-01`
    return [...byUrl.values()].filter(r => r.reportPeriod >= floor)
}

export async function fetchHsbcReports(seriesWithHistory: Set<string>): Promise<RawReport[]> {
    const [views, macro] = await Promise.all([
        fetchHsbcMonthlyViews(!seriesWithHistory.has(`hsbc:${HSBC_MONTHLY_VIEW_SERIES}`)),
        fetchHsbcMacroMonthly(!seriesWithHistory.has(`hsbc:${HSBC_MACRO_MONTHLY_SERIES}`)),
    ])
    return [...views, ...macro]
}

// "Jun 26, 2026" -> "2026-06-26"
function parseHsbcDate(text: string): string | null {
    const m = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/)
    if (!m) return null
    const mm = MONTHS[m[1].slice(0, 3).toLowerCase()] ?? '01'
    return `${m[3]}-${mm}-${m[2].padStart(2, '0')}`
}

// Last-resort text for a Monthly View page with no linked PDF — since the Nov
// 2026 video redesign this is only a short blurb, so the PDF path comes first.
function extractHsbcArticleText(html: string): string | null {
    const start = html.indexOf('<div class="article-content">')
    if (start === -1) return null
    const end = html.indexOf('</div></div>', start)
    const block = end === -1 ? html.slice(start) : html.slice(start, end)
    const text = block
        .replace(/<[^>]*>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    return text || null
}

async function fetchReports(sourceKey: (typeof BANK_SOURCES)[number]['key'], ctx: DiscoveryContext): Promise<RawReport[]> {
    const { seriesWithHistory } = ctx
    if (sourceKey === 'ocbc') {
        const backfill = new Set(OCBC_WATCH_RULES.map(r => r.series).filter(s => !seriesWithHistory.has(`ocbc:${s}`)))
        return fetchOcbcReports(backfill)
    }
    if (sourceKey === 'uob') {
        const [houseViews, fx] = await Promise.all([
            fetchUobHouseViews(!seriesWithHistory.has(`uob:${UOB_HOUSE_VIEW_SERIES}`)),
            fetchUobFxForecast(),
        ])
        return [...houseViews, ...fx]
    }
    if (sourceKey === 'hsbc') return fetchHsbcReports(seriesWithHistory)
    if (sourceKey === 'maybank') return fetchMaybankReports()
    if (sourceKey === 'sc') return fetchScReports()
    if (sourceKey === 'dbs') {
        const [quarterly, weeklies] = await Promise.all([
            fetchDbsReports(),
            fetchDbsWeeklies(ctx),
        ])
        return [...quarterly, ...weeklies]
    }
    return []
}

// ── Discovery ────────────────────────────────────────────────────────────────

/** Cron entrypoint: discover new reports, then attempt extraction for each. */
// Extraction is one PDF download + one AI call per report (~10–40s each), so
// a backfill (e.g. OCBC's three series back to July = ~13 reports) can't all
// be summarized inside one 60s run. Each run stops starting new extractions
// past this budget; the rest stay "Not yet summarized" and are picked up by
// the next run (or the admin's "Check for new reports" button) — same
// time-budget pattern as news.ts's ingestAll().
const EXTRACT_TIME_BUDGET_MS = 35000

export async function discoverReports(): Promise<{ inserted: number; extracted: number; pending: number }> {
    const startedAt = Date.now()
    const admin = createAdminClient()
    let inserted = 0

    const { data: existingRows } = await admin.from('bank_intelligence_reports').select('pdf_url, bank_key, series, report_period, title')
    const existingUrls = new Set((existingRows ?? []).map(r => r.pdf_url as string))
    // "<bank_key>:<series>" pairs that already have a stored report. A series
    // with none yet backfills from its start date (OCBC: July 2026, UOB House
    // View: 3Q 2026) instead of checking only the most recent period.
    const seriesWithHistory = new Set(
        (existingRows ?? []).filter(r => r.series).map(r => `${r.bank_key}:${r.series}`))
    // "<bank_key>:<series>:<YYYY-MM-01>" — for one-issue-per-month series (DBS weeklies).
    const coveredPeriods = new Set(
        (existingRows ?? []).filter(r => r.series).map(r => `${r.bank_key}:${r.series}:${r.report_period}`))
    // "<bank_key>:<series>" → stored titles — for title-matched extras (DBS "Fed").
    const titlesBySeries = new Map<string, string[]>()
    for (const r of existingRows ?? []) {
        if (!r.series) continue
        const k = `${r.bank_key}:${r.series}`
        titlesBySeries.set(k, [...(titlesBySeries.get(k) ?? []), r.title as string])
    }
    const ctx: DiscoveryContext = { seriesWithHistory, coveredPeriods, titlesBySeries }

    for (const source of BANK_SOURCES) {
        const reports = await fetchReports(source.key, ctx)
        for (const r of reports) {
            if (existingUrls.has(r.pdfUrl)) continue

            let archivePath: string | null = null
            if (r.archive) {
                const { error: uploadError } = await admin.storage
                    .from(ARCHIVE_BUCKET)
                    .upload(r.archive.path, r.archive.bytes, { contentType: 'application/pdf', upsert: true })
                if (uploadError) {
                    // Skip the row rather than store one without its copy — the
                    // next run retries while this edition is still the live one.
                    console.error('[bankIntelligence] archive upload failed:', uploadError.message)
                    continue
                }
                archivePath = r.archive.path
            }

            const { error } = await admin
                .from('bank_intelligence_reports')
                .insert({
                    bank: source.name,
                    bank_key: source.key,
                    title: r.title,
                    series: r.series ?? null,
                    report_period: r.reportPeriod,
                    published_date: r.publishedDate,
                    pdf_url: r.pdfUrl,
                    archive_path: archivePath,
                })
            if (error) {
                console.error('[bankIntelligence] insert failed:', error.message)
                continue
            }
            existingUrls.add(r.pdfUrl)
            inserted++
        }
    }

    // Summarize everything still waiting — this run's new rows plus any a
    // previous run ran out of time for. Rows whose extraction already failed
    // (extraction_error set) are left for the admin's per-row re-extract, so a
    // permanently broken PDF link isn't retried every day.
    const { data: waiting } = await admin
        .from('bank_intelligence_reports')
        .select('id')
        .is('summary', null)
        .is('extraction_error', null)
        .eq('hidden', false)
        .order('report_period', { ascending: false })
    const waitingIds = (waiting ?? []).map(r => r.id as string)

    let extracted = 0
    let attempted = 0
    for (const id of waitingIds) {
        if (Date.now() - startedAt >= EXTRACT_TIME_BUDGET_MS) break
        attempted++
        if (await extractSummary(id)) extracted++
    }
    const pending = waitingIds.length - attempted

    return { inserted, extracted, pending }
}

// ── Summary extraction: DeepSeek (paid plan, primary) + Gemini (fallback) ─────
//
// DeepSeek's hosted API (deepseek-v4-flash/-pro) is confirmed text-only — no
// PDF/image/document input at all (checked directly against their own API
// docs while building this: every message role's "content" is documented as
// plain string, no multimodal content-part shape exists). So the PDF is
// converted to plain text first (pdf-parse) and that text is what DeepSeek
// reads — unlike Gemini, which reads the PDF's actual visual/table layout.
//
// This has a real, confirmed accuracy trade-off, checked against the two
// bank sources this feature actually uses: OCBC's report is a dense data
// table (SORA/SOFR/GDP grids) and its extracted text preserved row order
// perfectly (verified: extracted "SORA 1.25 1.40 1.40 1.45 1.50" matched the
// PDF exactly). UOB's report is chart/graphic-heavy, and its extracted text
// interleaves chart axis-labels and legend text into meaningless number
// sequences near those charts — the surrounding narrative prose still comes
// out clean, but a model reading the raw text has to recognize and discard
// that noise itself. The prompt below tells it to. The Gemini fallback below
// only fires on a hard failure (no key / network / API error / empty
// response) — it cannot detect "DeepSeek silently misread a garbled table,"
// which no automated check can catch. The admin-review-before-publish gate
// (is_published) is the real backstop for that residual risk, same role it
// already plays for extractPackages.ts's rate-sheet ingestion.
const SUMMARY_SYSTEM = `You are summarizing a bank's monthly research report (a "house view") for mortgage/loan advisory agents in Singapore. You are given the report's text, extracted from its PDF or web page — PDF extraction sometimes interleaves chart axis-labels or legend text into meaningless number fragments near where a chart appeared in the original document. Recognize and silently ignore any such garbled fragments; do not try to interpret or summarize them. Only use text that reads as genuine sentences, headings, or a real data table (a table has a clear row label followed by a consistent number of aligned values, e.g. "SORA 1.25 1.40 1.40 1.45 1.50" under column headers like "3Q26 4Q26 1Q27 2Q27 3Q27").

Write a comprehensive but readable summary covering whatever sections the report actually contains — typically some mix of: macro/growth outlook, inflation outlook, interest rate forecast (especially SORA, SOFR, or other rate benchmarks — call out specific forecast figures and quarters when the report gives them), FX view, and any other market commentary (credit, equities, sustainability, etc.) present.

Use clear section headers (plain text, e.g. "Rates Outlook:", "Macro View:") and short paragraphs or bullet points under each. Do not invent figures — only report what the document states. If the report has a rates forecast table, transcribe the key figures (e.g. SORA by quarter) rather than just describing that a table exists. Aim for genuinely useful density — a mortgage agent should be able to read this instead of opening the PDF, not just get a vague gist.`

// Same OpenAI-compatible call shape as news.ts's callDeepSeek — duplicated
// per-file rather than shared, matching that file's own established convention.
const DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro']

async function callDeepSeekWithText(reportText: string): Promise<string | null> {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) return null

    const body = JSON.stringify({
        model: DEEPSEEK_MODELS[0],
        messages: [
            { role: 'system', content: SUMMARY_SYSTEM },
            { role: 'user', content: `Report text:\n${reportText.slice(0, 60000)}` },
        ],
        temperature: 0,
        max_tokens: 4096,
        thinking: { type: 'disabled' },
    })

    for (const model of DEEPSEEK_MODELS) {
        const modelBody = model === DEEPSEEK_MODELS[0] ? body : body.replace(`"model":"${DEEPSEEK_MODELS[0]}"`, `"model":"${model}"`)
        try {
            let res: Response | null = null
            for (let attempt = 0; attempt < 2; attempt++) {
                res = await fetch('https://api.deepseek.com/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                    body: modelBody,
                    signal: AbortSignal.timeout(45000),
                })
                if (res.ok || (res.status !== 503 && res.status !== 429)) break
                if (attempt === 0) await new Promise(r => setTimeout(r, 800))
            }
            if (!res || !res.ok) {
                console.error(`[bankIntelligence] ${model} HTTP ${res?.status}`)
                continue
            }
            const json = await res.json()
            const text = json?.choices?.[0]?.message?.content
            if (typeof text === 'string' && text.trim()) return text.trim()
        } catch (err) {
            console.error(`[bankIntelligence] ${model} threw: ${String(err)}`)
        }
    }
    return null
}

// gemini-3.0-flash (extractPackages.ts's primary) was checked live against
// Gemini's own ListModels endpoint while building this and confirmed NOT to
// exist. Not repeating that mistake here: gemini-2.5-flash is the
// confirmed-available choice (same as askGemini.ts's working chain).
interface ModelDef { id: string; genExtra?: Record<string, unknown> }
const GEMINI_MODELS: ModelDef[] = [
    { id: 'gemini-2.5-flash',      genExtra: { thinkingConfig: { thinkingBudget: 0 } } },
    { id: 'gemini-2.5-flash-lite', genExtra: { thinkingConfig: { thinkingBudget: 0 } } },
]

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }

async function callGemini(parts: GeminiPart[]): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return null

    const basePayload = {
        system_instruction: { parts: [{ text: SUMMARY_SYSTEM }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0, maxOutputTokens: 4096 },
    }

    // Auditable outbound log, matching deepseek.ts's — every part sent to
    // Gemini here is either a bank's own public PDF/article text or the
    // extracted text of it; never anything from lib/google/*. Binary PDF
    // bytes are summarized by size, not dumped, so the log stays readable.
    console.log(`[Gemini OUTBOUND bankIntelligence] parts=${JSON.stringify(parts.map(p =>
        'text' in p ? { text: p.text.slice(0, 300) } : { inlineData: `[pdf bytes, ${p.inlineData.data.length} base64 chars]` }
    ))}`)

    for (const { id: model, genExtra } of GEMINI_MODELS) {
        const body = JSON.stringify(genExtra
            ? { ...basePayload, generationConfig: { ...basePayload.generationConfig, ...genExtra } }
            : basePayload
        )
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
        try {
            let res: Response | null = null
            for (let attempt = 0; attempt < 2; attempt++) {
                res = await fetch(url, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
                    signal: AbortSignal.timeout(45000),   // PDFs take longer than a text prompt
                })
                // Retry only a transient 503. A 429 is Gemini's daily quota and
                // will not recover in 800ms — retrying the SAME model just
                // spends another unit of what ran out. This cron runs over
                // every bank daily, so the waste compounded: with pdf-parse
                // broken on Vercel every report fell through to here, and each
                // burned four calls to fail four times, draining the shared key
                // before LO extraction could touch it. Falling through to the
                // NEXT model is still worth doing — free-tier quota is metered
                // per model, so flash-lite can answer when flash cannot.
                if (res.ok || res.status !== 503) break
                if (attempt === 0) await new Promise(r => setTimeout(r, 800))
            }
            if (!res || !res.ok) {
                console.error(`[bankIntelligence] ${model} HTTP ${res?.status}`)
                // Free-tier quota is metered per MODEL, so a 429 on one does
                // not block the next — keep going down the chain. Only the
                // same-model retry above is skipped.
                continue
            }
            const json = await res.json()
            const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
            if (typeof text === 'string' && text.trim()) return text.trim()
        } catch (err) {
            console.error(`[bankIntelligence] ${model} threw: ${String(err)}`)
        }
    }
    return null
}

function callGeminiWithPdf(pdfBase64: string): Promise<string | null> {
    return callGemini([
        { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
        { text: 'Summarize this report per the instructions.' },
    ])
}

function callGeminiWithText(reportText: string): Promise<string | null> {
    return callGemini([{ text: `Report text:\n${reportText.slice(0, 60000)}` }])
}

/** Extracts a summary (DeepSeek from the report's text primarily, Gemini as
 *  fallback), stores the result. PDF sources go through pdf-parse; HSBC's
 *  plain article page is already clean HTML, no PDF step needed. */
export async function extractSummary(reportId: string): Promise<boolean> {
    const admin = createAdminClient()
    const { data: report } = await admin.from('bank_intelligence_reports').select('pdf_url, bank_key, archive_path').eq('id', reportId).maybeSingle()
    if (!report) return false

    try {
        let summary: string | null = null

        // HSBC Monthly View rows point at a web page (now a video page): read
        // its linked summary PDF, falling back to the page text only if none.
        // Every other row — incl. HSBC Macro Monthly — points at the PDF itself.
        let buf: ArrayBuffer | null = null
        let pageText: string | null = null
        if (report.archive_path) {
            // Our own copy — the source URL may already hold a newer edition.
            const { data: blob, error: dlError } = await admin.storage.from(ARCHIVE_BUCKET).download(report.archive_path)
            if (dlError || !blob) throw new Error(`Archive download failed: ${dlError?.message ?? 'empty'}`)
            buf = await blob.arrayBuffer()
        } else if (report.bank_key === 'hsbc' && !isPdfUrl(report.pdf_url)) {
            const res = await fetch(report.pdf_url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(30000) })
            if (!res.ok) throw new Error(`Article fetch HTTP ${res.status}`)
            const html = await res.text()
            const linkedPdf = hsbcMonthlyViewPdfUrl(html)
            if (linkedPdf) {
                const pdfRes = await fetch(linkedPdf, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(30000) })
                if (pdfRes.ok) buf = await pdfRes.arrayBuffer()
            }
            if (!buf) pageText = extractHsbcArticleText(html)
        } else {
            const pdfRes = await fetch(report.pdf_url, {
                headers: BROWSER_HEADERS,
                signal: AbortSignal.timeout(30000),
            })
            if (!pdfRes.ok) throw new Error(`PDF fetch HTTP ${pdfRes.status}`)
            buf = await pdfRes.arrayBuffer()
        }

        if (!buf) {
            if (pageText) {
                summary = await callDeepSeekWithText(pageText)
                if (!summary) summary = await callGeminiWithText(pageText)
            }
        } else {
            try {
                const { PDFParse } = await import('pdf-parse')
                const parser = new PDFParse({ data: Buffer.from(buf) })
                const { text } = await parser.getText()
                await parser.destroy()
                if (text.trim()) summary = await callDeepSeekWithText(text)
            } catch (err) {
                console.error('[bankIntelligence] pdf-parse/DeepSeek path threw:', String(err))
            }

            if (!summary) {
                const base64 = Buffer.from(buf).toString('base64')
                summary = await callGeminiWithPdf(base64)
            }
        }

        if (!summary) {
            await admin.from('bank_intelligence_reports')
                .update({ extraction_error: 'Both DeepSeek and Gemini extraction failed or returned empty', updated_at: new Date().toISOString() })
                .eq('id', reportId)
            return false
        }

        await admin.from('bank_intelligence_reports')
            .update({ summary, summary_generated_at: new Date().toISOString(), extraction_error: null, updated_at: new Date().toISOString() })
            .eq('id', reportId)
        return true
    } catch (e) {
        console.error('[bankIntelligence] extractSummary threw:', String(e))
        await admin.from('bank_intelligence_reports')
            .update({ extraction_error: String(e).slice(0, 500), updated_at: new Date().toISOString() })
            .eq('id', reportId)
        return false
    }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** Agent-facing feed: published, non-hidden reports, most recent period first. */
export async function getPublishedReports(): Promise<BankIntelligenceReport[]> {
    const admin = createAdminClient()
    const { data } = await admin
        .from('bank_intelligence_reports')
        .select('*')
        .eq('is_published', true)
        .eq('hidden', false)
        .order('report_period', { ascending: false })
        .limit(100)
    return (data ?? []) as BankIntelligenceReport[]
}

/** Admin view: everything, including unpublished/hidden. */
export async function getAllReports(): Promise<BankIntelligenceReport[]> {
    const admin = createAdminClient()
    const { data } = await admin
        .from('bank_intelligence_reports')
        .select('*')
        .order('report_period', { ascending: false })
        .limit(300)
    return (data ?? []) as BankIntelligenceReport[]
}

// ── Admin QA / review (extraction is automatic; publishing is not) ────────────

export async function setPublished(id: string, isPublished: boolean): Promise<boolean> {
    const admin = createAdminClient()
    const { error } = await admin
        .from('bank_intelligence_reports')
        .update({ is_published: isPublished, updated_at: new Date().toISOString() })
        .eq('id', id)
    return !error
}

export async function setHidden(id: string, hidden: boolean): Promise<boolean> {
    const admin = createAdminClient()
    const { error } = await admin
        .from('bank_intelligence_reports')
        .update({ hidden, updated_at: new Date().toISOString() })
        .eq('id', id)
    return !error
}

export async function updateSummary(id: string, summary: string): Promise<boolean> {
    const admin = createAdminClient()
    const { error } = await admin
        .from('bank_intelligence_reports')
        .update({ summary, updated_at: new Date().toISOString() })
        .eq('id', id)
    return !error
}

export async function deleteReport(id: string): Promise<boolean> {
    const admin = createAdminClient()
    const { error } = await admin.from('bank_intelligence_reports').delete().eq('id', id)
    return !error
}

export async function createManualReport(input: BankIntelligenceReportInput): Promise<BankIntelligenceReport | null> {
    const admin = createAdminClient()
    const { data, error } = await admin
        .from('bank_intelligence_reports')
        .insert({
            bank: input.bank,
            bank_key: input.bank_key,
            title: input.title,
            report_period: input.report_period,
            published_date: input.published_date ?? null,
            pdf_url: input.pdf_url,
            is_manual: true,
        })
        .select()
        .single()
    if (error) {
        console.error('[bankIntelligence] createManualReport failed:', error.message)
        return null
    }
    return data as BankIntelligenceReport
}
