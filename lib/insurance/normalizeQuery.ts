/**
 * Query normalizer — rewrites a messy agent question into a clean, precise
 * mortgage question before embedding and retrieval.
 *
 * Agents type quickly and often poorly: bad grammar, abbreviations, incomplete
 * sentences. The normalized form embeds much better against clean Q&A titles.
 *
 * Runs on DeepSeek, not Gemini. This is the SECOND of two AI calls an agent's
 * question used to make against Gemini's free tier (~20/day per model, shared
 * with every other feature), so ten questions could exhaust the day and starve
 * Letter-of-Offer extraction — which has no alternative provider, because only
 * Gemini can read a scanned LO. This task is short text in, short text out, so
 * it belongs on the paid, uncapped provider.
 *
 * One hard deadline covers the whole attempt so a slow call never delays the
 * main answer; falls back to the original question on any failure.
 */

import { callDeepSeek } from '@/lib/insurance/deepseek'

const NORMALIZE_PROMPT = `You are a query rewriter for a Singapore mortgage knowledge base used by mortgage agents.

The agent types a quick question — often with bad grammar, abbreviations, or vague phrasing.
Rewrite it into ONE clear, precise English question that captures the most likely intent.

Rules:
- Output ONLY the rewritten question. No explanation, no preamble.
- One sentence only.
- Assume Singapore mortgage context: HDB, private property, CPF, TDSR, MSR, EC, BTO, etc.
- Keep any specific numbers the agent mentioned (age, loan amount, rate, year).
- If the question mentions a property type, keep it.
- If the intent is genuinely unclear, write the most common version of that question.

Examples:
"what longest tenure age 35" → "What is the maximum loan tenure for a borrower aged 35?"
"wat abt the fee" → "What fees are involved in refinancing?"
"can refi incomplete condo" → "Can a client refinance an incomplete condo (BUC property)?"
"tdsr limit" → "What is the TDSR limit?"
"absd 2nd property sc" → "What is the ABSD rate for a Singapore Citizen buying a second property?"`

const DEADLINE_MS = 2000   // total budget across the whole model chain

export async function normalizeQuery(question: string): Promise<string> {
    if (!question.trim()) return question

    // One deadline for the whole attempt: when it fires, the in-flight fetch
    // aborts and any remaining model is skipped. Rewriting is an optimisation,
    // never worth making the agent wait.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEADLINE_MS)

    try {
        const text = await callDeepSeek({
            label: 'normalizeQuery',
            system: NORMALIZE_PROMPT,
            user: question.trim(),
            temperature: 0,
            maxTokens: 80,
            signal: controller.signal,
        })
        // Guard against a model that answers the question instead of rewriting
        // it — a long reply here would poison retrieval.
        if (text && text.length > 5 && text.length < 250) return text
    } catch {
        // fall through to the original question
    } finally {
        clearTimeout(timer)
    }
    return question
}
