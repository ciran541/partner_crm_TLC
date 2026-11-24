/**
 * Free Gemini first, paid Claude only if Gemini can't answer.
 *
 * PUBLIC CONTENT ONLY (news headlines, banks' published research). Google may
 * use free-tier input to improve its products, so nothing typed by an agent, no
 * client document and no partner-only bank message may go through here: those
 * call callClaude() directly.
 */

import { callClaude, type ClaudeFile, type ClaudeOptions } from '@/lib/ai/claude'
import { recordUsage } from '@/lib/ai/usage'

// The free quota is small and counted per model, so the second is a spare.
const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite']

export interface PublicAiOptions extends Pick<ClaudeOptions, 'system' | 'user' | 'label' | 'files' | 'maxTokens' | 'thinking' | 'schema' | 'timeoutMs'> {
    /** Total time Gemini gets before Claude is tried. */
    freeTimeoutMs?: number
    /** Reject an unusable free reply so Claude is tried instead. */
    accept?: (text: string) => boolean
}

export async function callFreeFirst(opts: PublicAiOptions): Promise<string | null> {
    const { freeTimeoutMs = 15_000, accept = () => true, ...rest } = opts
    const free = await callGemini(rest, freeTimeoutMs, accept)
    if (free) return free
    const { text } = await callClaude(rest)
    return text && accept(text) ? text : null
}

async function callGemini(opts: PublicAiOptions, timeoutMs: number, accept: (t: string) => boolean): Promise<string | null> {
    const key = process.env.GEMINI_API_KEY
    if (!key) return null
    const deadline = AbortSignal.timeout(timeoutMs)
    console.log(`[Gemini OUTBOUND label=${opts.label}] files=${opts.files?.length ?? 0} user="${opts.user.slice(0, 800)}"`)
    const body = JSON.stringify({
        system_instruction: { parts: [{ text: opts.system }] },
        contents: [{ role: 'user', parts: [...(opts.files ?? []).map(inline), { text: opts.user }] }],
        generationConfig: {
            temperature: 0,
            maxOutputTokens: opts.maxTokens ?? 8000,
            ...(opts.schema ? { responseMimeType: 'application/json' } : {}),
        },
    })
    for (const model of GEMINI_MODELS) {
        if (deadline.aborted) return null
        let failure = 'failed', input = 0, output = 0, text = ''
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
                body,
                signal: deadline,
            })
            if (res.ok) {
                const json = await res.json()
                const c = json?.candidates?.[0]
                input = json?.usageMetadata?.promptTokenCount ?? 0
                output = (json?.usageMetadata?.candidatesTokenCount ?? 0) + (json?.usageMetadata?.thoughtsTokenCount ?? 0)
                // A cut-off reply is not usable: let the next option answer in full.
                if (c?.finishReason === 'STOP') {
                    text = (c.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? '').join('').trim()
                }
                if (!text || !accept(text)) console.error(`[${opts.label}] ${model} unusable reply (${c?.finishReason})`)
            } else {
                if (res.status === 429) failure = 'rate_limited'
                console.error(`[${opts.label}] ${model} HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`)
            }
        } catch (err) {
            console.error(`[${opts.label}] ${model} failed: ${String(err)}`)
        }
        const ok = !!text && accept(text)
        await recordUsage(opts.label, model, input, output, ok ? null : failure)
        if (ok) return text
    }
    return null
}

const inline = (f: ClaudeFile) => ({ inlineData: { mimeType: f.mime, data: f.buffer.toString('base64') } })
