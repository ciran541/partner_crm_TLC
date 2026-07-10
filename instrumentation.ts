import * as Sentry from '@sentry/nextjs'

// Runs once when the server starts (Next.js instrumentation hook). Fails
// fast with a clear message listing exactly what's missing, instead of a
// cryptic runtime error the first time some unrelated request happens to
// touch the code path that reads an unset env var.
function validateEnv() {
    const required = [
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'NEXT_PUBLIC_APP_URL',
    ]

    const missing = required.filter(name => !process.env[name])

    // CRON_SECRET fails closed in production only — see lib/auth/requireCron.ts
    if (process.env.NODE_ENV === 'production' && !process.env.CRON_SECRET) {
        missing.push('CRON_SECRET')
    }

    if (missing.length > 0) {
        throw new Error(
            `Missing required environment variable(s): ${missing.join(', ')}. ` +
            `Set them in .env.local (development) or your hosting provider's environment settings (production) before starting the app.`
        )
    }

    const optional = [
        'RESEND_API_KEY', 'RESEND_FROM_EMAIL',
        'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
        'GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'MAS_API_KEY', 'FRED_API_KEY',
    ]
    const missingOptional = optional.filter(name => !process.env[name])
    if (missingOptional.length > 0) {
        console.warn(
            `[startup] Optional environment variable(s) not set — related features will be degraded/disabled: ${missingOptional.join(', ')}`
        )
    }
}

// No-ops gracefully if SENTRY_DSN isn't set (e.g. local dev before a Sentry
// project has been created).
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        validateEnv()
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            tracesSampleRate: 0.1,
        })
    }

    if (process.env.NEXT_RUNTIME === 'edge') {
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            tracesSampleRate: 0.1,
        })
    }
}

export const onRequestError = Sentry.captureRequestError
