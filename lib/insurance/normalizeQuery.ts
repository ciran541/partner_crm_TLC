/**
 * Query normalizer — rewrites a messy agent question into a clean, precise
 * mortgage question before embedding and retrieval.
 *
 * Agents type quickly and often poorly: bad grammar, abbreviations, incomplete
 * sentences. The normalized form embeds much better against clean Q&A titles.
 *
 * Uses the shared Gemini model chain from askGemini.ts — a model name hardcoded
 * here once pointed at gemini-2.0-flash-lite for a month after Google retired
 * it (2026-06-01), silently degrading retrieval on every ask. One hard deadline
 * covers the whole chain so a slow call never delays the main answer; falls
 * back to the original question on any failure.
 */

import { modelChain } from '@/lib/insurance/askGemini'

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
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey || !question.trim()) return question

    // One controller for the whole chain: when the deadline fires, whichever
    // fetch is in flight aborts and any later attempt aborts immediately.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEADLINE_MS)

    const body = JSON.stringify({
        system_instruction: { parts: [{ text: NORMALIZE_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: question.trim() }] }],
        // thinkingBudget: 0 — 2.5-flash models otherwise spend invisible
        // reasoning tokens out of this tiny maxOutputTokens budget (see
        // askGemini.ts / news.ts for the confirmed truncation failure mode).
        generationConfig: { temperature: 0, maxOutputTokens: 80, thinkingConfig: { thinkingBudget: 0 } },
    })

    try {
        for (const model of modelChain()) {
            try {
                const res = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        signal: controller.signal,
                        body,
                    }
                )
                if (!res.ok) {
                    console.error(`[normalizeQuery] ${model} HTTP ${res.status}`)
                    continue   // dead/overloaded model — try the next in the chain
                }
                const json = await res.json()
                const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
                if (text && text.length > 5 && text.length < 250) return text
            } catch {
                if (controller.signal.aborted) break   // deadline spent — stop trying
                // network error on this model — try the next
            }
        }
    } finally {
        clearTimeout(timer)
    }
    return question
}
