/**
 * Letter-of-Offer extractor for the Property Agent "Submit a New Case" wizard —
 * turns an uploaded LO (bank PDF, or a photo/screenshot of one) into the
 * mortgage figures Step 3 currently makes an agent type by hand: bank, loan
 * amount, tenure, lock-in period, rate schedule, property address, and the
 * LO's own issue date.
 *
 * This is a property-specific fork of lib/insurance/extractLoanOffer.ts (built
 * for the insurance app's Closed-Won flow) rather than a shared module — the
 * two apps' target schemas differ (a property case stores ONE combined loan
 * amount/tenure, not a breakdown per facility kind the way insurance's
 * Closed-Won does) and this codebase's own convention duplicates this kind
 * of AI-call scaffolding per file (see news.ts / bankIntelligence.ts /
 * extractLoanOffer.ts). The hard-won reading rules below (lock-in derivation,
 * rate-schedule expansion, the four-address problem) are carried over
 * verbatim from that module.
 *
 * An LO can grant MORE THAN ONE facility — a refinancing LO very often
 * carries a Housing Loan AND a separate Term Loan (cash-out on top of the
 * refinance), each with its own amount and heading, both usually sharing one
 * tenure and rate schedule. The property case only has room for one combined
 * loan amount, so this module extracts every facility separately (never lets
 * the model add them up itself — same "let code do the arithmetic" rule as
 * money parsing) and sums them in normalize(). A real HSBC LO drove this: a
 * Housing Loan of $245,000 plus a Term Loan of $735,000 is a $980,000 case,
 * not a $245,000 one.
 *
 * The model is ONLY a transcriber. It must never invent an amount, tenure,
 * rate or lock-in — an LO that doesn't state something must come back with
 * that field absent, not guessed. The agent reviews and can edit every
 * figure before the case is submitted; a silent misread would misrepresent a
 * client's mortgage, not just a display value.
 *
 * TWO LANES, chosen by whether real text comes out — not by file extension:
 *   PDF with a text layer  -> pdf-parse -> DeepSeek   (primary)
 *   image, or PDF that parsed empty -> Gemini vision (only lane that can read it)
 *
 * Returns null on any failure so the caller can surface a clean error and the
 * agent just fills the form by hand — extraction never blocks submission.
 */

export const LO_ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const

export interface RateScheduleEntry {
    year?: number
    thereafter?: boolean
    type: 'fixed' | 'floating'
    rate?: number
    reference?: string
    spread?: number
}

export interface LoanFacility {
    /** As printed on the LO ("Housing Loan", "Term Loan", "Bridging Loan"). For the review note only — the case schema has no per-facility column. */
    label?: string
    amount: number
    tenure_years: number
}

export interface ExtractedLo {
    /** One entry per distinct facility the LO grants. */
    loans: LoanFacility[]
    /** Sum of loans[].amount — this is what fills the case's single loan-amount field. */
    total_loan_amount: number
    /** Representative tenure across facilities — see normalize() for the tie-break when they differ. */
    tenure_years: number
    lockin_years?: number
    schedule: RateScheduleEntry[]
    bank?: string
    /** The mortgaged property as printed on the LO. */
    property_address?: string
    /** LO's own issue/dated date, YYYY-MM-DD, only if literally printed. */
    lo_date?: string
    /** Free-text description of any subsidy granted — shown to the agent, never auto-filled into a number field. */
    subsidy?: string
    /** Which lane produced this — surfaced to the agent so a vision read is visibly lower-confidence. */
    source: 'pdf-text' | 'vision'
    /** Things the LO didn't state or the model was unsure of. Shown, never acted on. */
    notes: string[]
}

