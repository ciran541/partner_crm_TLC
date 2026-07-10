import * as Sentry from '@sentry/nextjs'

// No-ops gracefully if NEXT_PUBLIC_SENTRY_DSN isn't set (e.g. local dev
// before a Sentry project has been created).
Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
