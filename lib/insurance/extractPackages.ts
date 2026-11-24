/**
 * Rate ingestion extractor — turns a pasted Google-Sheet block into structured
 * packages via Claude (JSON mode, temperature 0).
 *
 * Moved off Claude: its free tier meters ~20 requests per day PER MODEL across
 * every feature sharing the key, and Letter-of-Offer extraction now needs that
 * budget for scanned documents, which only a vision model can read. This task
 * is pasted text in, JSON out, so it belongs on the paid, uncapped provider.
 *
 * One thing that lost: Claude's responseSchema enforced the output shape. Claude's
 * json mode guarantees only that the response PARSES, so the shape is described
 * explicitly at the end of the prompt and normalize() below re-validates every
 * field. A real read elsewhere in this codebase came back with the whole payload
 * nested one level deeper than asked for, which is exactly what that guards against.
 *
 * The model is ONLY a transcriber: it structures text the admin pasted. It must
 * never invent rates, features, or figures — only restructure what is present.
 * The result is always reviewed and confirmed by a human before anything is saved.
 *
 * Returns null on any failure so the caller can surface a clean error.
 */

import type { MortgagePackageInput, RateScheduleEntry } from '@/lib/types/rates'
import { cleanReference } from '@/lib/insurance/rateSchedule'
import { callClaude } from '@/lib/ai/claude'

const SYSTEM_INSTRUCTION = `You convert a pasted Singapore mortgage rate block (from a broker's working sheet or a banker's message) into STRUCTURED package data.

STRICT RULES:
1. Extract ONLY what is written. Never invent rates, spreads, features, subsidies, or loan sizes. If something isn't stated, leave it out (do not guess).
2. Output one package object per distinct price tier — even if it serves several property types at different minimums (use min_entries for that, rule 5; never duplicate the package yourself).
3. Rate schedule:
   - "Year 1: 2.00% Fixed" / "Y1: 2.00% Fixed" → { year:1, type:"fixed", rate:2.00 }
   - "Y1&2: 1.50% Fixed" → TWO entries: { year:1, type:"fixed", rate:1.50 } and { year:2, type:"fixed", rate:1.50 }
   - "Year 2: 3M SORA + 0.35%" → { year:2, type:"floating", reference:"3M SORA", spread:0.35 }
   - "TA:" or "Thereafter:" → { thereafter:true, ... } (omit year)
   - Normalize benchmarks: "1m"→"1M SORA", "3m"→"3M SORA". KEEP combined ones as "1M/3M SORA". Keep "1M Compounded SORA" / "FD Rate" verbatim in reference.
4. category: "Fixed" if year-1 is a fixed rate; "Floating (Completed)" if all-floating for a completed property; "BUC" only if the block clearly says BUC / Building Under Construction / new launch / no-lock progressive. Infer from headings/context.
5. min_entries — the minimum loan size(s), read from the SECTION HEADER above the package (a header applies to EVERY package below it until the next header/separator). Each entry = { property_type, min } where "min" is the size token COPIED EXACTLY AS WRITTEN — do NOT convert it to a number, the system does that:
   - "HDB (Min 200K)" → [{ "property_type":"HDB", "min":"200K" }]
   - "PTE (Min 300K)" (PTE = private) → [{ "property_type":"Private", "min":"300K" }]
   - COMBINED "HDB (Min 200K)/ PTE (Min 300K)" → put BOTH in min_entries of the ONE package: [{ "property_type":"HDB","min":"200K" }, { "property_type":"Private","min":"300K" }]. The system creates the separate rows — do NOT duplicate the package.
   - Plain header, no property type ("Min 500K", "500K", "Min 3M", "Min 1.5m") → [{ "property_type":"HDB / Private", "min":"500K" }] / [{ "property_type":"HDB / Private", "min":"3M" }]. Copy "3M", "1.5m", "200K" verbatim — never rewrite them.
   - If the type is only in the package name ("(HDB Exclusive)") use that property_type with the section's min.
   - CUSTOMER-SEGMENT minimums — when the header gives the SAME package two qualifying minimums by customer type ("Min loan size 500K (Normal customer)" + "Min loan size 300K (Priority customer)"), this is ONE package, NOT a property split. Use the NORMAL (higher) token as min → [{ "property_type":"HDB / Private", "min":"500K" }], and put the lower Priority threshold in min_loan_note (rule 6): "Priority Banking: min $300K". If both are equal (100K/100K) omit the note. Property type stays "HDB / Private" unless a type is stated.
6. min_loan_note: ONLY for loan-SIZE threshold wording. For a Premier/dual threshold ("≥$600k Premier or ≥$800k") set min to the lower token ("600K") and put the full wording in min_loan_note. For "(No min loan for Treasures customers with $350k AUM)" keep the section token as min and put the wording in min_loan_note. Customer-segment ranges (Normal vs Priority/Premier, see rule 5) also belong here as "Priority Banking: min $X". A package CONDITION is NOT a min_loan_note — e.g. "Need to have BOC credit card", "No min spend", salary crediting, insurance bundling. Those go in features. ("No min spend" is about credit-card spend, NOT the loan minimum.)
7. lockin_years: integer from the package ("2 Years Lock-in" → 2; "No Lock-in" → 0).
8. property_type values allowed: "HDB", "Private", "HDB / Private", "Executive Condominium".
9. package_name: use the name in the block if present; otherwise build a short one like "<n>Y Fixed - <lockin>Y Lock-in".
10. features: bullet lines under the package (free conversion, funding requirement, cash incentive, etc). Empty array if none.

OUTPUT — reply with a single JSON object and nothing else. No prose, no markdown fences. It must match this shape exactly, with "packages" at the TOP LEVEL. Do not nest it inside another object, and do not add fields that are not listed here:
{
  "packages": [
    {
      "package_name": "2Y Fixed - 2Y Lock-in",
      "category": "Fixed",
      "lockin_years": 2,
      "min_entries": [{ "property_type": "HDB", "min": "200K" }],
      "min_loan_note": "Priority Banking: min $300K",
      "rate_schedule": [
        { "year": 1, "type": "fixed", "rate": 2.00 },
        { "thereafter": true, "type": "floating", "reference": "3M SORA", "spread": 0.75 }
      ],
      "features": ["Free conversion after lock-in"],
      "subsidies": "Legal subsidy $2,000"
    }
  ]
}`