// ─── Prompt ───────────────────────────────────────────────────────────────────
// Money and tenure come back as RAW TOKENS copied from the document; code parses
// them (parseMoney/parseTenureYears below) — letting the model do the
// arithmetic is what once turned "3M" into 300k in the insurance version.
const SYSTEM_INSTRUCTION = `You transcribe a Singapore bank Letter of Offer (LO) into structured mortgage data for a property agent's CRM.

STRICT RULES:
1. Transcribe ONLY what the document states. Never infer, estimate, complete or average anything. If the LO does not state a figure, OMIT that field entirely — do not guess, and do not substitute a typical or default value.
2. Copy money and tenure as RAW TEXT exactly as printed — "$1,250,000.00", "1,250,000", "S$800,000", "25 years", "300 months". Do NOT convert, round, or do arithmetic. The system parses and totals these — NEVER add facilities together yourself.
3. loans — the LO may grant MORE THAN ONE facility. A refinancing LO very often carries a Housing Loan AND a separate Term Loan (a cash-out on top of the refinance) — sometimes also a Bridging Loan. RETURN ONE ENTRY IN "loans" FOR EACH DISTINCT FACILITY, each with its own amount, tenure, and a short "label" copied from the facility's own heading (e.g. "Housing Loan", "Term Loan", "Bridging Loan"). If the LO grants only one facility, return exactly one entry. Take the AMOUNT THE BANK IS LENDING for each facility.
   WHERE TO LOOK: the facility figures sit in a particulars/summary block near the start, often as separate numbered sections ("1 Housing Loan", "2 Term Loan"). Every bank words it differently — accept any of these headings: "Particulars of Credit Facilities", "Facility Details", "Loan Details", "The Facility", "Schedule", "Key Terms", or an unlabelled table on page 1.
   The AMOUNT may be labelled: Amount, Loan Amount, Facility Amount, Facility limit, Principal, Approved Loan Amount.
   The TENURE may be labelled: Tenor, Tenure, Term, Loan Period, Repayment Period, Loan Tenure — in years OR months.
   Do NOT confuse a loan amount with: the property's Purchase Price, its valuation or "Estimated Valuation", CPF sums being released, or a minimum-outstanding threshold quoted in a fee-waiver clause.
4. lockin_years — the commitment period in whole years. Banks name this differently and MANY NEVER PRINT THE WORDS "LOCK-IN" AT ALL. Accept any of: "Lock-in Period", "Commitment Period", "Prepayment Period", "Redemption Period", "Minimum Period", "Penalty Period". If none of those labels appears, DERIVE it from the period during which redeeming or prepaying the loan attracts a FEE:
   - "a redemption fee of 1.5% flat ... if the Loan is redeemed in full within 2 years from date of first disbursement" -> 2
   - "Lock-in Period: 24 months" / "Commitment Period of 2 years" -> 2
   - "No lock-in" / "no redemption penalty" / no such fee anywhere -> 0
   Convert months to whole years. ONLY report 0 when the document POSITIVELY STATES there is no lock-in / no redemption or prepayment fee. If you were given a partial document (a single page, a screenshot, an excerpt) and it simply does not mention a lock-in, OMIT lockin_years entirely and add a note rather than reporting 0.
5. schedule — RETURN ONE ENTRY FOR EVERY YEAR ROW THE LO LISTS, in order, including the fixed ones. This is the field most often got wrong: don't lose the early fixed years by only transcribing the floating rows.
   The table heading varies ("Year of Loan | Applicable Interest Rate", "Interest Rate", "Pricing"). So does the row label — accept ALL of these and map them to year numbers:
   - "Year 1" / "Yr 1" / "1st year" -> year 1
   - "Years 1-2" / "Year 1 & 2" -> TWO entries, years 1 and 2, same rate
   - "Months 1-24" -> TWO entries, years 1 and 2 (12 months = 1 year)
   - "Thereafter" / "4th year onwards" / "Subsequent years" -> { thereafter:true }
   EVERY entry must carry "rate_text": the rate for that row copied EXACTLY as printed. Also fill "rate" (fixed) or "reference"+"spread" (floating) when you can, but rate_text must always be there.
   - "1st year : 1.6% Fixed" -> { year:1, type:"fixed", rate_text:"1.6% Fixed", rate:1.6 }
   - "3rd year : 0.5% above 3-month Compounded SORA" -> { year:3, type:"floating", rate_text:"0.5% above 3-month Compounded SORA", reference:"3M SORA", spread:0.5 }
   - "Thereafter: 3M SORA + 0.75%" -> { thereafter:true, type:"floating", rate_text:"3M SORA + 0.75%", reference:"3M SORA", spread:0.75 }
   - "X% above <benchmark>" means spread X over that benchmark — floating, spread:X. A rate written as a plain percentage with the word Fixed is type "fixed" with that rate and NO reference and NO spread.
   - Set "type" to exactly "fixed" or "floating". Normalize benchmarks: "1m"/"1-month SORA" -> "1M SORA", "3m" -> "3M SORA".
   - A rate is a percentage per annum. Never output a monthly instalment amount as a rate.
6. bank — the issuing bank's name as printed on the LO.
7. property_address — the address of the MORTGAGED PROPERTY, exactly as printed, including block letter, unit number and postal code. An LO typically prints FOUR addresses and only one is correct:
   (a) the bank's own address on the letterhead — NEVER this;
   (b) the borrower's current mailing address, in the addressee block at the top of page 1 — NEVER this, even though it is the most prominent;
   (c) a property being SOLD or redeemed (usually under "Special Conditions") — NEVER this;
   (d) THE ONE YOU WANT — the financed property. Look for a labelled row inside the facility table ("Property:", "Property Address:", "Subject Property:") — USE IT if present, it is unambiguous. Otherwise use the SECURITY / MORTGAGE / CHARGE / COLLATERAL clause, typically phrased "A First Legal Mortgage over the property at: ...".
   (b) and (d) can be the SAME address when the borrower already lives in the property being financed — that is fine. Be careful: they are often on the same street and differ only by block letter, unit or postal code — copy digit by digit, do not merge the two. Omit if there is no security clause.
8. lo_date — the date the Letter of Offer itself was issued/dated, formatted YYYY-MM-DD. This is usually near the top of page 1 (e.g. "Date: 15 March 2026", or in the salutation block above "Dear Sir/Madam"). This is NOT the loan's first-disbursement date, NOT an expiry/validity date, and NOT the addressee's date of birth. Omit if not clearly printed.
9. subsidy — ONE SHORT LINE, AT MOST 25 WORDS. Give ONLY a subsidy, rebate or reimbursement the BANK ITSELF grants to the borrower (legal fees, valuation, fire insurance, cash rebate), with the amount and any clawback condition: "Cash incentive SGD2,000, clawback if redeemed within 3 years". Omit entirely if the bank grants none — most LOs grant none. A borrower DECLARATION about discounts from the VENDOR, or CPF monies being released, are NOT subsidies — never report those here.
10. notes — short plain-English flags for anything a human should double-check: a figure you could not find, text that was blurred/cropped/illegible, or a facility whose type you're unsure of. Empty array if the LO was complete and fully clear. Only flag a partial document when you genuinely received part of an LO (one page, a screenshot) — a footer reading "Page 1 of 11" does NOT mean you were given only page 1 if later page markers or later-page content (security clause, signature block) are present.
11. If the document is not a Letter of Offer at all (e.g. an ID, a valuation report, a blank page), return an empty "loans" array and no schedule, and one note saying what it appears to be.

LENGTH LIMITS — the response must stay compact. each loan label <= 30 characters; property_address <= 200 characters; subsidy <= 25 words; each note <= 25 words with at most 5 notes; each rate_text <= 20 words.

OUTPUT SHAPE — return exactly this structure. A single-facility LO still uses a one-element "loans" array:
{
  "loans": [
    { "label": "Housing Loan", "amount": "SGD 245,000.00", "tenure": "18 years" },
    { "label": "Term Loan", "amount": "SGD 735,000.00", "tenure": "18 years" }
  ],
  "schedule": [
    { "year": 1, "type": "fixed", "rate_text": "Fixed at 1.55% a year", "rate": 1.55 },
    { "thereafter": true, "type": "floating", "rate_text": "1% above 3-month Compounded SORA", "reference": "3M SORA", "spread": 1.0 }
  ],
  "lockin_years": 3,
  "bank": "OCBC Bank",
  "property_address": "178 Lompang Road #12-40 Singapore 670178",
  "lo_date": "2026-03-15",
  "subsidy": "Cash reward SGD 2,000, clawback if redeemed within 36 months",
  "notes": []
}`

const RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        loans: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    label: { type: 'string' },
                    amount: { type: 'string' },
                    tenure: { type: 'string' },
                },
                required: ['amount'],
            },
        },
        schedule: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    year: { type: 'integer' },
                    thereafter: { type: 'boolean' },
                    type: { type: 'string', enum: ['fixed', 'floating'] },
                    rate_text: { type: 'string' },
                    rate: { type: 'number' },
                    reference: { type: 'string' },
                    spread: { type: 'number' },
                },
                required: ['type', 'rate_text'],
            },
        },
        lockin_years: { type: 'integer' },
        bank: { type: 'string' },
        property_address: { type: 'string' },
        lo_date: { type: 'string' },
        subsidy: { type: 'string' },
        notes: { type: 'array', items: { type: 'string' } },
    },
    required: ['schedule'],
}

const USER_PREFIX = 'Transcribe this Letter of Offer per the instructions. Return JSON only.'

// ─── Wall-clock budget ────────────────────────────────────────────────────────
// Same reasoning as extractLoanOffer.ts: one shared deadline across both lanes
// so the route's maxDuration=60 kills nothing mid-flight.
const TOTAL_BUDGET_MS = 50_000
const TEXT_LANE_MS = 18_000
const MIN_CALL_MS = 6_000
const MIN_PDF_TEXT_CHARS = 400
const MIN_PLAUSIBLE_LOAN = 10_000

