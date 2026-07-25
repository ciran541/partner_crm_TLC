# 06 – Rates & SORA

Bank mortgage packages as structured, computable data: browsing/filtering for agents, AI-assisted ingestion for admins, a daily SORA feed, and the Step 4 auto-recommendation that ranks packages for a specific client.

## Why structured rates matter (the product decision)

Rates used to live in an external iframe (`mortgage-package.vercel.app`) — human-readable, machine-useless. The `mortgage_packages` table stores each package's pricing as **structured data**: `rate_schedule` JSONB, an ordered array of per-year entries:

```json
[
  { "year": 1, "type": "fixed", "rate": 2.6 },
  { "year": 2, "type": "fixed", "rate": 2.6 },
  { "thereafter": true, "type": "floating", "reference": "3M SORA", "spread": 0.5 }
]
```

Because the schedule is data rather than free text, packages are filterable/sortable **and computable** — the workflow engine can project real monthly installments from them. `first_year_rate` is a rough sort key derived on save; `min_loan_note` holds Premier/threshold wording. Types: `lib/types/rates.ts`; helpers: `lib/insurance/rateSchedule.ts` (`parseLegacyRates`, `formatRateSchedule`, `deriveFirstYearRate`).

## The Rates page

`app/insurance/dashboard/rates/page.tsx` — shared by both apps (the property `/dashboard/rates` route redirects here).

- **Agents:** browse + filter published packages.
- **Admins:** additionally create / edit / duplicate / delete, and see drafts. Editor: `components/insurance/rates/RatePackageEditorModal.tsx` (year-by-year builder: fixed % or floating reference + spread).
- **APIs:** `GET /api/insurance/rates` (insurance **or** property auth; agents see published only; also returns current SORA so Step 4 gets both in one call) · `POST/PATCH/DELETE /api/admin/rates` (admin-guarded; `POST {duplicateId}` clones as draft).

## Ingestion — "Import from sheet"

Admins paste a bank's block from a Google Sheet; the system does the tedious part, a human confirms the result:

```
paste → Gemini extracts structured packages → human review screen → confirm → atomic replace
        (extractPackages.ts, JSON mode,        (RateIngestionModal.tsx:      (replace_bank_packages()
         temp 0, transcribe-only)               editable rows + per-          SQL function, scoped to
                                                category diff)                bank + reviewed categories)
```

Two safety properties worth knowing:

- **The admin picks the bank** — the LLM never decides what gets deleted. Replace scope = only the categories present in the reviewed rows.
- **Replace is atomic** (one SQL function, `POST /api/admin/rates/extract` then `/replace`) — no window where a bank has half-old, half-new packages.

> Gotcha (already fixed once, don't reintroduce): `extractPackages.ts`'s primary model name was found to be nonexistent and silently 404-falling-back on every call. Model names for the knowledge engine live only in `askGemini.ts`'s `modelChain()` — keep model names centralized.

## Daily SORA

Floating packages price off SORA, so the app keeps the latest value locally (`sora_rates` table):

- **Source:** MAS "Domestic Interest Rates – Daily" API (`lib/insurance/sora.ts`; auth = `keyid` header with `MAS_API_KEY`). The gateway ignores filters and returns full history — so fetch all, take the latest non-null compounded row (the feed is unsorted: pick max date, never "last row").
- **Refresh:** daily Vercel cron `/api/cron/sora` at 02:00 UTC (MAS publishes ~09:30 SGT); admins can also "Refresh SORA" from the Rates page (`POST /api/admin/rates/sora`).
- **Reads are instant** via `getCurrentSora()` — features never call MAS at request time.
- **Staleness is surfaced, not hidden:** `isSoraStale()` (> 5 days old) drives an amber warning on the Rates page and in Step 4.

## Step 4 auto-recommendation (decision support)

Where structure pays off: in workflow Step 4, the engine ranks live packages for the specific client. Logic in `lib/insurance/rateRecommend.ts`:

- `effectiveRate(entry, sora)` — fixed → its rate; floating → SORA + spread; `1M/3M` dual-benchmark → the **lower** of the two; FD-pegged → not computed (no feed for FD rates).
- `projectPackage()` — re-amortises per-year monthly installments across the schedule.
- `recommendPackages()` — filters by loan size / tenure / property / preference, computes net savings (`computeRefiSavings` in `loanCalc.ts`) and TDSR eligibility, ranks best-first.

UI: `RefiPackages.tsx` / `PurchasePackages.tsx` show the ranked list. Packages that can't be auto-priced (dual-benchmark FD types) degrade gracefully — shown, not silently dropped.

**The snapshot rule:** when an agent selects a package, a frozen **`selected_package_snapshot`** is stored in `workflow_data`. The proposal shows the snapshot, not the live row — an admin editing the package later can't silently change a client's already-presented numbers. (Same integrity instinct as the human review gate above.)

## Related resources

Domestic rates charts (`domestic_rates`, `lib/insurance/domesticRates.ts`) and the US Fed funds chart (`fedRate.ts`, FRED API) live under `/insurance/dashboard/resources/domestic` — display-only market context, separate from the computable packages above.
