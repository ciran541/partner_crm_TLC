/**
 * Promotion ingestion extractor — turns a bank's pasted partner blast into
 * structured promotion rows via Claude (JSON mode, temperature 0).
 *
 * These messages arrive as WhatsApp/email prose ("Dear Partners, … Loan Size $1m
 * to $1.5m, Cash Rebate $800 … 0.2% agent referral will be extended to 31
 * August"), which is why this is an extractor rather than a form: retyping tiers
 * and conditions by hand is where transcription errors get made.
 *
 * ONE MESSAGE ROUTINELY CONTAINS TWO PROMOTIONS. The SCB blast this was built
 * from carries a cash rebate the CLIENT receives and a referral-fee bump only
 * the AGENT gets. They have different audiences, different end dates, and one of
 * them must never appear in a client-facing document — so the model returns an
 * array and is told explicitly to split them.
 *
 * The model is ONLY a transcriber: it structures text the admin pasted. It must
 * never invent amounts, dates, or conditions. Everything it returns is reviewed
 * and confirmed by a human before it is saved, same gate as rate-sheet ingestion.
 *
 * Returns null on any failure so the caller can surface a clean error.
 */

import type { CaseType } from '@/lib/types/insurance'
import type { ExtractedPromotion, PromotionTier } from '@/lib/types/promotions'
import { PROMO_AUDIENCES, BENEFIT_TYPES, WINDOW_BASES } from '@/lib/types/promotions'
import { callClaude } from '@/lib/ai/claude'

const SYSTEM_INSTRUCTION = `You convert a Singapore bank's promotion message (sent to mortgage broker partners over email or WhatsApp) into STRUCTURED promotion data.

STRICT RULES:
1. Transcribe ONLY what is written. Never invent amounts, dates, conditions, or eligibility rules. If something is not stated, omit it.
2. SPLIT BY AUDIENCE — this is the most important rule. One message often describes two different benefits:
   - a benefit the END CLIENT receives (cash rebate, fee waiver, rate discount) → audience "client"
   - a benefit the AGENT/broker receives (referral fee, commission bump) → audience "agent"
   Return these as SEPARATE objects in the promotions array, each with its own dates and tiers. Never merge them. If a single benefit genuinely goes to both, use "both".
3. benefit_type: "cash_rebate" | "referral_bonus" | "fee_waiver" | "rate_discount" | "other".
4. benefit_tiers — the loan-size bands. Each = { min_loan, max_loan, amount } or { min_loan, max_loan, percent }:
   - "Loan Size $1m to $1.5m → Cash Rebate $800" → { "min_loan": 1000000, "max_loan": 1500000, "amount": 800 }
   - "Loan size above $1.5m → $1200" → { "min_loan": 1500000, "max_loan": null, "amount": 1200 }
   - A percentage benefit ("0.2% referral") → { "min_loan": 0, "max_loan": null, "percent": 0.2 }. percent is percentage POINTS: 0.2 means 0.2%, not 20%.
   - Write loan sizes as FULL NUMBERS (1000000, not "1m"). max_loan null means no upper limit.
   - If the benefit has no loan-size condition at all, use a single tier with min_loan 0 and max_loan null.
   - List tiers in ASCENDING order of min_loan.
5. applies_to — which case types qualify, from exactly: "Purchase", "Refinancing", "Decouple", "Equity Loan". "Applicable for both purchase and refinancing" → ["Purchase","Refinancing"]. If the message does not restrict it, use [].
6. window_basis — WHICH DATE the eligibility window is measured against:
   - "for loan submitted from 3 Aug", "only applicable for loan submit 3 Aug or after" → "submission"
   - "for loans disbursed by...", "disbursement must complete by..." → "disbursement"
   - "for offers accepted by..." → "acceptance"
   Default to "submission" if genuinely unclear.
7. starts_on / ends_on — the eligibility window in YYYY-MM-DD. Bank messages usually give day and month only ("3 to 16 August"); use the year given in "Today's date" below, unless the message clearly refers to a different year. If there is no start date, use null. If the promotion is open-ended, ends_on is null.
8. conditions — the bank's caveats, one per array item, kept close to the original wording (tidy the grammar, do not reinterpret). Include clawback, crediting timelines, resubmission rules, LTV treatment, "on top of normal subsidy" notes. Do NOT put the loan-size tiers here; they belong in benefit_tiers.
9. clawback_years — integer, if a clawback period is stated ("subjected to 3 years clawback" → 3). Otherwise null.
10. affects_ltv — true ONLY if the message says the benefit changes the loan-to-value or purchase-price computation (e.g. "rebate will be nett off purchase price for LTV computation"). Otherwise false.
11. title — a short descriptive name for the promotion, e.g. "National Day Cash Rebate" or "0.2% Agent Referral Extension".

OUTPUT — reply with a single JSON object and nothing else. No prose, no markdown fences. "promotions" must be at the TOP LEVEL. Do not nest it inside another object and do not add fields not listed here:
{
  "promotions": [
    {
      "title": "National Day Cash Rebate",
      "audience": "client",
      "benefit_type": "cash_rebate",
      "benefit_tiers": [
        { "min_loan": 1000000, "max_loan": 1500000, "amount": 800 },
        { "min_loan": 1500000, "max_loan": null, "amount": 1200 }
      ],
      "applies_to": ["Purchase", "Refinancing"],
      "window_basis": "submission",
      "starts_on": "2026-08-03",
      "ends_on": "2026-08-16",
      "conditions": [
        "No resubmission of a loan submitted in the last 1 month, otherwise no referral fee is payable",
        "Cash rebate credited within 1 week of loan disbursement to the client's bank account",
        "On top of the normal subsidy",
        "Rebate is netted off the purchase price for LTV computation"
      ],
      "clawback_years": 3,
      "affects_ltv": true
    }
  ]
}`