const msLeft = (deadline: number) => deadline - Date.now()

function callTimeout(deadline: number, cap: number): number | null {
    const left = msLeft(deadline)
    if (left < MIN_CALL_MS) return null
    return Math.min(cap, left)
}

// ─── Lane 1: DeepSeek (text) ──────────────────────────────────────────────────
const DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro']

async function callDeepSeek(loText: string, deadline: number): Promise<string | null> {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) return null

    for (const model of DEEPSEEK_MODELS) {
        const body = JSON.stringify({
            model,
            messages: [
                { role: 'system', content: SYSTEM_INSTRUCTION },
                { role: 'user', content: `${USER_PREFIX}\n\nLetter of Offer text:\n${loText.slice(0, 60000)}` },
            ],
            temperature: 0,
            max_tokens: 4096,
            thinking: { type: 'disabled' },
            response_format: { type: 'json_object' },
        })
        try {
            let res: Response | null = null
            for (let attempt = 0; attempt < 2; attempt++) {
                const timeout = callTimeout(deadline, 20000)
                if (timeout == null) return null
                res = await fetch('https://api.deepseek.com/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                    body,
                    signal: AbortSignal.timeout(timeout),
                })
                if (res.ok || (res.status !== 503 && res.status !== 429)) break
                if (attempt === 0) await new Promise(r => setTimeout(r, 800))
            }
            if (!res || !res.ok) {
                console.error(`[extractLetterOfOffer] deepseek ${model} HTTP ${res?.status}`)
                continue
            }
            const json = await res.json()
            const text = json?.choices?.[0]?.message?.content
            if (typeof text === 'string' && text.trim()) return text
        } catch (err) {
            console.error(`[extractLetterOfOffer] deepseek ${model} threw: ${String(err)}`)
        }
    }
    return null
}

// ─── Lane 2: Gemini (vision) ──────────────────────────────────────────────────
interface ModelDef { id: string; genExtra?: Record<string, unknown> }
const GEMINI_MODELS: ModelDef[] = [
    { id: 'gemini-2.5-flash', genExtra: { thinkingConfig: { thinkingBudget: 0 } } },
    { id: 'gemini-2.5-flash-lite', genExtra: { thinkingConfig: { thinkingBudget: 0 } } },
]

async function callGeminiVision(file: LoFile, deadline: number): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return null

    const keyFingerprint = `key ...${apiKey.slice(-4)} (len ${apiKey.length})`

    const basePayload = {
        system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{
            role: 'user',
            parts: [
                { inlineData: { mimeType: file.mime, data: file.buffer.toString('base64') } },
                { text: USER_PREFIX },
            ],
        }],
        generationConfig: {
            temperature: 0,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
        },
    }

    // Auditable outbound log, matching deepseek.ts's and bankIntelligence.ts's
    // — the only part sent here is the page image the agent uploaded to this
    // case, plus this function's own fixed instruction text; never anything
    // from lib/google/*. Image bytes are summarized by type, not dumped.
    console.log(`[Gemini OUTBOUND extractLetterOfOffer] mimeType=${file.mime} instruction="${USER_PREFIX.slice(0, 200)}"`)

    for (const { id: model, genExtra } of GEMINI_MODELS) {
        const body = JSON.stringify(genExtra
            ? { ...basePayload, generationConfig: { ...basePayload.generationConfig, ...genExtra } }
            : basePayload
        )
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
        try {
            let res: Response | null = null
            for (let attempt = 0; attempt < 2; attempt++) {
                const timeout = callTimeout(deadline, 30000)
                if (timeout == null) return null
                res = await fetch(url, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
                    signal: AbortSignal.timeout(timeout),
                })
                if (res.ok || res.status !== 503) break
                if (attempt === 0) await new Promise(r => setTimeout(r, 800))
            }
            if (!res || !res.ok) {
                const detail = res ? await res.text().catch(() => '') : ''
                console.error(`[extractLetterOfOffer] gemini ${model} HTTP ${res?.status} ${keyFingerprint} ${detail.slice(0, 800)}`)
                if (res?.status === 429) lastFailure = 'rate_limited'
                continue
            }
            const json = await res.json()
            const finish = json?.candidates?.[0]?.finishReason
            if (finish && finish !== 'STOP') {
                console.error(`[extractLetterOfOffer] gemini ${model} stopped early: ${finish}`)
            }
            const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
            if (typeof text === 'string' && text.trim()) return text
        } catch (err) {
            console.error(`[extractLetterOfOffer] gemini ${model} threw: ${String(err)}`)
        }
    }
    return null
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export interface LoFile {
    buffer: Buffer
    mime: string
}

