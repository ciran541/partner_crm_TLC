/**
 * Rate ingestion extractor — turns a pasted Google-Sheet block into structured
 * packages via Gemini (JSON mode, strict schema, temperature 0).
 *
 * Gemini is ONLY a transcriber here: it structures text the admin pasted. It must
 * never invent rates, features, or figures — only restructure what is present.
 * The result is always reviewed and confirmed by a human before anything is saved.
 *
 * Returns null on any failure so the caller can surface a clean error.
 */

import type { MortgagePackageInput, RateScheduleEntry } from '@/lib/types/rates'
import { cleanReference } from '@/lib/insurance/rateSchedule'

// Extraction is mechanical + enum-constrained + human-reviewed, so the lighter,
// less-loaded model is the better primary here (the heavier flash 503s often on
// free tier). Knowledge answer-synthesis keeps flash first — different trade-off.
const DEFAULT_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash-lite']

function modelChain(): string[] {
    const primary = process.env.GEMINI_MODEL
    const chain = primary ? [primary, ...DEFAULT_MODELS] : DEFAULT_MODELS
    return [...new Set(chain)]
}

const SYSTEM_INSTRUCTION = `You convert a pasted Singapore mortgage rate block (from a broker's working sheet or a banker's message) into STRUCTURED package data.

STRICT RULES:
1. Extract ONLY what is written. Never invent rates, spreads, features, subsidies, or loan sizes. If something isn't stated, leave it out (do not guess).
2. Output one package per distinct price tier. A single heading like "1 Year Fixed >$600k or >$800k (Premier)" with one set of rates = ONE package.
3. Rate schedule:
   - "Year 1: 2.00% Fixed" / "Y1: 2.00% Fixed" → { year:1, type:"fixed", rate:2.00 }
   - "Y1&2: 1.50% Fixed" → TWO entries: { year:1, type:"fixed", rate:1.50 } and { year:2, type:"fixed", rate:1.50 }
   - "Year 2: 3M SORA + 0.35%" → { year:2, type:"floating", reference:"3M SORA", spread:0.35 }
   - "TA:" or "Thereafter:" → { thereafter:true, ... } (omit year)
   - Normalize benchmarks: "1m"→"1M SORA", "3m"→"3M SORA". KEEP combined ones as "1M/3M SORA". Keep "1M Compounded SORA" / "FD Rate" verbatim in reference.
4. category: "Fixed" if year-1 is a fixed rate; "Floating (Completed)" if all-floating for a completed property; "BUC" only if the block clearly says BUC / Building Under Construction / new launch / no-lock progressive. Infer from headings/context.
5. min_loan_size (SGD, numeric lower bound). IMPORTANT: a standalone line such as "100K", "200K", "500K", "Min 1M", "Min 1.5m", "Min 2m" is a SECTION HEADER for minimum loan size — it applies to EVERY package listed below it until the next such header/separator. Convert suffixes: K = thousand, M/m = million (100K→100000, 500K→500000, 1M→1000000, 1.5m→1500000, 2m→2000000). For a Premier/dual threshold ("≥$600k Premier or ≥$800k") use the lower number; for a parenthetical like "(No min loan for Treasures customers with $350k AUM)" keep the section number as min_loan_size and put the wording in min_loan_note.
6. lockin_years: integer from the package (e.g. "2 Years Lock-in" → 2; "No Lock-in" → 0).
7. property_type: one of "HDB", "Private", "HDB / Private", "Executive Condominium". Infer from the name when stated — "(HDB Exclusive)" → "HDB". If not stated, use "HDB / Private".
8. package_name: use the name in the block if present; otherwise build a short one like "<n>Y Fixed - <lockin>Y Lock-in".
9. features: bullet lines under the package (free conversion, funding requirement, cash incentive, etc). Empty array if none.`

const ALLOWED_CATEGORIES = ['Fixed', 'Floating (Completed)', 'BUC']
const ALLOWED_PROPERTY = ['HDB', 'Private', 'HDB / Private', 'Executive Condominium']

const RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        packages: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    property_type: { type: 'string', enum: ALLOWED_PROPERTY },
                    category: { type: 'string', enum: ALLOWED_CATEGORIES },
                    min_loan_size: { type: 'number' },
                    min_loan_note: { type: 'string' },
                    package_name: { type: 'string' },
                    lockin_years: { type: 'integer' },
                    rate_schedule: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                year: { type: 'integer' },
                                thereafter: { type: 'boolean' },
                                type: { type: 'string', enum: ['fixed', 'floating'] },
                                rate: { type: 'number' },
                                reference: { type: 'string' },
                                spread: { type: 'number' },
                            },
                            required: ['type'],
                        },
                    },
                    features: { type: 'array', items: { type: 'string' } },
                    subsidies: { type: 'string' },
                },
                required: ['package_name', 'category', 'rate_schedule'],
            },
        },
    },
    required: ['packages'],
}

export async function extractPackages(text: string, bank: string): Promise<MortgagePackageInput[] | null> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey || !text.trim() || !bank.trim()) return null

    const body = JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: `Bank: ${bank}\n\nPaste:\n${text.trim()}` }] }],
        generationConfig: {
            temperature: 0,
            maxOutputTokens: 16384,  // headroom for big bank dumps (a full bank can be ~20 packages); truncation → invalid JSON
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
        },
    })

    for (const model of modelChain()) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
        try {
            // One retry on transient 503/429 before moving on. Each call is capped
            // so a slow model can't burn the whole serverless budget.
            let res: Response | null = null
            for (let attempt = 0; attempt < 2; attempt++) {
                res = await fetch(url, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
                    signal: AbortSignal.timeout(25000),
                })
                if (res.ok || (res.status !== 503 && res.status !== 429)) break
                if (attempt === 0) await new Promise(r => setTimeout(r, 800))
            }
            if (!res || !res.ok) {
                console.error(`[extractPackages] ${model} HTTP ${res?.status}`)
                continue
            }
            const json = await res.json()
            let raw = json?.candidates?.[0]?.content?.parts?.[0]?.text
            if (typeof raw !== 'string' || !raw.trim()) continue
            raw = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')   // strip any stray fences

            const parsed = JSON.parse(raw)
            const out = normalize(parsed?.packages, bank)
            if (out && out.length) return out
        } catch (err) {
            console.error(`[extractPackages] ${model} threw: ${String(err)}`)
        }
    }
    return null
}

// Coerce + sanitise the model output into clean MortgagePackageInput rows.
function normalize(packages: unknown, bank: string): MortgagePackageInput[] | null {
    if (!Array.isArray(packages)) return null
    const result: MortgagePackageInput[] = []

    for (const p of packages) {
        if (!p || typeof p !== 'object') continue
        const o = p as Record<string, any>

        const category = ALLOWED_CATEGORIES.includes(o.category) ? o.category : 'Fixed'
        const property_type = ALLOWED_PROPERTY.includes(o.property_type) ? o.property_type : 'HDB / Private'

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

        result.push({
            bank,
            property_type,
            category: category as MortgagePackageInput['category'],
            min_loan_size: Number(o.min_loan_size) || 0,
            package_name: String(o.package_name || 'Untitled package').trim(),
            lockin_years: Number(o.lockin_years) || 0,
            rate_schedule: schedule,
            features: Array.isArray(o.features) ? o.features.map((f: any) => String(f).trim()).filter(Boolean) : [],
            subsidies: o.subsidies ? String(o.subsidies).trim() : null,
            min_loan_note: o.min_loan_note ? String(o.min_loan_note).trim() : null,
            status: 'draft',   // extracted rows start as draft until the admin publishes via replace
        })
    }

    return result
}
