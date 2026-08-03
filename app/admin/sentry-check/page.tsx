'use client'

import { useState } from 'react'
import * as Sentry from '@sentry/nextjs'

/**
 * TEMPORARY — delete this folder and app/api/admin/sentry-check once Sentry is
 * confirmed working. Nothing else references either.
 *
 * Three separate things need proving, because each depends on a different
 * environment variable and any one of them can be missing while the others work:
 *
 *   1. Browser errors  -> NEXT_PUBLIC_SENTRY_DSN (baked into the bundle at BUILD
 *      time, so it must have been set before the deploy, not just now)
 *   2. Server errors   -> SENTRY_DSN (read at runtime by instrumentation.ts)
 *   3. Readable traces -> SENTRY_AUTH_TOKEN (uploads source maps at build time)
 *
 * Run this on the DEPLOYED site, not locally: locally the code is unminified, so
 * a readable stack trace proves nothing about whether source maps uploaded.
 */
export default function SentryCheckPage() {
    const [log, setLog] = useState<string[]>([])
    const say = (m: string) => setLog(l => [...l, `${new Date().toLocaleTimeString()}  ${m}`])

    const marker = () => Math.random().toString(36).slice(2, 8).toUpperCase()

    // 1. An uncaught browser exception — the path a real client-side crash takes.
    const throwClientError = () => {
        const id = marker()
        say(`Throwing browser error [${id}] — look for this ID in Sentry.`)
        setTimeout(() => {
            throw new Error(`Sentry browser check [${id}] — intentional, safe to resolve.`)
        }, 0)
    }

    // 2. A handled capture — confirms the SDK is initialised even if nothing has
    //    crashed yet. If this arrives but the one above does not, the SDK is
    //    fine and something is swallowing uncaught errors.
    const captureMessage = () => {
        const id = marker()
        Sentry.captureMessage(`Sentry manual check [${id}] — intentional.`, 'info')
        say(`Sent captureMessage [${id}].`)
    }

    // 3. A server-side throw, via the API route.
    const throwServerError = async () => {
        say('Calling /api/admin/sentry-check — a 500 here is the expected result.')
        try {
            const res = await fetch('/api/admin/sentry-check')
            say(`Server responded ${res.status} ${res.status === 500 ? '(expected — check Sentry)' : '(unexpected)'}`)
        } catch {
            say('Request failed at the network level — also fine, the throw still reached the server.')
        }
    }

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-[#052d4a]">Sentry check</h1>
                <p className="text-sm text-slate-500 mt-1">
                    Temporary diagnostics page. Run each button on the deployed site, then
                    delete this page and its API route.
                </p>
            </div>

            <div className="card p-5 space-y-3">
                <Row
                    title="1 · Browser error"
                    detail="Proves NEXT_PUBLIC_SENTRY_DSN. The page will show an error overlay — that is the point."
                    label="Throw browser error"
                    onClick={throwClientError}
                />
                <Row
                    title="2 · Manual capture"
                    detail="Proves the browser SDK is initialised, without crashing anything."
                    label="Send test message"
                    onClick={captureMessage}
                />
                <Row
                    title="3 · Server error"
                    detail="Proves SENTRY_DSN. Expect an HTTP 500 — that is success, not failure."
                    label="Throw server error"
                    onClick={throwServerError}
                />
            </div>

            {log.length > 0 && (
                <div className="card p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Log</p>
                    <pre className="text-xs text-slate-600 whitespace-pre-wrap">{log.join('\n')}</pre>
                </div>
            )}

            <div className="card p-4 text-sm text-slate-600 space-y-2" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
                <p className="font-semibold text-amber-800">What a PASS looks like</p>
                <p>Each error appears in Sentry within a minute, carrying the ID shown in the log above.</p>
                <p>
                    For source maps: open the browser error in Sentry and read the stack trace. It should
                    name <code>app/admin/sentry-check/page.tsx</code> and a real line number. If it shows
                    something like <code>page-8a3f.js:1:20481</code>, errors are reporting but source maps
                    are not uploading — check the build log for the Sentry step.
                </p>
            </div>
        </div>
    )
}

function Row({ title, detail, label, onClick }: {
    title: string; detail: string; label: string; onClick: () => void
}) {
    return (
        <div className="flex items-start justify-between gap-4 py-2 border-b border-slate-100 last:border-b-0">
            <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">{title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{detail}</p>
            </div>
            <button onClick={onClick} className="btn-primary btn-sm shrink-0">{label}</button>
        </div>
    )
}