/**
 * Why the last extraction failed, when the reason is actionable — same
 * pattern as extractLoanOffer.ts's rate-limit signal.
 */
let lastFailure: 'rate_limited' | null = null
export function takeLastFailure(): 'rate_limited' | null {
    const f = lastFailure
    lastFailure = null
    return f
}

export async function extractLetterOfOffer(file: LoFile): Promise<ExtractedLo | null> {
    if (!file.buffer.length) return null
    lastFailure = null
    const deadline = Date.now() + TOTAL_BUDGET_MS

    let textLane: ExtractedLo | null = null
    if (file.mime === 'application/pdf') {
        let text = ''
        try {
            const { PDFParse } = await import('pdf-parse')
            const parser = new PDFParse({ data: file.buffer })
            text = (await parser.getText()).text ?? ''
            await parser.destroy()
        } catch (err) {
            console.error('[extractLetterOfOffer] pdf-parse threw:', String(err))
        }
        const trimmed = text.trim()
        console.log(`[extractLetterOfOffer] pdf-parse extracted ${trimmed.length} chars`)

        if (trimmed.length >= MIN_PDF_TEXT_CHARS) {
            const raw = await callDeepSeek(trimmed, Math.min(deadline, Date.now() + TEXT_LANE_MS))
            const parsed = raw && safeParse(raw)
            if (parsed) {
                const result = normalize(parsed, 'pdf-text')
                const score = completeness(result)
                console.log(`[extractLetterOfOffer] pdf-text lane completeness ${score}/${MAX_COMPLETENESS}`)
                if (score === MAX_COMPLETENESS) return result
                console.warn('[extractLetterOfOffer] incomplete text-lane read; escalating to vision')
                textLane = result
            }
        } else if (trimmed.length) {
            console.warn(`[extractLetterOfOffer] only ${trimmed.length} chars of text — treating as scanned, using vision`)
        }
    }

    const raw = await callGeminiVision(file, deadline)
    const parsed = raw && safeParse(raw)
    if (parsed) {
        const result = normalize(parsed, 'vision')
        const score = completeness(result)
        console.log(`[extractLetterOfOffer] vision lane completeness ${score}/${MAX_COMPLETENESS}`)
        if (!textLane || score >= completeness(textLane)) return result
    }

    return textLane
}

export const MAX_COMPLETENESS = 4
export function completeness(r: ExtractedLo): number {
    let n = 0
    if (r.total_loan_amount > 0) n++
    if (r.tenure_years > 0) n++
    if (r.schedule.length > 0) n++
    if (r.lockin_years != null) n++
    return n
}

function safeParse(raw: string): Record<string, unknown> | null {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    try {
        const json = JSON.parse(cleaned)
        return json && typeof json === 'object' ? json as Record<string, unknown> : null
    } catch {
        const repaired = repairTruncatedJson(cleaned)
        if (!repaired) return null
        try {
            const json = JSON.parse(repaired)
            if (!json || typeof json !== 'object') return null
            console.warn('[extractLetterOfOffer] response was truncated; recovered a partial read')
            return json as Record<string, unknown>
        } catch {
            return null
        }
    }
}

