import { requireAdminUser } from '@/lib/auth/requireAdmin'

export const dynamic = 'force-dynamic'

/**
 * TEMPORARY — delete once Sentry is confirmed working.
 * Paired with app/admin/sentry-check/page.tsx.
 *
 * Throws on purpose so the SERVER error path can be verified end to end:
 * instrumentation.ts's Sentry.init() reads SENTRY_DSN (not the NEXT_PUBLIC_ one,
 * which is a separate variable for the browser), so a server error proves that
 * specific variable is set correctly in production.
 *
 * Admin-guarded, so it cannot be used by anyone else to generate noise in your
 * Sentry quota.
 */
export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    // Unique per call, so you can match the exact event in Sentry rather than
    // guessing which of several identical errors was yours.
    const marker = Math.random().toString(36).slice(2, 8).toUpperCase()

    throw new Error(`Sentry server-side check [${marker}] — this error is intentional, and safe to resolve.`)
}
