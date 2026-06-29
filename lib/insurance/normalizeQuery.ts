/**
 * Query normalizer — rewrites a messy agent question into a clean, precise
 * mortgage question before embedding and retrieval.
 *
 * Agents type quickly and often poorly: bad grammar, abbreviations, incomplete
 * sentences. The normalized form embeds much better against clean Q&A titles.
 *
 * Uses gemini-2.0-flash-lite (fastest, cheapest). Hard timeout of 1.5s so a
 * slow call never delays the main answer. Falls back to the original question
 * on any failure.
 */

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

export async function normalizeQuery(question: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey || !question.trim()) return question

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)

    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: NORMALIZE_PROMPT }] },
                    contents: [{ role: 'user', parts: [{ text: question.trim() }] }],
                    generationConfig: { temperature: 0, maxOutputTokens: 80 },
                }),
            }
        )
        if (!res.ok) return question
        const json = await res.json()
        const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
        if (text && text.length > 5 && text.length < 250) return text
    } catch {
        // timeout or network error — fall back silently
    } finally {
        clearTimeout(timer)
    }
    return question
}
