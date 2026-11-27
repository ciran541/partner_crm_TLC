/**
 * Letter-of-Offer extractor — turns an uploaded LO (bank PDF, or a photo /
 * screenshot of one) into the structured figures the Closed-Won form captures:
 * per-loan amount + tenure, lock-in years, and the rate schedule.
 *
 * The model is ONLY a transcriber. It must never invent an amount, tenure, rate
 * or lock-in — an LO that doesn't state something must come back with that field
 * absent, not guessed. The agent reviews and confirms every figure before the
 * case is closed, exactly like extractPackages.ts's rate ingestion: these
 * numbers feed original_loan_total → commission, so a silent misread would
 * mis-pay someone.
 *
 * TWO LANES, chosen by whether real text comes out — not by file extension:
 *
 *   PDF with a text layer  → pdf-parse → Claude reads the text   (primary)
 *   image, scanned PDF, or an incomplete text read → Claude reads the pages
 *
 * Routing on extracted text, not the extension, is what catches a photographed
 * LO "saved as PDF": a .pdf with no text layer at all.
 *
 * Returns null on any failure so the caller can surface a clean error and the
 * agent just fills the form by hand — extraction never blocks a close.
 */

import { callClaude, CLAUDE_MODEL, CLAUDE_VISION_MODEL } from '@/lib/ai/claude'
import { cleanReference } from '@/lib/insurance/rateSchedule'
import { CLOSED_LOAN_LABELS } from '@/lib/insurance/closedWon'
import type { RateScheduleEntry } from '@/lib/types/rates'
import type { ClosedLoanKind, ClosedWonLoan } from '@/lib/types'

export const LO_ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const

export interface ExtractedLo {
    loans: ClosedWonLoan[]
    lockin_years?: number
    schedule: RateScheduleEntry[]
    bank?: string
    /** The mortgaged property as printed on the LO. */
    property_address?: string
    /** Package perks: free conversion, legal/valuation subsidy, waivers, cash rebate. */
    features: string[]
    /** Free-text description of any subsidy granted (goes to cases.subsidy_provided). */
    subsidy?: string
    /**
     * Clawback end date, ONLY when the LO prints an actual calendar date.
     * Most LOs state a period ("3 years from disbursement") instead, and the
     * disbursement date isn't known at close — deriving one would be inventing
     * a date the agent then has to un-guess. Those land in `subsidy` as text.
     */
    clawback_end_date?: string
    /** Which lane produced this — surfaced to the agent so a vision read is visibly lower-confidence. */
    source: 'pdf-text' | 'vision'
    /** Things the LO didn't state or the model was unsure of. Shown, never acted on. */
    notes: string[]
}