const ALLOWED_CATEGORIES = ['Fixed', 'Floating (Completed)', 'BUC']
const ALLOWED_PROPERTY = ['HDB', 'Private', 'HDB / Private', 'Executive Condominium']


export async function extractPackages(text: string, bank: string): Promise<MortgagePackageInput[] | null> {
    if (!text.trim() || !bank.trim()) return null

    const { text: raw } = await callClaude({
        label: 'extractPackages',
        system: SYSTEM_INSTRUCTION,
        user: `Bank: ${bank}\n\nPaste:\n${text.trim()}`,
        // Headroom for big bank dumps (a full bank can be ~20 packages);
        // truncation produces invalid JSON and loses the whole extraction.
        maxTokens: 20000,   // includes thinking
        thinking: 'medium',
        timeoutMs: 55000,
    })
    if (!raw) return null

    try {
        const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
        const parsed = JSON.parse(cleaned)
        // No schema is enforced on this call, so
        // tolerate the array arriving at the top level or under a stray key.
        const packages = Array.isArray(parsed) ? parsed
            : Array.isArray(parsed?.packages) ? parsed.packages
                : null
        if (!packages) {
            console.error('[extractPackages] response had no packages array')
            return null
        }
        const out = normalize(packages, bank)
        return out && out.length ? out : null
    } catch (err) {
        console.error(`[extractPackages] parse failed: ${String(err)}`)
        return null
    }
}