const ALLOWED_CASE_TYPES: CaseType[] = ['Purchase', 'Refinancing', 'Decouple', 'Equity Loan']

export async function extractPromotions(text: string, bank: string): Promise<ExtractedPromotion[] | null> {
    if (!text.trim() || !bank.trim()) return null

    const { text: raw } = await callClaude({
        label: 'extractPromotions',
        system: SYSTEM_INSTRUCTION,
        user: `Bank: ${bank}\nToday's date: ${new Date().toISOString().slice(0, 10)}\n\nPaste:\n${text.trim()}`,
        maxTokens: 12000,   // includes thinking
        thinking: 'medium',
        timeoutMs: 55000,
    })
    if (!raw) return null

    try {
        const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
        const parsed = JSON.parse(cleaned)
        // No schema is enforced on this call, so tolerate the array arriving at the top
        // level or under a stray key — a real read elsewhere in this codebase
        // came back nested one level deeper than requested.
        const promotions = Array.isArray(parsed) ? parsed
            : Array.isArray(parsed?.promotions) ? parsed.promotions
                : null
        if (!promotions) {
            console.error('[extractPromotions] response had no promotions array')
            return null
        }
        const out = normalize(promotions, bank)
        return out.length ? out : null
    } catch (err) {
        console.error(`[extractPromotions] parse failed: ${String(err)}`)
        return null
    }
}

