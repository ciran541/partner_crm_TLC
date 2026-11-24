/**
 * The ONE place the HUB talks to Claude. Public content (news, banks' published
 * research) goes through freeFirst.ts, which tries free Gemini before this.
 * Don't add a provider call anywhere else.
 *
 * Claude reads text, images and PDFs, so no separate vision provider is needed.
 *
 * JSON: pass `schema` to have the API enforce a shape. Without it, describe the
 * shape in the prompt AND validate what comes back.
 *
 * Never throws: returns { text: null, failure } so callers degrade gracefully.
 */

import Anthropic from '@anthropic-ai/sdk'
import * as Sentry from '@sentry/nextjs'
import { recordUsage } from '@/lib/ai/usage'

/** Default for everything. */
export const CLAUDE_MODEL = 'claude-haiku-5-5'
/**
 * Reads LO scans and photos. Haiku for cost (product decision 2026-11-24).
 * To upgrade just this, set 'claude-sonnet-5-5' here (20x the token price).
 */
export const CLAUDE_VISION_MODEL: string = CLAUDE_MODEL

export type ClaudeFailure =
    | 'not_configured'  // ANTHROPIC_API_KEY missing
    | 'account'         // no credit, bad key, no permission: needs an admin
    | 'rate_limited'    // busy, worth trying again shortly
    | 'failed'          // timeout, network, refusal, empty reply, bad request

export interface ClaudeResult {
    text: string | null
    failure: ClaudeFailure | null
    /** False when the reply was cut off at maxTokens. */
    complete?: boolean
}

/** A document page handed to the model as pixels/PDF rather than as text. */
export interface ClaudeFile {
    buffer: Buffer
    mime: string
}

export interface ClaudeOptions {
    system: string
    user: string
    /** Prefixes log lines so a failure is traceable to its feature. */
    label: string
    model?: string
    /** Sent before `user`, in order. PDF, JPEG, PNG or WebP. */
    files?: ClaudeFile[]
    /** Thinking tokens count towards this too, so leave room when thinking is on. */
    maxTokens?: number
    /** 'off' = no thinking (fastest, for short classify/rewrite calls). */
    thinking?: 'off' | 'low' | 'medium'
    /** JSON schema the reply must match. */
    schema?: Record<string, unknown>
    /** Total time allowed, retries included. */
    timeoutMs?: number
    signal?: AbortSignal
    /** Content holds client data (an LO): log its size, never its text. */
    sensitive?: boolean
}

/**
 * Paid calls happen only on the deployed site. Development and tests can't spend
 * money except for the labels listed in ALLOW_PAID_AI_LOCALLY (owner's rule).
 */
export const isPaidAiBlocked = (label = '') =>
    !process.env.VERCEL && !process.env.VERCEL_ENV && !process.env.AWS_LAMBDA_FUNCTION_NAME && !(label && (process.env.ALLOW_PAID_AI_LOCALLY ?? '').split(',').includes(label))

export const isClaudeConfigured = (label?: string) => !!process.env.ANTHROPIC_API_KEY && !isPaidAiBlocked(label)

let client: Anthropic | null = null

function fileBlock(f: ClaudeFile): Anthropic.ContentBlockParam {
    const data = f.buffer.toString('base64')
    if (f.mime === 'application/pdf') {
        return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    }
    return {
        type: 'image',
        source: { type: 'base64', media_type: f.mime as 'image/jpeg' | 'image/png' | 'image/webp', data },
    }
}

export async function callClaude(opts: ClaudeOptions): Promise<ClaudeResult> {
    if (isPaidAiBlocked(opts.label)) {
        console.log(`[${opts.label}] paid Claude call blocked on this computer`)
        return { text: null, failure: 'not_configured' }
    }
    if (!isClaudeConfigured(opts.label)) return { text: null, failure: 'not_configured' }
    if (!opts.user.trim()) return { text: null, failure: 'failed' }
    client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const files = opts.files ?? []
    // Auditable outbound log: with the one in freeFirst.ts, it lets the
    // Google API data-segregation claim in app/legal/privacy be checked by
    // inspection. Callers pass only admin-authored content, an agent's typed
    // query, or document/article text; never anything from lib/google/*.
    console.log(`[Claude OUTBOUND label=${opts.label}] files=${files.map(f => f.mime).join(',') || 'none'} ` + (opts.sensitive
        ? `user=[${opts.user.length} chars]`
        : `system="${opts.system.slice(0, 300)}" user="${opts.user.slice(0, 800)}"`))

    // One deadline for the whole call: the SDK's own timeout is per attempt, so
    // its retries could otherwise run past the route's maxDuration.
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? 45_000)
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
    const thinking = opts.thinking ?? 'low'
    const model = opts.model ?? CLAUDE_MODEL

    try {
        const res = await client.messages.create({
            model,
            max_tokens: opts.maxTokens ?? 8000,
            system: opts.system,
            messages: [{ role: 'user', content: [...files.map(fileBlock), { type: 'text', text: opts.user }] }],
            thinking: thinking === 'off' ? { type: 'disabled' } : { type: 'adaptive' },
            output_config: {
                effort: thinking === 'off' ? 'low' : thinking,
                ...(opts.schema ? { format: { type: 'json_schema' as const, schema: opts.schema } } : {}),
            },
        }, { signal, maxRetries: 1 })

        // A reply can start with thinking blocks, so pick text by type.
        const text = res.content.flatMap(b => b.type === 'text' ? [b.text] : []).join('').trim()
        const u = res.usage
        const inputTokens = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
        await recordUsage(opts.label, model, inputTokens, u.output_tokens, res.stop_reason === 'refusal' || !text ? 'failed' : null)

        if (res.stop_reason === 'refusal') {
            console.error(`[${opts.label}] claude declined: ${res.stop_details?.category ?? 'unknown'}`)
            return { text: null, failure: 'failed' }
        }
        // Still returned: the LO readers can recover a partial JSON read.
        if (res.stop_reason === 'max_tokens') console.error(`[${opts.label}] claude reply cut off at max_tokens`)

        return text ? { text, failure: null, complete: res.stop_reason === 'end_turn' } : { text: null, failure: 'failed' }
    } catch (err) {
        const failure = reportFailure(err, opts.label)
        // Tokens unknown: a call that timed out may still be billed.
        await recordUsage(opts.label, model, 0, 0, failure)
        return { text: null, failure }
    }
}

function reportFailure(err: unknown, label: string): ClaudeFailure {
    if (err instanceof Anthropic.RateLimitError) {
        console.error(`[${label}] claude rate limited`)
        return 'rate_limited'
    }
    if (err instanceof Anthropic.APIError && err.status) {
        console.error(`[${label}] claude HTTP ${err.status} ${err.message.slice(0, 300)}`)
        // An empty balance once hid every news article for two weeks with
        // nothing but a server log line, so make account problems loud.
        const account = [401, 402, 403].includes(err.status) || /credit balance|billing/i.test(err.message)
        if (account) {
            Sentry.captureMessage(`Claude API account problem (HTTP ${err.status}): check credit and API key`, 'error')
            return 'account'
        }
        return 'failed'
    }
    console.error(`[${label}] claude call failed: ${String(err)}`)
    return 'failed'
}