// Coerce + sanitise the model output into clean MortgagePackageInput rows.
function normalize(packages: unknown, bank: string): MortgagePackageInput[] | null {
    if (!Array.isArray(packages)) return null
    const result: MortgagePackageInput[] = []

    for (const p of packages) {
        if (!p || typeof p !== 'object') continue
        const o = p as Record<string, any>

        const category = ALLOWED_CATEGORIES.includes(o.category) ? o.category : 'Fixed'

        const schedule: RateScheduleEntry[] = Array.isArray(o.rate_schedule)
            ? o.rate_schedule.map((e: any): RateScheduleEntry => {
                // Infer floating from the data itself (reference/spread present, or a
                // SORA-ish type string) — the model sometimes returns "SORA"/"Fixed"
                // instead of the enum, which would otherwise be misread.
                const t = String(e?.type ?? '').toLowerCase()
                const isFloating = e?.reference != null || e?.spread != null || t.includes('float') || t.includes('sora')
                const type: 'fixed' | 'floating' = isFloating ? 'floating' : 'fixed'
                const entry: RateScheduleEntry = { type }
                if (e?.thereafter) entry.thereafter = true
                else if (e?.year != null) entry.year = Number(e.year)
                if (type === 'floating') {
                    if (e?.reference) entry.reference = cleanReference(String(e.reference))
                    if (e?.spread != null) entry.spread = Number(e.spread)
                } else {
                    if (e?.rate != null) entry.rate = Number(e.rate)
                }
                return entry
            })
            : []

        // Year follows row order (schedules are sequential) — auto-corrects
        // duplicate-year typos in the source (e.g. "Year 3" twice).
        let yc = 0
        for (const e of schedule) {
            if (e.thereafter) e.year = undefined
            else e.year = ++yc
        }

        const features = Array.isArray(o.features) ? o.features.map((f: any) => String(f).trim()).filter(Boolean) : []
        const base = {
            bank,
            category: category as MortgagePackageInput['category'],
            package_name: String(o.package_name || 'Untitled package').trim(),
            lockin_years: Number(o.lockin_years) || 0,
            features,
            subsidies: o.subsidies ? String(o.subsidies).trim() : null,
            min_loan_note: siftLoanNote(o.min_loan_note, features),
            status: 'draft' as const,   // extracted rows start as draft until the admin publishes via replace
        }

        // Deterministic split: one row per property type the package serves.
        // Code (not the model) parses the K/M size token and creates the rows,
        // so a "twin" can't be missed and "3M" can't become 300k.
        const entries: { property_type?: string; min?: unknown }[] =
            Array.isArray(o.min_entries) && o.min_entries.length
                ? o.min_entries
                : [{ property_type: 'HDB / Private', min: o.min_loan_size }]

        for (const e of entries) {
            const property_type = ALLOWED_PROPERTY.includes(e?.property_type as string) ? (e!.property_type as string) : 'HDB / Private'
            result.push({
                ...base,
                property_type,
                min_loan_size: parseMinSize(e?.min),
                rate_schedule: schedule.map(x => ({ ...x })),   // clone per row so edits don't bleed across rows
            })
        }
    }

    return result
}

// min_loan_note is ONLY for loan-size *threshold* wording (e.g. "≥$600k Premier
// or ≥$800k", "$350k AUM Treasures"). Weaker models sometimes misfile a package
// CONDITION here — classically "No min spend", where the word "min" trips them,
// which then masks the real loan size in the UI. A genuine note references money
// (a digit) or a banking tier; anything else is a stray condition → fold it into
// features so nothing is lost, and clear the note. Keeps junk out regardless of
// which model ran, so we never depend on the model getting this right.
function siftLoanNote(rawNote: unknown, features: string[]): string | null {
    const note = rawNote ? String(rawNote).trim() : ''
    if (!note) return null
    const isThreshold = /\d/.test(note) || /premier|treasures|priority|privilege|private bank|\baum\b|wealth/i.test(note)
    if (isThreshold) return note
    if (!features.some(f => f.toLowerCase() === note.toLowerCase())) features.push(note)
    return null
}

/** Parse a raw size token ("200K", "3M", "1.5m", "500000", "$1,000,000") to SGD. */
function parseMinSize(token: unknown): number {
    if (token == null) return 0
    const s = String(token).replace(/[,$\s]/g, '').toLowerCase()
    const m = s.match(/^([\d.]+)\s*(k|m)?/)
    if (!m) return 0
    let n = parseFloat(m[1])
    if (!Number.isFinite(n)) return 0
    if (m[2] === 'k') n *= 1_000
    else if (m[2] === 'm') n *= 1_000_000
    return Math.round(n)
}