/**
 * Best-effort recovery of JSON that was cut off mid-response — same rewind
 * logic as extractLoanOffer.ts, ported because the same model failure mode
 * (a garbled table dumped into one field, hitting the output cap) applies here.
 */
export function repairTruncatedJson(raw: string): string | null {
    const s = raw.trim()
    const open: string[] = []
    let inString = false
    let escaped = false
    let cutAt = -1
    let openAtCut: string[] = []

    for (let i = 0; i < s.length; i++) {
        const c = s[i]
        if (inString) {
            if (escaped) escaped = false
            else if (c === '\\') escaped = true
            else if (c === '"') inString = false
            continue
        }
        if (c === '"') { inString = true; continue }
        else if (c === '{') open.push('}')
        else if (c === '[') open.push(']')
        else if (c === '}' || c === ']') open.pop()
        else if (c === ',' && open.length) {
            cutAt = i
            openAtCut = [...open]
        }
    }

    if (!open.length && !inString) return null
    if (cutAt < 0) return null
    return s.slice(0, cutAt) + openAtCut.reverse().join('')
}

// ─── Normalisation ────────────────────────────────────────────────────────────
// Pure and unit-tested. The model hands over raw tokens and loose shapes; code
// decides what becomes a number.

/** Tidy spacing on an already-formed benchmark string ("3M  SORA" -> "3M SORA"). */
function cleanReference(raw: string): string {
    return raw.replace(/(\d)\s*M\s*SORA/gi, '$1M SORA').replace(/\s+/g, ' ').trim()
}

export function normalizeBenchmark(raw: string): string {
    let s = raw.trim()
    if (!s) return s

    s = s.replace(/(\d+)[\s-]*(?:mth|month)s?\b/gi, '$1M')

    const isCombined = /\d+\s*M\s*\/\s*\d+\s*M/i.test(s)
    if (!isCombined && /sora|overnight rate average/i.test(s)) {
        const tenor = s.match(/\b(\d+)\s*M\b/i)
        if (tenor) return `${tenor[1]}M SORA`
    }

    const bare = s.match(/^(\d+)\s*m$/i)
    if (bare) return `${bare[1]}M SORA`

    s = s.replace(/\bcompounded\s+sora\b/gi, 'SORA')

    return cleanReference(s)
}

/** Parse a money token to SGD. "$1,250,000.00" | "1.25M" | "800K" | "800000". */
export function parseMoney(token: unknown): number {
    if (typeof token === 'number') return Number.isFinite(token) && token > 0 ? Math.round(token) : 0
    if (token == null) return 0

    let s = String(token).trim().toLowerCase()
        .replace(/\s/g, '')
        .replace(/^sgd/, '')
        .replace(/^s?\$/, '')

    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
    s = s.replace(/,/g, '')

    const m = s.match(/^([\d.]+)\s*(k|m)?/)
    if (!m) return 0
    const n = parseFloat(m[1])
    if (!Number.isFinite(n) || n <= 0) return 0
    if (m[2] === 'k') return Math.round(n * 1_000)
    if (m[2] === 'm') return Math.round(n * 1_000_000)
    return Math.round(n)
}

function parseRateNumber(v: unknown): number | undefined {
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
    if (v == null) return undefined
    const m = String(v).match(/\d+(?:\.\d+)?/)
    if (!m) return undefined
    const n = parseFloat(m[0])
    return Number.isFinite(n) ? n : undefined
}

/** Parse a tenure token to whole years — a bare number is ambiguous, so treat
 *  an explicit "month" unit, or a number too large to be plausible years, as months. */
export function parseTenureYears(token: unknown): number {
    if (token == null) return 0
    const s = String(token).trim().toLowerCase()
    const m = s.match(/([\d.]+)/)
    if (!m) return 0
    const n = parseFloat(m[1])
    if (!Number.isFinite(n) || n <= 0) return 0
    const isMonths = /month|mth|\bmo\b/.test(s) || n > 40
    const years = isMonths ? n / 12 : n
    const rounded = Math.round(years)
    return rounded > 0 && rounded <= 40 ? rounded : 0
}

