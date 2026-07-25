# 08 – News & Economic Calendar

Two auto-curated feeds under the insurance Resources area: mortgage-relevant news from seven sources, and an economic calendar of FOMC / US CPI / MAS policy dates. Both follow the same philosophy: **automate the pipeline, give admins a one-click override, never let automation overwrite an admin's decision.**

## Mortgage News

Agent feed: `/insurance/dashboard/resources/news`. Table: `mortgage_news_articles`. Logic: `lib/insurance/news.ts`. Admin console: `/admin/insurance/news` (`NewsAdminView.tsx`).

### Sources (each verified live, not assumed)

`NEWS_SOURCES` in `lib/types/news.ts`: **Business Times, CNA, Financial Times, The Edge Singapore** (genuine RSS feeds) and **MAS, URA, HDB** (no RSS — each scraped via a mechanism found by inspecting the real site):

- **MAS** — its `/news` page is client-rendered; the data comes from a public Sitecore/Solr search API discovered via the browser's Network tab. Needs a bare `User-Agent` (header-less fetches get 403'd by the WAF).
- **URA** — press-release list is embedded in the page's server-rendered HTML as framework state; parsed by regex.
- **HDB** — same embedded-state trick, different (Sitecore Layout Service) shape; same User-Agent requirement as MAS. High-value source: CPF interest rate and Resale Price Index announcements.

Sources deliberately rejected (broken feeds, bot-walls, PDF-only archives, low relevance density — e.g. Straits Times' feed serves garbage template text; SRX/99.co TLS-fingerprint-block bots; IRAS is clean but ~1 relevant item per 20): the full source-by-source audit lives in [CLAUDE.md](../CLAUDE.md) — read it before proposing a new source, someone has probably already tested it.

### Pipeline

Daily cron `/api/cron/news` (05:00 UTC) → `ingestAll()`:

```
fetch all sources → keep last 7 days → dedupe by URL
  → BT only: pre-filter by its genuine category tags (free, no API cost)
  → DeepSeek classifies relevance (JSON mode; on failure → NOT relevant, never assumes)
  → store
```

Also respects a wall-clock time budget separate from the item cap (a rate-limited key would otherwise burn the full retry cascade per item).

- **AI provider is DeepSeek, not Gemini** — deliberate: Gemini's free tier caps at ~20 requests/day/model (confirmed against a real key), far too low for classification volume. `callDeepSeek()` uses the OpenAI-compatible API (`deepseek-v4-flash` primary, `-pro` fallback).
- **Summaries are on-demand and cached**: `getOrCreateSummary()` (`POST /api/insurance/resources/news/[id]/summarize`) generates from the stored title+snippet only — **never scrapes the article page** (paywall/ToS posture, see below) — and caches into the `summary` column.
- **Admin controls**: hide/unhide, delete, manual add, "Refresh now," and a one-click **relevance override** (✓/✗ → `setRelevant()`) for wrong AI calls. The pipeline needs zero manual data entry day-to-day.

### Legal posture (title + snippet + link only)

Checked directly rather than assumed: SPH's and the statutory boards' written terms do *not* clearly pre-authorize commercial reuse — public institution ≠ public domain in Singapore. Deliberate mitigation: store only title + short snippet, always link to the original, never reproduce article text or bypass paywalls — standard low-risk aggregator practice, and the reason the summarizer never fetches article pages.

## Economic Calendar

Agent view: `/insurance/dashboard/resources/calendar` (impact stars, countdown badges). Table: `economic_calendar_events`. Logic: `lib/insurance/economicCalendar.ts`. Admin console: `/admin/insurance/calendar` (`CalendarAdminView.tsx`).

Three event types, three sourcing paths into one table:

| Type | Dates from | Values from |
|------|-----------|-------------|
| `fomc_meeting` | Scraped from the Fed's own calendar page (one of the few `.gov` pages that allows automated fetches) | — |
| `us_cpi` | **Manual, ~annual**: BLS blocks all automated fetches (confirmed 403 even with browser UA), so an admin downloads BLS's `.ics` file and pastes it into the console (`IcsImportModal` → `parseIcsCpiDates()`); BLS publishes ~18 months ahead | FRED, automatic: `CPIAUCSL` (`units=pc1`) for YoY actual/previous; `EXPINF1YR` as an honestly-labeled forecast proxy (not a paid "consensus" figure) |
| `mas_mps` | **Manual, quarterly** (Jan/Apr/Jul/Oct): no API or schedule feed exists — admin enters the "NLT" date from MAS's Advance Release Calendar page | — |

Daily cron `/api/cron/economic-calendar` (06:00 UTC) → `refreshAll()`: refreshes FOMC dates and CPI values only — **never** CPI release dates (ICS-import-owned) and **never** admin-owned columns (`impact_stars`, `hidden`, `admin_notes` are excluded from the upsert payload).

> **The shared pattern worth internalizing** (same in `sora.ts` and `news.ts`): automated upserts must exclude admin-owned columns, so a nightly cron can never silently revert a human's decision. If you add an admin-editable column to any auto-refreshed table, add it to the exclusion list in the same commit.
