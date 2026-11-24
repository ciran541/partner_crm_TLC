/**
 * Banks' Insights — top-level tab (not under Resources). Bank "house view"
 * research — a PDF for OCBC (Research Monitor), UOB (Monthly Investment
 * Insights), Maybank (CIO Monthly Outlook), SC (Global Market Outlook), and
 * DBS (CIO Insights, quarterly), a plain article for HSBC (Monthly View) —
 * auto-discovered and comprehensively summarized via Claude.
 */

// Only banks with a confirmed, real way to find their latest report —
// verified by fetching each page directly. OCBC/UOB/Maybank/SC/DBS publish a
// dated PDF listing in plain server-rendered HTML; HSBC publishes a plain
// article (no PDF) at a predictable URL instead of a scrapable listing (see
// fetchHsbcReports in lib/insurance/bankIntelligence.ts). Maybank's own
// "Discover" links on the listing point to a broken intermediate page
// (confirmed live: 500), so its PDF is reached via a predictable filename
// pattern instead, same trick as HSBC's URL (see fetchMaybankReports). SC's
// listing only ever shows the current-latest report per category (no
// archive), and its PDF filename embeds a unique per-publication subtitle
// slug that isn't predictable — so unlike Maybank/HSBC, discovery can only
// find the current one, not backfill history (see fetchScReports). DBS's PDF
// isn't a static file at all — the listing links to a further article page
// whose own embedded data holds the real PDF path, and the PDF itself is
// served through a wrapper API endpoint, not a direct URL (see
// fetchDbsReports); confirmed genuinely public via a clean unauthenticated
// request, despite the article page's own data marking that link
// "access":false (that flag turned out to govern something else).
import { safeHttpUrl } from '@/lib/types/news'

// OCBC is the first bank watched on more than one page — see OCBC_WATCH_RULES
// in lib/insurance/bankIntelligence.ts; listingUrl here is just its main page.
export const BANK_SOURCES = [
    { key: 'ocbc',    name: 'OCBC',    listingUrl: 'https://www.ocbc.com/group/research/research-with-filter.page?category=macro' },
    { key: 'uob',     name: 'UOB',     listingUrl: 'https://www.uobgroup.com/research/quarterly-global-outlook.page' },
    { key: 'hsbc',    name: 'HSBC',    listingUrl: 'https://www.privatebanking.hsbc.com/wih/investments-Insights/House-views/' },
    { key: 'maybank', name: 'Maybank', listingUrl: 'https://www.maybank2u.com.sg/en/personal/investment/maybank-research/insights/market-outlook/monthly/index.page' },
    { key: 'sc',      name: 'SC',      listingUrl: 'https://www.sc.com/en/wealth-retail-banking/wealth-solutions/wealth-insights/' },
    { key: 'dbs',     name: 'DBS',     listingUrl: 'https://www.dbs.com.sg/private-banking/aics/investment-strategy/cio-asset-allocation.page' },
] as const

export type BankSourceKey = (typeof BANK_SOURCES)[number]['key']

export interface BankIntelligenceReport {
    id: string
    bank: string
    bank_key: string
    title: string
    series: string | null   // which watch rule found it, e.g. 'SORA' (null for single-series banks)
    report_period: string   // first-of-month date, e.g. '2026-07-01'
    published_date: string | null
    pdf_url: string
    archive_path: string | null   // our private copy, when the source is overwritten in place (UOB FX)
    summary: string | null
    summary_generated_at: string | null
    extraction_error: string | null
    is_published: boolean
    hidden: boolean
    is_manual: boolean
    created_at?: string
    updated_at?: string
}

// Input for an admin QA one-off addition — not the automated discovery path.
export interface BankIntelligenceReportInput {
    bank: string
    bank_key: string
    title: string
    report_period: string
    published_date?: string | null
    pdf_url: string
}

/**
 * Plain-text excerpt of a markdown summary, for a card preview — strips
 * headers/bold/bullets/table-pipe syntax so the preview reads as prose
 * instead of literal "### Macro View: **Global Growth:**". The full summary
 * is still rendered as real markdown elsewhere (SummaryViewModal); this is
 * only for the short teaser text on the list.
 */
export function stripMarkdownPreview(markdown: string, maxLength = 220): string {
    const plain = markdown
        .replace(/\|/g, ' ')                    // table pipes
        .replace(/^#{1,6}\s*/gm, '')             // headers
        .replace(/\*\*(.*?)\*\*/g, '$1')         // bold
        .replace(/\*(.*?)\*/g, '$1')             // italic
        .replace(/^[-*+]\s+/gm, '')              // bullet markers
        .replace(/^\d+\.\s+/gm, '')              // numbered list markers
        .replace(/^-{3,}$/gm, '')                // horizontal rules
        .replace(/\s+/g, ' ')                    // collapse whitespace
        .trim()
    return plain.length > maxLength ? `${plain.slice(0, maxLength)}…` : plain
}

/** Whether a report's source link is an actual PDF (OCBC/UOB) or a plain
 *  article page (HSBC) — used to label the link "Original PDF" vs "Original
 *  Article" without needing a separate DB column for it. */
export function isPdfUrl(url: string): boolean {
    // Path only — UOB FX rows carry an edition marker (FX_Int_Rate.pdf#2026-11-06).
    try {
        return new URL(url, 'https://placeholder.invalid').pathname.toLowerCase().endsWith('.pdf')
    } catch {
        return false
    }
}

/** Where the "Original PDF/Article" link should go: our archived copy when we
 *  keep one (served to logged-in users only), otherwise the bank's own URL. */
export function reportLinkHref(report: Pick<BankIntelligenceReport, 'id' | 'pdf_url' | 'archive_path'>): string | null {
    if (report.archive_path) return `/api/insurance/bank-intelligence/archive?id=${encodeURIComponent(report.id)}`
    return safeHttpUrl(report.pdf_url)
}
