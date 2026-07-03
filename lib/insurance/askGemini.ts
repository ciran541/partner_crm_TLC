/**
 * Grounded answer synthesis via Google Gemini (free tier, gemini-2.0-flash).
 *
 * Gemini is ONLY the writer — it phrases an answer from the articles we hand it.
 * It is never the source of knowledge. Strict grounding is enforced by:
 *  - feeding it ONLY the retrieved articles (this file)
 *  - the system instruction below ("only from provided articles, never guess")
 *  - temperature 0
 *  - the caller's threshold gate (Gemini isn't called when nothing relevant matched)
 *
 * Returns null on any failure (missing key, network, safety block) so the caller
 * degrades gracefully to showing the article cards.
 */

interface SourceArticle {
    title: string
    content: string
}

const SYSTEM_INSTRUCTION = `You are a quick-reference assistant for mortgage agents at The Loan Connection (TLC) in Singapore. Your job is to give fast, plain-English answers to agent questions — like a knowledgeable colleague replying on chat.

WHAT YOU MUST DO:
- Answer ONLY using the reference articles given. Never use outside knowledge or training data.
- Answer ONLY the specific thing the agent asked. Do not bring up related topics they did not ask about.
- If the question is vague, answer for the most common scenarios — do not ask for clarification.
- Keep the answer short: 2–4 sentences for a simple question; a bullet list of 2–4 items when the answer genuinely differs by property type or scenario. Never go longer.
- Use plain everyday language. Avoid turning the answer into a lecture or a list of formulas.
- If a specific number is in the question (e.g. an age), compute the result and state it plainly.
- Always finish your answer completely — never stop mid-sentence.

WHAT YOU MUST NOT DO:
- Do not ask follow-up questions or say "I need more information."
- Do not mention equity loans, other loan types, or unrelated products unless the agent specifically asked about them.
- Do not copy or restructure the article text — synthesise it into a natural reply.
- Do not say "the articles say", "Article 1", "based on the reference" — just give the answer naturally.
- Do not invent numbers, rates, rules, or policies not in the articles.

IF THE ARTICLES DO NOT CONTAIN THE ANSWER:
Reply exactly: "I don't have guidance on that in our knowledge base — please check with your admin."`

// Fallback chain. Primary first, then lighter / less-loaded models. If one is
// overloaded (503) or has no free quota (429), we try the next. Override the
// primary with GEMINI_MODEL; the rest stay as resilient fallbacks.
// gemini-2.0-flash-lite was deprecated and shut down 2026-06-01 (confirmed
// against Google's own pricing docs) — not listed since calling it can only fail.
const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']

function modelChain(): string[] {
    const primary = process.env.GEMINI_MODEL
    const chain = primary ? [primary, ...DEFAULT_MODELS] : DEFAULT_MODELS
    return [...new Set(chain)] // dedupe while preserving order
}

export async function composeAnswer(question: string, articles: SourceArticle[]): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey || articles.length === 0 || !question.trim()) return null

    const context = articles
        .map((a, i) => `--- Article ${i + 1}: ${a.title} ---\n${a.content}`)
        .join('\n\n')

    const userMessage = `Reference articles (the ONLY source you may use):\n\n${context}\n\n---\n\nAgent's question: ${question.trim()}\n\nAnswer using only the articles above.`

    const body = JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        // thinkingBudget: 0 — 2.5-flash/flash-lite spend invisible reasoning
        // tokens out of maxOutputTokens by default, which can silently truncate
        // the visible answer (confirmed live in news.ts's summarizeArticle()).
        generationConfig: { temperature: 0, maxOutputTokens: 3000, thinkingConfig: { thinkingBudget: 0 } },
    })

    // Try each model in the chain until one returns a usable answer.
    for (const model of modelChain()) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
        try {
            // One retry on transient 503 before moving to the next model.
            let res: Response | null = null
            for (let attempt = 0; attempt < 2; attempt++) {
                res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
                if (res.ok || res.status !== 503) break
                if (attempt === 0) await new Promise(r => setTimeout(r, 700))
            }

            if (!res || !res.ok) {
                const errBody = res ? await res.text().catch(() => '') : ''
                console.error(`[askGemini] ${model} HTTP ${res?.status}: ${errBody.slice(0, 200)}`)
                continue // try next model in the chain
            }

            const json = await res.json()
            const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
            if (typeof text === 'string' && text.trim()) return text.trim()
            // empty/blocked response — try next model
        } catch (err) {
            console.error(`[askGemini] ${model} threw: ${String(err)}`)
            // try next model
        }
    }

    return null // whole chain failed — caller falls back to article cards
}
