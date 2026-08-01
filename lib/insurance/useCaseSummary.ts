'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { EMPTY_CASE_SUMMARY, type CaseSummary } from '@/lib/types/caseSummary'

/**
 * Dashboard aggregates, computed server-side.
 *
 * Same caching discipline as usePagedCases: a module-level cache keyed by scope
 * so navigating away and back costs nothing, stale-while-revalidate so the
 * screen never blanks on a refresh, and a listener set so a mutation elsewhere
 * in the app can force every mounted dashboard to recompute.
 *
 * Aggregates are cached LONGER than list rows (two minutes vs thirty seconds):
 * a revenue total does not meaningfully change between two glances at it, and
 * any real change arrives immediately through invalidateCaseSummary() anyway.
 */

interface SummaryState {
    summary: CaseSummary
    isAdmin: boolean
    fetchedAt: number
}

const STALE_MS = 120_000

const cache = new Map<string, SummaryState>()
const listeners = new Set<() => void>()

/** Reset on sign-out so the next user never sees the previous user's totals. */
export function clearCaseSummaryCache() {
    cache.clear()
}

/** Drop cached totals and make mounted dashboards recompute. */
export function invalidateCaseSummary() {
    cache.clear()
    listeners.forEach(l => l())
}

export function useCaseSummary(options?: { agent?: string }) {
    const agent = options?.agent ?? ''
    const key = agent

    const [, forceRender] = useState(0)
    const rerender = useCallback(() => forceRender(n => n + 1), [])

    const [loading, setLoading] = useState(!cache.has(key))
    const [error, setError] = useState<string | null>(null)

    const activeKey = useRef(key)
    const abortRef = useRef<AbortController | null>(null)

    const fetchSummary = useCallback(async (k: string) => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        setLoading(!cache.has(k))
        setError(null)

        try {
            const qs = k ? `?agent=${encodeURIComponent(k)}` : ''
            const res = await fetch(`/api/insurance/cases/summary${qs}`, { signal: controller.signal })
            if (!res.ok) throw new Error(`Request failed (${res.status})`)
            const body = await res.json()

            // The scope moved on while this was in flight — discard it.
            if (activeKey.current !== k) return

            cache.set(k, {
                summary: (body.summary ?? EMPTY_CASE_SUMMARY) as CaseSummary,
                isAdmin: !!body.isAdmin,
                fetchedAt: Date.now(),
            })
            rerender()
        } catch (err) {
            if ((err as Error)?.name === 'AbortError') return
            if (activeKey.current !== k) return
            setError('Could not load summary. Please try again.')
        } finally {
            if (activeKey.current === k) setLoading(false)
        }
    }, [rerender])

    useEffect(() => {
        activeKey.current = key
        const cached = cache.get(key)

        if (!cached) {
            fetchSummary(key)
            return
        }
        setLoading(false)
        if (Date.now() - cached.fetchedAt > STALE_MS) fetchSummary(key)
    }, [key, fetchSummary])

    useEffect(() => {
        const listener = () => fetchSummary(activeKey.current)
        listeners.add(listener)
        return () => { listeners.delete(listener) }
    }, [fetchSummary])

    const current = cache.get(key)

    // Keep the last resolved totals visible while a new scope loads, so the
    // dashboard dims rather than flashing zeros.
    const lastGood = useRef<SummaryState | null>(null)
    if (current) lastGood.current = current
    const displayed = current ?? lastGood.current

    return {
        summary: displayed?.summary ?? EMPTY_CASE_SUMMARY,
        isAdmin: displayed?.isAdmin ?? false,
        /** True only on a cold load, when there is nothing to show. */
        loading: loading && !displayed,
        /** True while a new scope loads over existing totals; dim, don't blank. */
        refreshing: loading && !!displayed && !current,
        error,
        refresh: useCallback(() => {
            cache.delete(activeKey.current)
            fetchSummary(activeKey.current)
        }, [fetchSummary]),
    }
}