/** YYYY-MM-DD only, within a plausible window — rejects anything else rather than guessing. */
function parseIsoDate(v: unknown, minYearsAgo: number, maxYearsAhead: number): string | undefined {
    const s = typeof v === 'string' ? v.trim() : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
    const d = new Date(`${s}T00:00:00Z`)
    if (Number.isNaN(d.getTime())) return undefined
    const year = d.getUTCFullYear()
    const now = new Date().getUTCFullYear()
    return year >= now - minYearsAgo && year <= now + maxYearsAhead ? s : undefined
}

export function normalize(o: Record<string, unknown>, source: ExtractedLo['source']): ExtractedLo {
    const notes: string[] = Array.isArray(o.notes)
        ? o.notes.map(n => String(n).trim()).filter(Boolean).slice(0, 8)
        : []

    // ── Loan facilities ── an LO can grant more than one (Housing Loan +
    // Term Loan is a common refinancing pattern) — sum them, never trust the
    // model to have added them up itself.
    const rawLoans = Array.isArray(o.loans)
        ? o.loans
        // Defensive fallback: if the model ignored the schema and returned
        // the single-facility shape at the top level anyway, treat it as one.
        : (o.loan_amount != null || o.tenure != null) ? [{ label: undefined, amount: o.loan_amount, tenure: o.tenure }] : []

    const loans: LoanFacility[] = []
    for (const l of rawLoans) {
        if (!l || typeof l !== 'object') continue
        const e = l as Record<string, unknown>
        const amount = parseMoney(e.amount)
        const tenure = parseTenureYears(e.tenure)
        if (!amount && !tenure) continue
        const label = typeof e.label === 'string' ? e.label.replace(/\s+/g, ' ').trim().slice(0, 30) : undefined
        loans.push({ label, amount, tenure_years: tenure })
    }

    const total_loan_amount = loans.reduce((sum, l) => sum + l.amount, 0)

    // Representative tenure: facilities from the same LO almost always share
    // one tenure (the HSBC LO that drove this — Housing Loan + Term Loan,
    // both "18 years" — is typical). When they genuinely differ, take the
    // longest and say so rather than silently picking one.
    const tenures = loans.map(l => l.tenure_years).filter(t => t > 0)
    const uniqueTenures = [...new Set(tenures)]
    const tenure_years = uniqueTenures.length ? Math.max(...uniqueTenures) : 0
    if (uniqueTenures.length > 1) {
        notes.push(`Facilities have different tenures (${uniqueTenures.join(', ')} years) — using the longest. Check each facility on the LO.`)
    }

    if (loans.length > 1) {
        const breakdown = loans.map(l => `${l.label ?? 'facility'} $${l.amount.toLocaleString()}`).join(' + ')
        notes.push(`Loan amount combines ${loans.length} facilities: ${breakdown} = $${total_loan_amount.toLocaleString()} total.`)
    }
    if (total_loan_amount > 0 && total_loan_amount < MIN_PLAUSIBLE_LOAN) {
        notes.push(`Loan amount came out as $${total_loan_amount.toLocaleString()}, which is too small for a mortgage — probably misread. Check it against the LO.`)
    }

    // ── Rate schedule ── same coercion as extractLoanOffer.ts: infer floating
    // from the data itself, since models sometimes return "SORA"/"Fixed"
    // instead of the enum.
    const rawSchedule = Array.isArray(o.schedule) ? o.schedule : []
    const schedule: RateScheduleEntry[] = []
    for (const s of rawSchedule) {
        if (!s || typeof s !== 'object') continue
        const e = s as Record<string, unknown>
        const t = String(e.type ?? '').toLowerCase()
        const ref = typeof e.reference === 'string' ? e.reference.trim() : ''
        const rateText = typeof e.rate_text === 'string' ? e.rate_text.trim() : ''
        const spreadVal = parseRateNumber(e.spread)
        const sig = t || rateText.toLowerCase()
        const saysFixed = sig.includes('fix')
        const saysFloating = sig.includes('float') || sig.includes('sora') || sig.includes('board')
            || sig.includes('fd ') || sig.includes('above')
        const isFloating = saysFloating || (!saysFixed && (!!ref || (spreadVal != null && spreadVal > 0)))
        const entry: RateScheduleEntry = { type: isFloating ? 'floating' : 'fixed' }
        if (e.thereafter) {
            entry.thereafter = true
        } else {
            const yr = parseRateNumber(e.year)
            if (yr != null && yr >= 1 && yr <= 40) entry.year = Math.round(yr)
        }
        const fromText = parseRateNumber(rateText)

        if (isFloating) {
            if (ref) entry.reference = normalizeBenchmark(ref)
            const spread = spreadVal ?? fromText
            if (spread != null) entry.spread = spread
        } else {
            const rate = parseRateNumber(e.rate) ?? fromText
            if (rate == null || rate <= 0 || rate > 25) continue
            entry.rate = rate
        }
        schedule.push(entry)
    }

    // Keep the model's row order — that is the LO's own order — and only move
    // "thereafter" rows to the end.
    const ordered = [...schedule.filter(e => !e.thereafter), ...schedule.filter(e => e.thereafter)]
    let last = 0
    for (const e of ordered) {
        if (e.thereafter) { e.year = undefined; continue }
        e.year = e.year != null && e.year > last ? e.year : last + 1
        last = e.year
    }
    schedule.length = 0
    schedule.push(...ordered)

    const text = (v: unknown, max: number): string | undefined => {
        const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim()
        return s ? s.slice(0, max) : undefined
    }

    const lockinRaw = Number(o.lockin_years)
    const lockin_years = Number.isFinite(lockinRaw) && lockinRaw >= 0 && lockinRaw <= 10
        ? Math.round(lockinRaw)
        : undefined

    // An LO is dated near issuance, never far in the past or future.
    const lo_date = parseIsoDate(o.lo_date, 2, 1)

    if (!loans.length) notes.push('No loan amount or tenure could be read from this file.')
    if (!schedule.length) notes.push('No rate schedule could be read from this file.')

    return {
        loans,
        total_loan_amount,
        tenure_years,
        lockin_years,
        schedule,
        bank: text(o.bank, 80),
        property_address: text(o.property_address, 300),
        lo_date,
        subsidy: text(o.subsidy, 200),
        source,
        notes,
    }
}

