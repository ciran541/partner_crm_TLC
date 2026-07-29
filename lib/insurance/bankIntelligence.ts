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
import { BANK_SOURCES } from '@/lib/types/bankIntelligence'
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
}

const MONTHS: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

function firstOfMonth(monthAbbrevOrFull: string, year: string): string {
    const key = monthAbbrevOrFull.slice(0, 3).toLowerCase()
    const mm = MONTHS[key] ?? '01'
    return `${year}-${mm}-01`
}

// OCBC's research listing embeds every report (Daily Treasury Outlook, Weekly
// Macro View, Regional Focus, and the monthly "Research Monitor") in the same
// flat HTML structure — confirmed live via a direct fetch, no WAF. Filtered to
// the "Monthly Monitor" category only; the other cadences aren't what this
// feature is for.
async function fetchOcbcReports(): Promise<RawReport[]> {
    try {
        const res = await fetch('https://www.ocbc.com/group/research/research-with-filter.page?category=macro', {
            headers: BROWSER_HEADERS,
            signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const html = await res.text()

        const re = /<p>([^<]*)<\/p>\s*<h3[^>]*media-filter-media-listing__article-title[^>]*><strong>([^<]*)<\/strong><\/h3><small>([^<]*)<\/small>[\s\S]*?<a href="([^"]*\.pdf)"[^>]*class="link media-filter-media-listing__read-more"/g
        const out: RawReport[] = []
        let m: RegExpExecArray | null
        while ((m = re.exec(html)) !== null) {
            const [, category, title, dateText] = m
            const pdfPath = m[4]
            if (!category.includes('Monthly Monitor')) continue
            // dateText is "01 Jul 2026" — DD Mon YYYY
            const dm = dateText.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)
            const publishedDate = dm ? `${dm[3]}-${MONTHS[dm[2].slice(0, 3).toLowerCase()] ?? '01'}-${dm[1].padStart(2, '0')}` : null
            const reportPeriod = dm ? firstOfMonth(dm[2], dm[3]) : (publishedDate ?? new Date().toISOString().slice(0, 10))
            out.push({
                title: title.trim(),
                pdfUrl: `https://www.ocbc.com${pdfPath}`,
                reportPeriod,
                publishedDate,
            })
        }
        return out
    } catch (e) {
        console.error('[bankIntelligence] fetchOcbcReports threw:', String(e))
        return []
    }
}

// UOB's wealth-insights page lists "Monthly Investment Insights" PDFs with the
// month/year available directly in a button_name attribute — no date parsing
// from the filename needed. English-only URLs (no "-cn-"/"-zh-" infix) are
// matched naturally by the filename pattern. The page repeats the same items
// in more than one listing block, so results are deduped by URL.
async function fetchUobReports(): Promise<RawReport[]> {
    try {
        const res = await fetch('https://www.uob.com.sg/personal/invest/wealth-insights/index.page', {
            headers: BROWSER_HEADERS,
            signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const html = await res.text()

        const re = /href="(\/assets\/web-resources\/personal\/pdf\/invest\/wealth-insights\/monthly-investment-insights-(\d{6})\.pdf)"[^>]*button_name="([a-z]+ \d{4}):read more"/gi
        const seen = new Set<string>()
        const out: RawReport[] = []
        let m: RegExpExecArray | null
        while ((m = re.exec(html)) !== null) {
            const [, path, yyyymm, monthYearText] = m
            if (seen.has(path)) continue
            seen.add(path)
            const [monthName, year] = monthYearText.split(' ')
            out.push({
                title: `Monthly Investment Insights (${monthName[0].toUpperCase()}${monthName.slice(1)} ${year})`,
                pdfUrl: `https://www.uob.com.sg${path}`,
                reportPeriod: firstOfMonth(monthName, year),
                publishedDate: `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}-01`,
            })
        }
        return out
    } catch (e) {
        console.error('[bankIntelligence] fetchUobReports threw:', String(e))
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

const MONTHS_FULL = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
]

// HSBC's "House Views" listing is entirely client-side rendered — confirmed
// live: zero PDF links, zero "pdf" mentions anywhere, no embedded article
// data in the raw HTML (same class of problem MAS's /news page had before
// its real search API was found). But HSBC publishes no PDF at all — each
// report is a normal article page at a PREDICTABLE URL
// (monthly-view-<month>-<year>/, confirmed working for 3 consecutive months
// live) and that article page IS server-rendered. So discovery skips the
// listing entirely and just constructs the expected URL for the current and
// previous month, keeping whichever ones actually resolve — simpler and less
// fragile than scraping a listing, and sidesteps needing HSBC's backing API.
async function fetchHsbcReports(): Promise<RawReport[]> {
    const out: RawReport[] = []
    const now = new Date()
    for (const monthsAgo of [0, 1]) {
        const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1)
        const monthName = MONTHS_FULL[d.getMonth()]
        const year = d.getFullYear()
        const url = `https://www.privatebanking.hsbc.com/wih/investments-Insights/House-views/monthly-view-${monthName}-${year}/`
        try {
            const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) })
            if (!res.ok) continue
            const html = await res.text()
            const titleMatch = html.match(/<h1 class="[^"]*article-title[^"]*">([^<]*)<\/h1>/)
            if (!titleMatch) continue
            const dateMatch = html.match(/<span class="A-TYP16R-RW-ALL">([A-Za-z]+ \d{1,2}, \d{4})<\/span>/)
            out.push({
                title: titleMatch[1].trim(),
                pdfUrl: url,
                reportPeriod: `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-01`,
                publishedDate: dateMatch ? parseHsbcDate(dateMatch[1]) : null,
            })
        } catch (e) {
            console.error('[bankIntelligence] fetchHsbcReports threw:', String(e))
        }
    }
    return out
}

