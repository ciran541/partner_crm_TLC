/**
 * Grounded answer synthesis (Claude).
 *
 * The model is ONLY the writer — it phrases an answer from the articles we hand
 * it. It is never the source of knowledge. Strict grounding is enforced by:
 *  - feeding it ONLY the retrieved articles (this file)
 *  - the system instruction below ("only from provided articles, never guess")
 *  - the caller's threshold gate (not called when nothing relevant matched)
 *
 * Returns null on any failure (missing key, network, safety block) so the caller
 * degrades gracefully to showing the article cards.
 */

import { callClaude, CLAUDE_MODEL } from '@/lib/ai/claude'
import { answerKey, getSavedAnswer, saveAnswer } from '@/lib/insurance/answerCache'

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
- You are speaking TO the agent ABOUT their client. Say "the borrower's age" or "the client's age" — never "your age" or "you". Agents often paste these answers to clients, and second person makes the answer read as if it is addressed to the borrower.
- When several articles cover DIFFERENT scenarios (HDB vs private, citizen vs PR, purchase vs refinance), keep each one's figures with its own scenario. Never merge two articles' formulas into a single rule that sounds universal: if one article gives a cap and the other gives a different one, say which applies to which. State a rule as shared ONLY when the articles genuinely both state it.

WHAT YOU MUST NOT DO:
- Do not ask follow-up questions or say "I need more information."
- Do not mention equity loans, other loan types, or unrelated products unless the agent specifically asked about them.
- Do not copy or restructure the article text — synthesise it into a natural reply.
- Do not say "the articles say", "Article 1", "based on the reference" — just give the answer naturally.
- Do not invent numbers, rates, rules, or policies not in the articles.

IF THE ARTICLES DO NOT CONTAIN THE ANSWER:
Reply exactly: "I don't have guidance on that in our knowledge base — please check with your admin."`

export async function composeAnswer(question: string, articles: SourceArticle[]): Promise<string | null> {
    if (articles.length === 0 || !question.trim()) return null

    const key = answerKey(question, articles, SYSTEM_INSTRUCTION, CLAUDE_MODEL)
    const saved = await getSavedAnswer(key)
    if (saved) return saved

    const context = articles
        .map((a, i) => `--- Article ${i + 1}: ${a.title} ---\n${a.content}`)
        .join('\n\n')

    const { text, complete } = await callClaude({
        label: 'askKnowledge',
        system: SYSTEM_INSTRUCTION,
        user: `Reference articles (the ONLY source you may use):\n\n${context}\n\n---\n\nAgent's question: ${question.trim()}\n\nAnswer using only the articles above.`,
        maxTokens: 3000,
        // An agent is waiting on this in the UI — don't let a slow model hang
        // the request when the caller can degrade to article cards instead.
        timeoutMs: 25000,
    })
    if (text && complete) await saveAnswer(key, text)
    return text
}