// ─── Mapping to the wizard's form fields ─────────────────────────────────────

export interface MortgageFieldPrefill {
    package_type: 'fixed' | 'floating' | ''
    fixed_years: string
    floating_rate_type: '1MSORA' | '3MSORA' | 'FD Rate' | 'Board Rate' | ''
    year_rates: string[]
}

/**
 * Turn a rate schedule into the wizard's package_type/fixed_years/
 * floating_rate_type/year_rates shape. The wizard only captures one rate row
 * per year of the LOCK-IN period (not the full loan tenure) and one shared
 * floating benchmark for all floating years — so a schedule with a mix of
 * benchmarks collapses to whichever benchmark the first floating year uses.
 */
export function toMortgageFields(schedule: RateScheduleEntry[], lockInYears: number): MortgageFieldPrefill {
    if (lockInYears <= 0 || !schedule.length) {
        return { package_type: '', fixed_years: '', floating_rate_type: '', year_rates: [] }
    }

    const byYear = new Map<number, RateScheduleEntry>()
    for (const e of schedule) {
        if (e.year != null) byYear.set(e.year, e)
    }
    const thereafter = schedule.find(e => e.thereafter)

    let fixedYears = 0
    while (fixedYears < lockInYears && byYear.get(fixedYears + 1)?.type === 'fixed') fixedYears++

    const firstFloating = schedule.find(e => e.type === 'floating')
    const floatingRateType = matchFloatingRateType(firstFloating?.reference)

    const year_rates: string[] = []
    for (let y = 1; y <= lockInYears; y++) {
        const entry = byYear.get(y) ?? (y > fixedYears ? thereafter : undefined)
        if (!entry) { year_rates.push(''); continue }
        const value = entry.type === 'fixed' ? entry.rate : entry.spread
        year_rates.push(value != null ? String(value) : '')
    }

    return {
        package_type: fixedYears > 0 ? 'fixed' : 'floating',
        fixed_years: fixedYears > 0 ? String(fixedYears) : '',
        floating_rate_type: floatingRateType,
        year_rates,
    }
}

function matchFloatingRateType(reference: string | undefined): MortgageFieldPrefill['floating_rate_type'] {
    if (!reference) return ''
    const s = reference.toUpperCase().replace(/\s+/g, '')
    if (s.includes('1M')) return '1MSORA'
    if (s.includes('3M')) return '3MSORA'
    if (s.includes('FD')) return 'FD Rate'
    if (s.includes('BOARD')) return 'Board Rate'
    return ''
}