// ─── Prompt ───────────────────────────────────────────────────────────────────
// Money and tenure come back as RAW TOKENS copied from the document; code parses
// them (parseMoney/parseTenureYears below). Same rule as extractPackages.ts,
// where letting the model do the arithmetic is what once turned "3M" into 300k.
function systemInstruction(allowedKinds: ClosedLoanKind[]): string {
    const kindList = allowedKinds.map(k => `"${k}" (${CLOSED_LOAN_LABELS[k]})`).join(', ')
    return `You transcribe a Singapore bank Letter of Offer (LO) into structured loan data for a mortgage broker's CRM.

STRICT RULES:
1. Transcribe ONLY what the document states. Never infer, estimate, complete or average anything. If the LO does not state a figure, OMIT that field entirely — do not guess, and do not substitute a typical or default value. An absent tenure must be absent, never 30.
2. Copy money and tenure as RAW TEXT exactly as printed — "$1,250,000.00", "1,250,000", "S$800,000", "25 years", "300 months". Do NOT convert, round, or do arithmetic. The system parses these.
3. loans — one entry per distinct facility the LO grants. "kind" must be one of: ${kindList}. Choose by how the LO describes the facility (a term/housing loan on the property = the home-loan kind; a cash-out, term-loan-on-equity or overdraft against the property = "equity"). If the LO grants only one facility, return exactly one entry. If you cannot tell which kind a facility is, still return it with your best-supported kind and add a note (rule 11).
   WHERE TO LOOK: the facility figures sit in a particulars/summary block near the start. Every bank words it differently — accept any of these headings: "Particulars of Credit Facilities", "Facility Details", "Loan Details", "The Facility", "Schedule", "Key Terms", or an unlabelled table on page 1.
   The AMOUNT may be labelled: Amount, Loan Amount, Facility Amount, Principal, Credit Limit, Approved Loan Amount.
   The TENURE may be labelled: Tenor, Tenure, Term, Loan Period, Repayment Period, Loan Tenure — all mean the same thing, and may be given in years OR months.
   Take the amount the BANK IS LENDING. Do NOT confuse it with: the property's Purchase Price, its valuation or "Estimated Valuation", CPF sums being released, a minimum-outstanding threshold quoted in a fee-waiver clause (which is often the SAME number as the loan, so read the label not the figure), or the total of several facilities where each is listed separately.
4. lockin_years — the commitment period in whole years. Banks name this differently and MANY NEVER PRINT THE WORDS "LOCK-IN" AT ALL. Accept any of: "Lock-in Period", "Commitment Period", "Prepayment Period", "Redemption Period", "Minimum Period", "Penalty Period". If none of those labels appears, DERIVE it from the period during which redeeming or prepaying the loan attracts a FEE:
   - "a redemption fee of 1.5% flat ... if the Loan is redeemed in full within 2 years from date of first disbursement ('Prepayment Period')" -> 2
   - "prepayment fee ... within 3 years from first disbursement" -> 3
   - "Lock-in Period: 24 months" / "Commitment Period of 2 years" -> 2
   - "No lock-in" / "no redemption penalty" / no such fee anywhere -> 0
   Convert months to whole years (24 months -> 2, 36 -> 3). If several fee periods are stated (e.g. full redemption 2 years, partial prepayment 2 years), they are normally the same period — report it once. These are NOT the lock-in: a CLAWBACK or subsidy-repayment period, the Availability Period, the interest-rate commencement date, the notice period ("2 months' prior written notice"), and the loan tenure itself.
   ONLY report 0 when the document POSITIVELY STATES there is no lock-in / no redemption or prepayment fee. If you were given a partial document — a single page, a screenshot, an excerpt, or anything whose page numbering shows pages you cannot see (e.g. "Page 1 of 15") — and it simply does not mention a lock-in or redemption fee, OMIT lockin_years entirely and add a note. Reporting 0 says "this loan has no lock-in", which is a definite claim; not having seen the clause is not evidence that it is absent.
5. rate_schedule — RETURN ONE ENTRY FOR EVERY YEAR ROW THE LO LISTS, in order, including the fixed ones. This is the field most often got wrong: agents lose the early fixed years because only the floating rows get transcribed. If the rate table shows three year-rows and a thereafter sentence, you must return FOUR entries.
   The table heading varies by bank ("Year of Loan | Applicable Interest Rate", "Interest Rate", "Pricing", "Rate Structure"). So does the row label — accept ALL of these and map them to year numbers:
   - "Year 1" / "Yr 1" / "1st year" / "First Year" -> year 1
   - "Years 1-2" / "Year 1 & 2" / "1st & 2nd year" -> TWO entries, years 1 and 2, same rate
   - "Months 1-24" / "First 24 months" -> TWO entries, years 1 and 2 (12 months = 1 year)
   - "Months 25-36" / "Year 3" -> year 3
   - "Thereafter" / "4th year onwards" / "Subsequent years" / "Remaining tenure" -> { thereafter:true }
   EVERY entry must carry "rate_text": the rate for that row copied EXACTLY as printed. This field is mandatory — never leave it out, and never leave it empty. Also fill "rate" (fixed) or "reference"+"spread" (floating) when you can, but rate_text is what must always be there.
   - "1st year : 1.6% Fixed" -> { year:1, type:"fixed", rate_text:"1.6% Fixed", rate:1.6 }        <- DO NOT SKIP ROWS LIKE THIS, AND DO NOT LEAVE OUT THE RATE
   - "2nd year : 1.6% Fixed" -> { year:2, type:"fixed", rate_text:"1.6% Fixed", rate:1.6 }
   - "3rd year : 0.5% above 3-month Compounded SORA" -> { year:3, type:"floating", rate_text:"0.5% above 3-month Compounded SORA", reference:"3M SORA", spread:0.5 }
   - "Year 1: 2.00% p.a. fixed" -> { year:1, type:"fixed", rate_text:"2.00% p.a. fixed", rate:2.00 }
   - "Years 1-2: 1.50% fixed" -> TWO entries, year 1 and year 2, both rate_text:"1.50% fixed", rate 1.50
   - "Thereafter: 3M SORA + 0.75%" -> { thereafter:true, type:"floating", rate_text:"3M SORA + 0.75%", reference:"3M SORA", spread:0.75 }
   The "thereafter" rate is often NOT a table row but a sentence just under the table, e.g. "Thereafter, interest on the Housing Loan shall be charged at 1% above 3-month Compounded SORA" -> { thereafter:true, type:"floating", reference:"3M Compounded SORA", spread:1.0 }. Include it.
   - "X% above <benchmark>" means spread X over that benchmark — floating, spread:X. A rate written as a plain percentage with the word Fixed is type "fixed" with that rate and NO reference and NO spread.
   - Set "type" to exactly "fixed" or "floating". For a fixed entry, omit reference and spread entirely rather than sending empty or zero values.
   - Normalize benchmarks: "1m"/"1-month SORA" -> "1M SORA", "3m" -> "3M SORA". Keep a combined one as "1M/3M SORA". Keep "Board Rate" / "FD Rate" / "3-month Compounded SORA" as written.
   - A rate is a percentage per annum. Never output a monthly instalment amount as a rate.
6. bank — the issuing bank's name as printed on the LO.
7. property_address — the address of the MORTGAGED PROPERTY, exactly as printed, including block letter, unit number and postal code. An LO typically prints FOUR addresses and only one is correct:
   (a) the bank's own address on the letterhead — NEVER this;
   (b) the borrower's current mailing address, in the addressee block at the top of page 1 — NEVER this, even though it is the most prominent;
   (c) a property being SOLD or redeemed (usually under "Special Conditions", an OTP/SPA condition, or an existing-housing-loan clause) — NEVER this;
   (d) THE ONE YOU WANT — the financed property, which appears in EITHER of two places depending on the bank:
       (d1) a labelled row inside the facility/particulars table, e.g. "Property: 165 Bukit Batok West Avenue 8 #10-236 Singapore 650165" or "Property Address:" / "Subject Property:". Many banks put it here and have no separate security clause at all. If such a labelled row exists, USE IT — it is unambiguous and outranks everything else.
       (d2) otherwise, the SECURITY / MORTGAGE / CHARGE / COLLATERAL clause — headings vary ("Security", "Securities and Collaterals", "Mortgaged Property", "Subject Property", "Property to be Financed", "Property to be Mortgaged"), typically phrased "A First Legal Mortgage over the property at: ..." and defined as (the "Property").
   Note (b) and (d1) can be the SAME address when the borrower already lives in the property being financed — that is fine and expected, not a conflict.
   Take the address from the security clause. Be careful: (b) and (d) are often on the same street and differ only by block letter, unit or postal code (e.g. "989C ... #04-671 ... 643989" vs "989B ... #07-711 ... 642989") — copy digit by digit from the security clause, do not merge the two. Omit if there is no security clause.
8. features — the package's commercially meaningful terms, as SHORT LABELS an agent can scan, not copied sentences. Each entry must be under about 12 words, lead with the thing itself, and include the figure where there is one. Rewrite the clause into a label:
   - "The administrative fee for conversion of the interest rate of the Loan may be waived subject to the following conditions being fulfilled ... request is made after 24 months ... not less than S$200,000 ... only once" -> "Conversion fee waived after 24 months (min S$200k outstanding, once)"
   - "pay the Bank a redemption fee of 1.5% flat on the outstanding Loan amount, if the Loan is redeemed in full within 2 years" -> "Redemption fee 1.5% within 2 years"
   - "a cancellation fee of 1.5% on the amount cancelled prior loan disbursement and/or left undrawn" -> "Cancellation fee 1.5% on undrawn amount"
   - "The Property shall be owner-occupied for the full tenor" -> "Owner-occupation required"
   - "The Borrower is required to have a UOB Current Account / Savings Account / i-Account" -> "Bank account required for instalment debit"
   Cover each distinct term ONCE — if the LO states a fee waiver in one clause and repeats or qualifies it in another, produce a single combined entry, never two overlapping ones. Include: fee waivers, redemption/prepayment/cancellation fees, conversion terms, partial-prepayment limits, insurance and account requirements, cash rebates, owner-occupation. Do NOT include the interest rates, the lock-in, the loan amount or the tenure (each has its own field), and do not include generic legal boilerplate (governing law, indemnities, AML, KYC, assignment, disclosure). Empty array if the LO states none.
9. subsidy — ONE SHORT LINE, AT MOST 25 WORDS. Hard limit: never exceed one sentence, never quote a clause, never transcribe surrounding page text into this field. Give ONLY a subsidy, rebate or reimbursement the BANK ITSELF grants to the borrower (legal fees, valuation, fire insurance, cash rebate), with the amount and the clawback condition: "Cash incentive SGD2,000, clawback if redeemed within 3 years". Everything else about the facilities — balances, refinancing conditions, standard-terms references, drawdown requirements — belongs nowhere in this response. Omit entirely if the bank grants none — most LOs grant none, and reporting one that does not exist is a serious error. These are NOT subsidies, no matter how much they look like one:
   - a borrower DECLARATION about discounts/rebates received from the VENDOR or a third party (typically in the "Acceptance of Offer" pages: "I have not received / have received S$____ in discounts, rebates ... from the vendor") — that is a disclosure the borrower fills in, not something the bank gives;
   - CPF monies being released for the purchase (e.g. "Lump sum of S$321,800", "Legal and stamp fee of S$14,496") — that is the borrower's own CPF, not a bank subsidy;
   - a FEE WAIVER (conversion admin fee waived, redemption fee reduced) — that belongs in features (rule 8), not here;
   - the bank paying its own legal costs.
10. clawback_end_date — ONLY if the LO prints an actual calendar date for the clawback/subsidy repayment period ending, formatted YYYY-MM-DD. If it instead states a PERIOD ("3 years from disbursement", "36 months"), OMIT this field — do not calculate a date. The period wording belongs in "subsidy" (rule 9).
11. notes — short plain-English flags for anything a human should double-check: a figure you could not find, an ambiguous facility type, text that was blurred/cropped/illegible, or more facilities than you could confidently separate. Empty array if the LO was complete and fully clear.
   PARTIAL DOCUMENTS: only flag this when you genuinely received part of an LO — one page, a screenshot, or an excerpt. A footer reading "Page 1 of 11" does NOT mean you were given only page 1: a complete document contains that footer on its first page and "Page 2 of 11", "Page 3 of 11" and so on further down. Before flagging, check whether LATER page markers are present. If they are, or if you found content that lives on later pages (the security clause, the fee schedule, the signature block), the document is COMPLETE — say nothing. Falsely telling an agent that pages are missing sends them looking for a document they already have.
12. If the document is not a Letter of Offer at all (e.g. an ID, a valuation report, a blank page), return empty loans, an empty rate_schedule, and one note saying what it appears to be.

LENGTH LIMITS — the response must stay compact. A field that runs long truncates the whole JSON and the entire extraction is lost, so these are hard caps, not preferences: property_address <= 200 characters; each feature <= 12 words with at most 15 features; subsidy <= 25 words; each note <= 25 words with at most 5 notes; each rate_text <= 20 words. NEVER transcribe raw page text, OCR output, page markers, or whole clauses into any field.

OUTPUT SHAPE — return exactly this structure. Every field below is TOP-LEVEL. Only kind/amount/tenure go inside a "loans" entry; rate_schedule, lockin_years, bank, property_address, features, subsidy, clawback_end_date and notes must NOT be nested inside a loan:
{
  "loans": [ { "kind": "home", "amount": "SGD 454,965.00", "tenure": "324 months" } ],
  "rate_schedule": [
    { "year": 1, "type": "fixed", "rate_text": "Fixed at 1.55% a year", "rate": 1.55 },
    { "thereafter": true, "type": "floating", "rate_text": "1% above 3-month Compounded SORA", "reference": "3M SORA", "spread": 1.0 }
  ],
  "lockin_years": 3,
  "bank": "OCBC Bank",
  "property_address": "178 Lompang Road #12-40 Singapore 670178",
  "features": ["Redemption fee 1.5% within 36 months"],
  "subsidy": "Cash reward SGD 2,000, clawback if redeemed within 36 months",
  "notes": []
}`
}

