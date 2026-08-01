import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextResponse } from 'next/server'

/**
 * Named limits. Each tier gets its own Ratelimit instance because the window
 * is fixed at construction time.
 *
 *  auth  — unauthenticated endpoints (signup, password reset). Deliberately
 *          tight; these are abuse targets and a real person hits them once.
 *  ai    — authenticated endpoints that spend money per call (LLM). Loose
 *          enough that no honest agent will notice, tight enough that a runaway
 *          client loop or a script can't run up a bill unbounded.
 *  heavy — authenticated endpoints that burn serious compute per call
 *          (compare-pdf launches chromium, ~1GB and multiple seconds).
 */
const TIERS = {
    auth: { tokens: 5, window: '10 m' },
    ai: { tokens: 30, window: '1 h' },
    heavy: { tokens: 20, window: '1 h' },
} as const

export type RateLimitTier = keyof typeof TIERS

const instances = new Map<RateLimitTier, Ratelimit | null>()
let redis: Redis | null | undefined

function getRedis(): Redis | null {
    if (redis !== undefined) return redis

    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) {
        console.warn('[rateLimit] UPSTASH_REDIS_REST_URL/TOKEN not set — rate limiting is disabled')
        redis = null
        return redis
    }
    redis = new Redis({ url, token })
    return redis
}

function getRatelimit(tier: RateLimitTier = 'auth'): Ratelimit | null {
    const cached = instances.get(tier)
    if (cached !== undefined) return cached

    const client = getRedis()
    if (!client) {
        instances.set(tier, null)
        return null
    }

    const { tokens, window } = TIERS[tier]
    const instance = new Ratelimit({
        redis: client,
        limiter: Ratelimit.slidingWindow(tokens, window),
        prefix: `ratelimit:${tier}`,
    })
    instances.set(tier, instance)
    return instance
}

function tooMany(reset: number): NextResponse {
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
    return NextResponse.json(
        { error: 'Too many requests — please try again later.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
}

function clientIp(request: Request): string {
    const forwarded = request.headers.get('x-forwarded-for')
    return forwarded?.split(',')[0]?.trim() ?? 'unknown'
}

/**
 * Sliding-window rate limit keyed by route + client IP. No-ops (always
 * allows) if Upstash isn't configured — better to run unprotected than to
 * hard-fail every request when the env vars are missing.
 *
 * Usage in an API route:
 *   const limited = await rateLimitOrResponse(request, 'insurance-signup')
 *   if (limited) return limited
 */
export async function rateLimitOrResponse(request: Request, routeKey: string): Promise<NextResponse | null> {
    const rl = getRatelimit('auth')
    if (!rl) return null

    const { success, reset } = await rl.limit(`${routeKey}:${clientIp(request)}`)
    return success ? null : tooMany(reset)
}

/**
 * Sliding-window rate limit keyed by route + USER id, for routes that have
 * already authenticated the caller.
 *
 * Keyed by user rather than IP on purpose: agents in one office share a public
 * IP, so an IP-keyed limit on an authenticated route would have them consuming
 * each other's budget and locking one another out — a support ticket that looks
 * like a random bug. The user id is also the thing whose cost you actually care
 * about bounding.
 *
 * No-ops (always allows) if Upstash isn't configured, same as the IP variant.
 *
 *   const limited = await rateLimitUser(user.id, 'knowledge-ask', 'ai')
 *   if (limited) return limited
 */
export async function rateLimitUser(
    userId: string,
    routeKey: string,
    tier: RateLimitTier = 'ai',
): Promise<NextResponse | null> {
    const rl = getRatelimit(tier)
    if (!rl) return null

    const { success, reset } = await rl.limit(`${routeKey}:${userId}`)
    return success ? null : tooMany(reset)
}