// "Jun 26, 2026" -> "2026-06-26"
function parseHsbcDate(text: string): string | null {
    const m = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/)
    if (!m) return null
    const mm = MONTHS[m[1].slice(0, 3).toLowerCase()] ?? '01'
    return `${m[3]}-${mm}-${m[2].padStart(2, '0')}`
}

// HSBC has no PDF at all — the article page is already clean server-rendered
// HTML, so this just strips the content container down to plain text (no
// pdf-parse step needed for this source).
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

async function fetchReports(sourceKey: (typeof BANK_SOURCES)[number]['key']): Promise<RawReport[]> {
    if (sourceKey === 'ocbc') return fetchOcbcReports()
    if (sourceKey === 'uob') return fetchUobReports()
    if (sourceKey === 'hsbc') return fetchHsbcReports()
    if (sourceKey === 'maybank') return fetchMaybankReports()
    if (sourceKey === 'sc') return fetchScReports()
    if (sourceKey === 'dbs') return fetchDbsReports()
    return []
}

// ── Discovery ────────────────────────────────────────────────────────────────

/** Cron entrypoint: discover new reports, then attempt extraction for each. */
export async function discoverReports(): Promise<{ inserted: number; extracted: number }> {
    const admin = createAdminClient()
    let inserted = 0

    const { data: existingRows } = await admin.from('bank_intelligence_reports').select('pdf_url')
    const existingUrls = new Set((existingRows ?? []).map(r => r.pdf_url as string))

    const newIds: string[] = []
    for (const source of BANK_SOURCES) {
        const reports = await fetchReports(source.key)
        for (const r of reports) {
            if (existingUrls.has(r.pdfUrl)) continue
            const { data, error } = await admin
                .from('bank_intelligence_reports')
                .insert({
                    bank: source.name,
                    bank_key: source.key,
                    title: r.title,
                    report_period: r.reportPeriod,
                    published_date: r.publishedDate,
                    pdf_url: r.pdfUrl,
                })
                .select('id')
                .single()
            if (error) {
                console.error('[bankIntelligence] insert failed:', error.message)
                continue
            }
            existingUrls.add(r.pdfUrl)
            inserted++
            if (data?.id) newIds.push(data.id)
        }
    }

    let extracted = 0
    for (const id of newIds) {
        const ok = await extractSummary(id)
        if (ok) extracted++
    }

    return { inserted, extracted }
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
    const { data: report } = await admin.from('bank_intelligence_reports').select('pdf_url, bank_key').eq('id', reportId).maybeSingle()
    if (!report) return false

    try {
        let summary: string | null = null

        if (report.bank_key === 'hsbc') {
            const res = await fetch(report.pdf_url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(30000) })
            if (!res.ok) throw new Error(`Article fetch HTTP ${res.status}`)
            const html = await res.text()
            const text = extractHsbcArticleText(html)
            if (text) {
                summary = await callDeepSeekWithText(text)
                if (!summary) summary = await callGeminiWithText(text)
            }
        } else {
            const pdfRes = await fetch(report.pdf_url, {
                headers: BROWSER_HEADERS,
                signal: AbortSignal.timeout(30000),
            })
            if (!pdfRes.ok) throw new Error(`PDF fetch HTTP ${pdfRes.status}`)
            const buf = await pdfRes.arrayBuffer()

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