/** Coerce + sanitise model output into clean rows for the review screen. */
export function normalize(promotions: unknown, bank: string): ExtractedPromotion[] {
    if (!Array.isArray(promotions)) return []
    const out: ExtractedPromotion[] = []

    for (const p of promotions) {
        if (!p || typeof p !== 'object') continue
        const o = p as Record<string, unknown>

        const tiers = normalizeTiers(o.benefit_tiers)
        const title = typeof o.title === 'string' ? o.title.trim() : ''
        // A row with neither a name nor a benefit is a hallucinated shell, not a
        // promotion an admin can review — drop it rather than show an empty card.
        if (!title && !tiers.length) continue

        out.push({
            bank: bank.trim(),
            title: title || 'Untitled promotion',
            // Default to 'agent' rather than 'client' when the model returns
            // something unrecognised: an agent incentive shown only internally is
            // a harmless miss, whereas mislabelling one as client-facing puts it
            // in front of a client. Fail toward the quieter mistake.
            audience: pick(o.audience, PROMO_AUDIENCES, 'agent'),
            benefit_type: pick(o.benefit_type, BENEFIT_TYPES, 'other'),
            benefit_tiers: tiers,
            applies_to: Array.isArray(o.applies_to)
                ? o.applies_to.filter((c: unknown): c is CaseType => ALLOWED_CASE_TYPES.includes(c as CaseType))
                : [],
            window_basis: pick(o.window_basis, WINDOW_BASES, 'submission'),
            starts_on: isoDate(o.starts_on),
            ends_on: isoDate(o.ends_on),
            conditions: Array.isArray(o.conditions)
                ? o.conditions.map((c: unknown) => String(c).trim()).filter(Boolean)
                : [],
            clawback_years: intOrNull(o.clawback_years),
            affects_ltv: o.affects_ltv === true,
        })
    }

    return out
}

/** Accept a model-supplied string only if it is one of ours, else fall back. */
function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value)
        ? (value as T)
        : fallback
}

/**
 * Tiers drive a dollar figure quoted to a client, so every field is re-derived
 * here rather than trusted: sizes are parsed from whatever token came back
 * ("1.5m", "$1,500,000"), and tiers are sorted ascending so resolveTier()'s
 * first-match rule lands on the lower band at a contested boundary regardless of
 * the order the model happened to emit.
 */
function normalizeTiers(raw: unknown): PromotionTier[] {
    if (!Array.isArray(raw)) return []
    const tiers: PromotionTier[] = []

    for (const t of raw) {
        if (!t || typeof t !== 'object') continue
        const o = t as Record<string, unknown>
        const amount = numOrNull(o.amount)
        const percent = numOrNull(o.percent)
        if (amount == null && percent == null) continue   // a band worth nothing isn't a tier

        const tier: PromotionTier = {
            min_loan: parseSize(o.min_loan) ?? 0,
            max_loan: parseSize(o.max_loan),
        }
        if (amount != null) tier.amount = amount
        else tier.percent = percent!
        tiers.push(tier)
    }

    // An inverted band (max below min) can never match any loan — clear the cap
    // rather than silently drop the tier, so the admin sees it and can correct it.
    for (const t of tiers) {
        if (t.max_loan != null && t.max_loan < t.min_loan) t.max_loan = null
    }

    return tiers.sort((a, b) => a.min_loan - b.min_loan)
}

/** Parse a size token to SGD: 1500000, "1.5m", "$1,500,000", "800K". */
function parseSize(token: unknown): number | null {
    if (token == null || token === '') return null
    if (typeof token === 'number') return Number.isFinite(token) ? Math.round(token) : null
    const s = String(token).replace(/[,$\s]/g, '').toLowerCase()
    const m = s.match(/^([\d.]+)\s*(k|m)?/)
    if (!m) return null
    let n = parseFloat(m[1])
    if (!Number.isFinite(n)) return null
    if (m[2] === 'k') n *= 1_000
    else if (m[2] === 'm') n *= 1_000_000
    return Math.round(n)
}

function numOrNull(v: unknown): number | null {
    if (v == null || v === '') return null
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[%$,\s]/g, ''))
    return Number.isFinite(n) ? n : null
}

function intOrNull(v: unknown): number | null {
    const n = numOrNull(v)
    return n == null ? null : Math.round(n)
}

/** Keep only a well-formed YYYY-MM-DD; anything else becomes null for the admin to fill in. */
function isoDate(v: unknown): string | null {
    if (!v) return null
    const s = String(v).trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
    return Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? null : s
}
