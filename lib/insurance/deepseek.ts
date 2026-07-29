/**
 * Shared DeepSeek caller — the default AI provider for every text task.
 *
 * DeepSeek is on a paid plan: no daily cap, cheaper per token, and its 429s are
 * per-minute rate limits that recover in under a second. Gemini's free tier
 * meters ~20 requests per day PER MODEL, shared across every feature using the
 * key — which is how the Knowledge Assistant (two Gemini calls per agent
 * question) could exhaust the day's budget in ten questions and leave Letter-of-
 * Offer extraction with nothing.
 *
 * So Gemini is now reserved for the ONE thing DeepSeek cannot do: read pixels
 * (scanned LOs and photos, see extractLoanOffer.ts). Everything text-in /
 * text-out comes through here.
 *
 * Note there is no schema enforcement to lean on: DeepSeek's json mode
 * guarantees only that the output parses, not that it matches a shape. Callers
 * needing a specific structure must describe it in the prompt AND validate what
 * comes back — a real OCBC read returned every top-level field nested inside
 * loans[0] because the prompt did not spell the shape out.
 */

const MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro']
const ENDPOINT = 'https://api.deepseek.com/chat/completions'

export interface DeepSeekOptions {
    system: string
    user: string
    /** Prefixes log lines so a failure is traceable to its feature. */
    label: string
    maxTokens?: number
    temperature?: number
    /** Ask for a JSON object back. The prompt must still describe the shape. */
    json?: boolean
    /** Per-attempt timeout. Ignored where `signal` already carries a deadline. */
    timeoutMs?: number
    /** Caller's own deadline — aborts every remaining attempt when it fires. */
    signal?: AbortSignal
}

/** Returns the raw text, or null if the whole model chain failed. */
export async function callDeepSeek(opts: DeepSeekOptions): Promise<string | null> {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey || !opts.user.trim()) return null

    // json mode is rejected outright (HTTP 400) unless the word "json" appears
    // somewhere in the prompt — a rule that is easy to miss when porting a
    // prompt written for a provider with schema enforcement, and it takes down
    // the whole feature rather than degrading it. Append the instruction rather
    // than fail: callers should say it themselves, but not having said it is
    // never a reason to reject the request.
    let system = opts.system
    if (opts.json && !/json/i.test(`${opts.system} ${opts.user}`)) {
        system += '\n\nReply with a single JSON object and nothing else.'
    }

    const body = JSON.stringify({
        model: MODELS[0],
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: opts.user },
        ],
        temperature: opts.temperature ?? 0,
        max_tokens: opts.maxTokens ?? 4096,
        // Reasoning tokens are invisible but come out of max_tokens, which can
        // truncate a response mid-sentence. Off unless a caller needs it.
        thinking: { type: 'disabled' },
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    })

    for (const model of MODELS) {
        const modelBody = model === MODELS[0]
            ? body
            : body.replace(`"model":"${MODELS[0]}"`, `"model":"${model}"`)
        try {
            let res: Response | null = null
            for (let attempt = 0; attempt < 2; attempt++) {
                if (opts.signal?.aborted) return null
                res = await fetch(ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                    body: modelBody,
                    signal: buildSignal(opts),
                })
                // Unlike Gemini's daily quota, a DeepSeek 429 is a per-minute
                // limit on a paid plan — it genuinely does clear, so retry.
                if (res.ok || (res.status !== 503 && res.status !== 429)) break
                if (attempt === 0) await new Promise(r => setTimeout(r, 800))
            }
            if (!res || !res.ok) {
                const detail = res ? await res.text().catch(() => '') : ''
                console.error(`[${opts.label}] deepseek ${model} HTTP ${res?.status} ${detail.slice(0, 300)}`)
                continue
            }
            const json = await res.json()
            const text = json?.choices?.[0]?.message?.content
            if (typeof text === 'string' && text.trim()) return text.trim()
        } catch (err) {
            if (opts.signal?.aborted) return null   // caller's deadline spent
            console.error(`[${opts.label}] deepseek ${model} threw: ${String(err)}`)
        }
    }
    return null
}

/** The caller's deadline and our per-attempt timeout, whichever fires first. */
function buildSignal(opts: DeepSeekOptions): AbortSignal | undefined {
    const timeout = opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined
    if (opts.signal && timeout) return AbortSignal.any([opts.signal, timeout])
    return opts.signal ?? timeout
}