const USER_PREFIX = 'Transcribe this Letter of Offer per the instructions. Return JSON only.'

// ─── Wall-clock budget ────────────────────────────────────────────────────────
// An agent is watching a spinner, and the route runs under maxDuration=60 on
// Vercel. Both lanes share ONE deadline: without it, per-call timeouts multiply
// out (2 attempts x 2 models x 2 lanes) far past the platform limit, the
// function gets killed mid-flight, and the client gets a platform error instead
// of this module's clean "couldn't read it" — leaving the agent stuck on a
// spinner with no way to fall back to typing it in by hand.
// Both lanes can run on one file (text read, then a vision re-read), so this
// has to cover ~18s of text + ~30s of vision and still land inside the route's
// maxDuration=60.
const TOTAL_BUDGET_MS = 50_000
/** Text lane's share, leaving the rest of the budget for a vision re-read. */
const TEXT_LANE_MS = 18_000
/** Don't start a call that can't plausibly finish. */
const MIN_CALL_MS = 6_000

/**
 * Below this much extracted text, a PDF is treated as scanned rather than
 * text-layered. A real LO runs to thousands of characters; a scanned one often
 * still yields a few hundred from a header, footer or watermark, which is
 * enough to pass a bare `text.trim()` check but nowhere near enough to read.
 */
