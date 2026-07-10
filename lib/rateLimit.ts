import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextResponse } from 'next/server'

let ratelimit: Ratelimit | null | undefined

function getRatelimit(): Ratelimit | null {
    if (ratelimit !== undefined) return ratelimit

    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) {
        console.warn('[rateLimit] UPSTASH_REDIS_REST_URL/TOKEN not set — rate limiting is disabled')
        ratelimit = null
        return ratelimit
    }

    ratelimit = new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.slidingWindow(5, '10 m'),
        prefix: 'ratelimit',
    })
    return ratelimit
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
    const rl = getRatelimit()
    if (!rl) return null

    const { success } = await rl.limit(`${routeKey}:${clientIp(request)}`)
    if (!success) {
        return NextResponse.json({ error: 'Too many requests — please try again later.' }, { status: 429 })
    }
    return null
}
