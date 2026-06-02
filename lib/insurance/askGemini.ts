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

const SYSTEM_INSTRUCTION = `You are a mortgage knowledge assistant for insurance agents at The Loan Connection (TLC) in Singapore.

STRICT RULES — follow exactly:
1. Answer ONLY using the reference articles provided in the user message. Do NOT use any outside knowledge, training data, or assumptions.
2. If the provided articles do not contain the answer, reply exactly: "I don't have guidance on that in our knowledge base — please check with your admin." Do not attempt a partial or guessed answer.
3. Never invent figures, rates, rules, dates, or policies. Only state what the articles say.
4. Be concise and direct — 2 to 4 sentences. Write for a busy agent, plain and practical.
5. Do not mention "the articles" or "the reference" in your answer — just give the guidance naturally.`

// Fallback chain. Primary first, then lighter / less-loaded models. If one is
// overloaded (503) or has no free quota (429), we try the next. Override the
// primary with GEMINI_MODEL; the rest stay as resilient fallbacks.
const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite']

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
        generationConfig: { temperature: 0, maxOutputTokens: 500 },
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