const MIN_PDF_TEXT_CHARS = 400

/**
 * Most a set of pages can weigh and still be read as pages: Claude refuses a
 * request over 32MB and base64 makes the pages a third bigger. Above this only
 * a PDF's text layer is read (uploads themselves may be up to 25MB a file).
 */
export const VISION_MAX_BYTES = 22 * 1024 * 1024

/** Below this, a "loan amount" is a misread separator, not a mortgage. */
const MIN_PLAUSIBLE_LOAN = 10_000

const msLeft = (deadline: number) => deadline - Date.now()

/** Per-call timeout: whatever's left, capped at `cap`. Null when out of budget. */
function callTimeout(deadline: number, cap: number): number | null {
    const left = msLeft(deadline)
    if (left < MIN_CALL_MS) return null
    return Math.min(cap, left)
}

// ─── Model call ───────────────────────────────────────────────────────────────
// Both lanes: the text lane sends extracted text, the vision lane sends the
// pages themselves. Marked sensitive because an LO is client data.
async function readLo(
    input: { text: string } | { files: LoFile[] },
    system: string,
    deadline: number,
    cap: number,
): Promise<string | null> {
    const timeoutMs = callTimeout(deadline, cap)
    if (timeoutMs == null) return null
    const files = 'files' in input ? input.files : []
    let user = USER_PREFIX
    if ('text' in input) {
        user = `${USER_PREFIX}\n\nLetter of Offer text:\n${input.text.slice(0, 60000)}`
    } else if (files.length > 1) {
        user = `${USER_PREFIX}\n\nThe ${files.length} images above are consecutive pages of ONE Letter of Offer, in order. Read them together as a single document.`
    }
    const { text, failure } = await callClaude({
        label: 'extractLoanOffer',
        system,
        user,
        files,
        // A poor scan can be misread by a digit: the agent must check the amount.
        model: files.length ? CLAUDE_VISION_MODEL : CLAUDE_MODEL,
        // Headroom: a truncated reply loses the whole read, and thinking counts.
        maxTokens: 12000,
        timeoutMs,
        sensitive: true,
    })
    if (failure === 'rate_limited' || failure === 'account') lastFailure = failure
    return text
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/** One uploaded page. Several of these can make up a single Letter of Offer. */
export interface LoFile {
    buffer: Buffer
    mime: string
}

/**
 * Why the last extraction failed, when the reason is actionable.
 *
 * Set by the model call and read by the route, so "busy" or "no credit" is not
 * shown to the agent as an unreadable document.
 */
let lastFailure: LoFailure | null = null
/** too_large: a scan too big to send as pages, and it had no readable text. */
export type LoFailure = 'rate_limited' | 'account' | 'too_large'
export function takeLastFailure(): LoFailure | null {
    const f = lastFailure
    lastFailure = null
    return f
}

/**
 * @param files         the uploaded LO, as one or more pages IN ORDER. Multiple
 *                      images are read together as one document.
 * @param allowedKinds  the loan kinds THIS case type can close (from loanSpecsFor) —
 *                      constraining the enum per-case stops the model picking a
 *                      kind the form has no row for.
 */
export async function extractLoanOffer(
    files: LoFile[],
    allowedKinds: ClosedLoanKind[],
): Promise<ExtractedLo | null> {
    const pages = files.filter(f => f.buffer.length)
    if (!pages.length || !allowedKinds.length) return null
    lastFailure = null
    const system = systemInstruction(allowedKinds)
    const deadline = Date.now() + TOTAL_BUDGET_MS

    // Lane 1 — a SINGLE PDF whose text layer is worth reading. Multi-page
    // uploads skip straight to vision: stitching several files' text together
    // loses the page boundaries the model needs to read them as one document.
    let textLane: ExtractedLo | null = null
    if (pages.length === 1 && pages[0].mime === 'application/pdf') {
        const file = pages[0].buffer
        let text = ''
        try {
            const { PDFParse } = await import('pdf-parse')
            const parser = new PDFParse({ data: file })
            text = (await parser.getText()).text ?? ''
            await parser.destroy()
        } catch (err) {
            // A scanned/encrypted PDF lands here — fall through to vision.
            console.error('[extractLoanOffer] pdf-parse threw:', String(err))
        }
        const trimmed = text.trim()
        console.log(`[extractLoanOffer] pdf-parse extracted ${trimmed.length} chars`)

        // A page of scanned images often still carries a thin text layer (a
        // header, a footer, a watermark). That is not a readable LO, and
        // handing it to a text model just produces a confident empty answer —
        // so treat too-little-text as no text and go straight to vision.
        if (trimmed.length >= MIN_PDF_TEXT_CHARS) {
            // Hold back enough budget that a slow call can't starve the
            // vision lane — otherwise a slow text lane silently becomes the
            // only lane, and a PDF it can't handle has nowhere left to go.
            const raw = await readLo({ text: trimmed }, system, deadline, TEXT_LANE_MS)
            if (raw) logRaw('pdf-text', raw)
            const parsed = raw && safeParse(raw)
            if (parsed) {
                const result = normalize(parsed, allowedKinds, 'pdf-text')
                const score = completeness(result)
                console.log(`[extractLoanOffer] pdf-text lane completeness ${score}/${MAX_COMPLETENESS}`)
                // Only trust the text lane when it read EVERYTHING. Anything
                // less usually means a scanned or table-heavy LO whose text
                // layer came out mangled or out of order — the figures it did
                // find are then just as suspect as the ones it missed, so let
                // vision read the actual page and keep whichever did better.
                if (score === MAX_COMPLETENESS) return result
                console.warn('[extractLoanOffer] incomplete text-lane read; escalating to vision')
                textLane = result
            }
        } else if (trimmed.length) {
            console.warn(`[extractLoanOffer] only ${trimmed.length} chars of text — treating as scanned, using vision`)
        }
    }

    // Lane 2 — images, multi-page uploads, scanned PDFs, and any PDF the text
    // lane read poorly. Pages go to Claude base64-encoded (x1.33) and a request
    // over 32MB is refused, so a bigger upload is read from its text only.
    const pageBytes = pages.reduce((sum, p) => sum + p.buffer.length, 0)
    if (pageBytes > VISION_MAX_BYTES) {
        console.warn(`[extractLoanOffer] ${pageBytes} bytes is too large for the vision lane`)
        if (!textLane) lastFailure = 'too_large'
        return textLane
    }
    const raw = await readLo({ files: pages }, system, deadline, 40_000)
    if (raw) logRaw('vision', raw)
    const parsed = raw && safeParse(raw)
    if (parsed) {
        const result = normalize(parsed, allowedKinds, 'vision')
        const score = completeness(result)
        console.log(`[extractLoanOffer] vision lane completeness ${score}/${MAX_COMPLETENESS}`)
        // Ties go to vision: it read the page as rendered, so on a scan or a
        // layout-heavy LO its figures are the more trustworthy of the two.
        if (!textLane || score >= completeness(textLane)) return result
    }

    // Vision failed or read less than the text lane — fall back rather than
    // showing the agent nothing.
    return textLane
}

/**
 * How much of what the Closed-Won form needs did this read actually produce?
 * Used to decide whether a text-lane result is trustworthy or should be
 * re-read by vision — not shown to the agent.
 */
export const MAX_COMPLETENESS = 5
export function completeness(r: ExtractedLo): number {
    let n = 0
    if (r.loans.some(l => l.amount > 0)) n++
    if (r.loans.some(l => l.tenure > 0)) n++
    if (r.schedule.length > 0) n++
    if (r.lockin_years != null) n++
    if (r.property_address) n++
    return n
}

/**
 * Log what the model actually returned. Without this, a wrong field can't be
 * traced to either the model or this file's normalisation, and diagnosis turns
 * into guesswork. Server-side console only — never shown to the agent.
 */
function logRaw(lane: string, raw: string): void {
    console.log(`[extractLoanOffer] ${lane} raw response:\n${raw.slice(0, 4000)}`)
}

/**
 * Best-effort recovery of JSON that was cut off mid-response.
 *
 * A real HSBC read died this way: the model dumped page text into one field,
 * hit the output cap, and the JSON ended mid-string — so a document it had
 * otherwise read correctly produced a bare "couldn't read this file". Cutting
 * back to the last complete element and closing the open brackets turns a
 * total loss into a partial read the agent can finish by hand.
 *
 * Returns null when the input was NOT truncated (nothing to repair).
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
            // A comma outside a string ends a complete element — the furthest
            // point we can safely rewind to.
            cutAt = i
            openAtCut = [...open]
        }
    }

    if (!open.length && !inString) return null   // complete already
    if (cutAt < 0) return null                   // nothing complete to keep
    return s.slice(0, cutAt) + openAtCut.reverse().join('')
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
            console.warn('[extractLoanOffer] response was truncated; recovered a partial read')
            return json as Record<string, unknown>
        } catch {
            return null
        }
    }
}

// ─── Normalisation ────────────────────────────────────────────────────────────
// Everything below is pure and unit-tested. The model hands over raw tokens and
// loose shapes; code decides what becomes a number.

/**
 * Expand a bare benchmark tenor into the canonical stored form ("3m" -> "3M SORA").
 *
 * The prompt already asks for this, but the prompt is not a guarantee, and
 * cleanReference() only tidies spacing in an already-formed "3M SORA" — it
 * can't expand a bare tenor. A leaked "3m" still *prices* correctly (effectiveRate
 * matches on a substring), but it renders as "3m + 0.35%" where every stored
 * package reads "3M SORA + 0.35%". Cheap to make deterministic here.
 */
export function normalizeBenchmark(raw: string): string {
    let s = raw.trim()
    if (!s) return s

    // "3-month" / "3 months" -> "3M", so a spelled-out tenor matches the
    // stored vocabulary (a real read returned "3-month Compounded SORA").
    s = s.replace(/(\d+)[\s-]*(?:mth|month)s?\b/gi, '$1M')

    // A dual benchmark ("1M/3M SORA") is meaningful — effectiveRate prices it
    // as the lower of the two — so never collapse it to a single tenor.
    const isCombined = /\d+\s*M\s*\/\s*\d+\s*M/i.test(s)

    // Collapse a verbose SORA description to the canonical "<N>M SORA". Banks
    // spell the benchmark out in full — a real Maybank read returned
    // "1-month compounded Singapore Overnight Rate Average (Compounded SORA)",
    // which prices correctly but matches none of the rate editor's options,
    // so the agent sees a benchmark that looks unset.
    if (!isCombined && /sora|overnight rate average/i.test(s)) {
        const tenor = s.match(/\b(\d+)\s*M\b/i)
        if (tenor) return `${tenor[1]}M SORA`
    }

    // Bare tenor with no benchmark named at all: "3m", "3 m", "3-month".
    const bare = s.match(/^(\d+)\s*m$/i)
    if (bare) return `${bare[1]}M SORA`

    // "3M Compounded SORA" -> "3M SORA". This app's SORA figures ARE the
    // compounded series (sora.comp_sora_3m), so the word adds nothing and
    // would stop the value matching the rate editor's benchmark options.
    s = s.replace(/\bcompounded\s+sora\b/gi, 'SORA')

    return cleanReference(s)
}

/** Parse a money token to SGD. "$1,250,000.00" | "1.25M" | "800K" | "800000". */
export function parseMoney(token: unknown): number {
    if (typeof token === 'number') return Number.isFinite(token) && token > 0 ? Math.round(token) : 0
    if (token == null) return 0

    // Strip currency markers ("S$", "SGD", "$") and spaces, keep separators.
    let s = String(token).trim().toLowerCase()
        .replace(/\s/g, '')
        .replace(/^sgd/, '')
        .replace(/^s?\$/, '')

    // Period used as a THOUSANDS separator, not a decimal point. Seen for real
    // on a scanned UOB letter where "S$200,000" came through as "S$200.000" —
    // parseFloat read that as 200.0, i.e. a 1000x under-read landing straight
    // in the commission base. Only treat it this way on the unambiguous
    // pattern: groups of exactly three digits, no comma anywhere.
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

/** A rate/spread the model may hand back as "1.6", 1.6, "1.6%" or "1.6% Fixed". */
function parseRateNumber(v: unknown): number | undefined {
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
    if (v == null) return undefined
    const m = String(v).match(/\d+(?:\.\d+)?/)
    if (!m) return undefined
    const n = parseFloat(m[0])
    return Number.isFinite(n) ? n : undefined
}

/**
 * Parse a tenure token to whole years. LOs state tenure either way — "25 years"
 * or "300 months" — so a bare number is ambiguous. Treat an explicit "month"
 * unit, or a bare number too large to be a plausible tenure in years, as months.
 */
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

/** Exported for tests — the model's raw output is untrusted, so this is where
 *  the real guarantees live. */
/** Fields that belong at the top level of the response. */
const TOP_LEVEL_FIELDS = [
    'rate_schedule', 'lockin_years', 'bank', 'property_address',
    'features', 'subsidy', 'clawback_end_date', 'notes',
] as const

/**
 * Hoist top-level fields that the model wrongly nested inside loans[0].
 *
 * Only the model gets an enforced responseSchema — the model's json_object mode
 * enforces nothing, and on a real OCBC letter it returned the entire payload
 * (schedule, lock-in, address, features, subsidy) tucked inside the single
 * loan entry. Everything outside `loans` read as absent, the schedule was
 * lost, and the read scored 2/5 despite the model having got it all right.
 */
export function hoistNestedFields(o: Record<string, unknown>): Record<string, unknown> {
    const loans = o.loans
    if (!Array.isArray(loans) || loans.length !== 1) return o
    const inner = loans[0]
    if (!inner || typeof inner !== 'object') return o

    const nested = inner as Record<string, unknown>
    const movable = TOP_LEVEL_FIELDS.filter(k => nested[k] !== undefined && o[k] === undefined)
    if (!movable.length) return o

    const out = { ...o }
    for (const k of movable) out[k] = nested[k]
    return out
}

export function normalize(
    raw: Record<string, unknown>,
    allowedKinds: ClosedLoanKind[],
    source: ExtractedLo['source'],
): ExtractedLo {
    const o = hoistNestedFields(raw)
    const notes: string[] = Array.isArray(o.notes)
        ? o.notes.map(n => String(n).trim()).filter(Boolean).slice(0, 8)
        : []

    // ── Loans ──
    const loans: ClosedWonLoan[] = []
    const rawLoans = Array.isArray(o.loans) ? o.loans : []
    for (const l of rawLoans) {
        if (!l || typeof l !== 'object') continue
        const e = l as Record<string, unknown>
        const amount = parseMoney(e.amount)
        const tenure = parseTenureYears(e.tenure)
        // A facility with neither figure carries nothing the form can use.
        if (!amount && !tenure) continue

        const claimed = String(e.kind ?? '').trim() as ClosedLoanKind
        let kind = allowedKinds.includes(claimed) ? claimed : allowedKinds[0]
        // Don't stack two facilities onto one row — the form has one row per kind.
        if (loans.some(x => x.kind === kind)) {
            const free = allowedKinds.find(k => !loans.some(x => x.kind === k))
            if (!free) {
                notes.push(`Extra facility found (${amount ? `$${amount.toLocaleString()}` : 'no amount'}) beyond the loan rows this case type has — add it manually if needed.`)
                continue
            }
            kind = free
        }
        if (!allowedKinds.includes(claimed)) {
            notes.push(`Facility type was unclear — filed as "${CLOSED_LOAN_LABELS[kind]}". Check this.`)
        }
        // No Singapore mortgage is written for four figures. An amount this
        // small means a separator was misread (a scan turning "200,000" into
        // "200.000" did exactly this), and the figure sets the commission
        // base — so say so loudly rather than let it look deliberate.
        if (amount > 0 && amount < MIN_PLAUSIBLE_LOAN) {
            notes.push(`"${CLOSED_LOAN_LABELS[kind]}" came out as $${amount.toLocaleString()}, which is too small for a mortgage — the amount was probably misread. Check it against the LO.`)
        }
        loans.push({ kind, amount, tenure })
    }

    // ── Rate schedule ──
    // Same coercion as extractPackages.ts: infer floating from the data itself,
    // since models sometimes return "SORA"/"Fixed" instead of the enum.
    const rawSchedule = Array.isArray(o.rate_schedule) ? o.rate_schedule : []
    const schedule: RateScheduleEntry[] = []
    for (const s of rawSchedule) {
        if (!s || typeof s !== 'object') continue
        const e = s as Record<string, unknown>
        const t = String(e.type ?? '').toLowerCase()
        const ref = typeof e.reference === 'string' ? e.reference.trim() : ''
        const rateText = typeof e.rate_text === 'string' ? e.rate_text.trim() : ''
        const spreadVal = parseRateNumber(e.spread)
        // the model's responseSchema tends to emit EVERY declared property, so a
        // fixed row arrives carrying `reference: ""` and `spread: 0`. Testing
        // those for mere presence (`!= null`) misclassified fixed years as
        // floating — an explicit "fixed" type must win over empty leftovers.
        // Prefer the declared type; fall back to the printed text when absent.
        const sig = t || rateText.toLowerCase()
        const saysFixed = sig.includes('fix')
        const saysFloating = sig.includes('float') || sig.includes('sora') || sig.includes('board')
            || sig.includes('fd ') || sig.includes('above')
        const isFloating = saysFloating || (!saysFixed && (!!ref || (spreadVal != null && spreadVal > 0)))
        const entry: RateScheduleEntry = { type: isFloating ? 'floating' : 'fixed' }
        if (e.thereafter) {
            entry.thereafter = true
        } else {
            // Keep the model's own year label. Discarding it and renumbering
            // from 1 corrupted a real read: a schedule returned starting at
            // Year 3 was relabelled Year 1, so the client's Year-1 fixed rate
            // was replaced by their Year-3 floating rate.
            const yr = parseRateNumber(e.year)
            if (yr != null && yr >= 1 && yr <= 40) entry.year = Math.round(yr)
        }
        // The percentage printed on the row, recovered from rate_text when the
        // model left the numeric field out. On a real UOB letter the model
        // returned {type:"fixed", year:1} with no rate at all — correct row,
        // no figure — and both fixed years were dropped on the floor.
        const fromText = parseRateNumber(rateText)

        if (isFloating) {
            if (ref) entry.reference = normalizeBenchmark(ref)
            const spread = spreadVal ?? fromText
            if (spread != null) entry.spread = spread
        } else {
            // Accept "1.6", 1.6, "1.6%" or "1.6% Fixed" — a bare Number() on
            // the string forms yields NaN, which silently dropped the two
            // fixed years off a real UOB schedule.
            const rate = parseRateNumber(e.rate) ?? fromText
            // A rate is a p.a. percentage; anything outside this is a misread
            // figure (an instalment amount, a loan size) — drop the row rather
            // than let it reach the amortisation maths.
            if (rate == null || rate <= 0 || rate > 25) continue
            entry.rate = rate
        }
        schedule.push(entry)
    }

    // Keep the model's row order — that is the LO's own order — and only move
    // "thereafter" rows to the end. Sorting by year instead would push an
    // UNLABELLED middle row past a labelled later one (a "Y1 / blank / Y3"
    // schedule came out as years 1, 3, 4).
    const ordered = [...schedule.filter(e => !e.thereafter), ...schedule.filter(e => e.thereafter)]
    // Honour a stated year when it advances the schedule; otherwise continue
    // the sequence. That keeps both properties we need: a genuine "starts at
    // Year 3" read is never relabelled to Year 1, while a duplicated label
    // ("Year 1" twice, a common typo) still gets corrected to 1, 2.
    let last = 0
    for (const e of ordered) {
        if (e.thereafter) { e.year = undefined; continue }
        e.year = e.year != null && e.year > last ? e.year : last + 1
        last = e.year
    }
    schedule.length = 0
    schedule.push(...ordered)

    // ── Text fields ──
    const text = (v: unknown, max: number): string | undefined => {
        const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim()
        return s ? s.slice(0, max) : undefined
    }

    const features: string[] = Array.isArray(o.features)
        ? Array.from(new Set(
            o.features.map(f => text(f, 200)).filter((f): f is string => !!f),
        )).slice(0, 20)
        : []

    // A clawback date lands in a `date` column, so only accept a real calendar
    // date. The prompt forbids deriving one from a period ("3 years from
    // disbursement") because the disbursement date isn't known at close —
    // this is the backstop for when the model does it anyway.
    let clawback_end_date: string | undefined
    const rawClawback = text(o.clawback_end_date, 32)
    if (rawClawback && /^\d{4}-\d{2}-\d{2}$/.test(rawClawback)) {
        const d = new Date(`${rawClawback}T00:00:00Z`)
        const year = d.getUTCFullYear()
        // Reject an unparseable date, and anything outside a plausible window —
        // a clawback runs a few years forward, never into the past or 2140.
        if (!Number.isNaN(d.getTime()) && year >= new Date().getUTCFullYear() && year <= new Date().getUTCFullYear() + 15) {
            clawback_end_date = rawClawback
        } else {
            notes.push(`Ignored an implausible clawback date from the LO ("${rawClawback}") — set it by hand if there is one.`)
        }
    }

    const lockinRaw = Number(o.lockin_years)
    const lockin_years = Number.isFinite(lockinRaw) && lockinRaw >= 0 && lockinRaw <= 10
        ? Math.round(lockinRaw)
        : undefined

    if (!loans.length) notes.push('No loan amount or tenure could be read from this file.')
    if (!schedule.length) notes.push('No rate schedule could be read from this file.')

    return {
        loans,
        lockin_years,
        schedule,
        bank: text(o.bank, 80),
        property_address: text(o.property_address, 300),
        features,
        subsidy: text(o.subsidy, 500),
        clawback_end_date,
        source,
        notes,
    }
}
