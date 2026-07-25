# 09 – Banks' Insights

Auto-discovered bank "house view" research (monthly/quarterly/semi-annual flagship reports from six banks), comprehensively summarized by AI, reviewed by an admin, then published to agents grouped by month. A top-level tab (`/insurance/dashboard/bank-intelligence`), deliberately separate from Resources — banks' own research is a different kind of content from news/rates data.

Table: `bank_intelligence_reports`. Logic: `lib/insurance/bankIntelligence.ts`. Source config: `BANK_SOURCES` in `lib/types/bankIntelligence.ts`. Admin console: `/admin/insurance/bank-intelligence` (`BankIntelligenceAdminView.tsx`).

## Sources at a glance

| Bank | Report | Cadence | Discovery mechanism |
|------|--------|---------|---------------------|
| OCBC | Research Monitor | Monthly | Listing page HTML, regex, filtered to "Monthly Monitor" category |
| UOB | Monthly Investment Insights | Monthly | Listing page; month/year in a `button_name` attribute. Server intermittently 500s on minimal headers → all fetches send a full realistic header set |
| HSBC | Monthly View | Monthly | **No PDF, no scrapable listing** — the article URL is predictable (`…/monthly-view-<month>-<year>/`), so the fetcher just constructs current + previous month's URLs and keeps whichever resolve |
| Maybank | CIO Monthly Outlook | Monthly | Listing carries entire archive; month/year encoded in thumbnail filenames; listing's own "Discover" links are broken (500) so the confirmed-working parallel PDF path is used instead |
| Standard Chartered | Global Market Outlook | Semi-annual | Listing shows only 3 featured cards; PDF filename embeds a per-publication slug, so no URL prediction and no backfill possible — discovery finds only what's currently listed |
| DBS | CIO Insights | Quarterly | Two fetches deep: listing → article page → embedded JSON carries the real PDF path, served through a `download-pdf` wrapper API. Sibling companion PDFs (`_Thematics` etc.) filtered out |

Gotchas preserved from live testing (full war stories in [CLAUDE.md](../CLAUDE.md)):

- **Maybank's domain tarpits `curl` but serves Node's `fetch()` fine** (TLS fingerprinting). General lesson: a failing `curl` no longer proves a source is blocked — retest with Node `fetch()` before giving up.
- **DBS's embedded `"access": false` flag looked like a login wall but wasn't** — a clean, cookie-less request to the real wrapper endpoint returns the full PDF. Verified via browser DevTools Network tab, the same technique that found MAS's search API.

## Extraction & summarization

`extractSummary()` per report:

- **PDF sources** → `pdf-parse` extracts text → `callDeepSeekWithText()`. **HSBC** → article HTML stripped directly (`extractHsbcArticleText()`), no PDF step. The UI's "Original PDF"/"Original Article" label switches automatically via `isPdfUrl()` — the `pdf_url` column just means "link to the source."
- **Provider chain: DeepSeek (paid) primary; Gemini fallback only on hard failure** (no key, network error, empty response — never on suspected quality). Gemini fallback reads the PDF's actual visual layout (`callGeminiWithPdf()`); its model chain starts at a confirmed-existing model.
- **Known accuracy trade-off:** text extraction preserves dense tables well (verified against OCBC's rate table) but garbles chart-heavy layouts (UOB's axis labels become number fragments). `SUMMARY_SYSTEM` explicitly instructs the model to discard garbled fragments rather than interpret them — verified live. No automated check can catch "the model silently misread a garbled table," which is precisely why publishing is human-gated (below).
- Summaries are **comprehensive by design** (macro, rates, FX, whatever the report covers) — a product decision, not narrowed to SORA — but rate figures are called out when present, and the model must say plainly when a report contains no rate table rather than inventing one.

> **`pdf-parse` requires `serverExternalPackages` in `next.config.ts`.** Without it, bundling breaks its worker resolution ("Setting up fake worker failed") and every extraction silently falls back to Gemini — this happened. The dynamic `import('pdf-parse')` is also deliberate: it loads only in the code path that needs it.

## The publish gate

Discovery + extraction are fully automatic (daily cron `/api/cron/bank-intelligence`, 07:00 UTC, or "Check for new reports" in the console) — but `is_published` defaults **false**. An admin reviews in `ReportReviewModal.tsx` (edit the summary in place, or re-run with `PATCH { reExtract: true }`) and flips it. Same AI-drafts/human-signs pattern as rate ingestion.

First-run note: a new source with a long-lived listing backfills its whole visible archive at once (Maybank did 28 months). Expected one-time behaviour, not a bug.

## Agent-facing rendering

Stored summaries are real markdown (headers, bold, GFM tables). The agent card shows a plain-text teaser (`stripMarkdownPreview()`), with a bank filter matching the news tab's chip pattern; "Read full summary" opens `SummaryViewModal.tsx`, rendering via `react-markdown` + `remark-gfm` under Tailwind typography `prose` classes — verified to produce real `<table>`/`<h3>` HTML, not leaked `###`. The admin review textarea intentionally stays raw markdown, since that's what's being edited.
