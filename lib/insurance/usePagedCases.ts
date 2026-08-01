'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
    buildCaseParams,
    caseQueryKey,
    type CaseQuery,
    type CaseListRow,
} from '@/lib/insurance/caseQuery'

// Re-exported so screens keep importing their row/query types from the hook
// they already use, rather than needing to know about the split.
export type { CaseQuery, CaseListRow }

/**
 * Server-side paged case list.
 *
 * Replaces the whole-table download in useCases.ts for LIST screens. The server
 * decides which rows match and does the arithmetic; the browser only renders a
 * page of them.
 *
 * The point of this hook is that moving work to the server must not cost the
 * instant feel of the old store, so:
 *
 *  - Results are cached per query (module-level, so they survive navigation).
 *    Any filter, search or page you have already seen renders with no network.
 *  - Stale-while-revalidate: a cached result shows immediately and refreshes in
 *    the background. The screen never blanks.
 *  - Previous rows stay on screen while a new query loads, so there is no
 *    spinner flash and no layout jump — the caller dims the list instead.
 *  - Search is debounced, so typing fires one request when you stop, not one
 *    per keystroke.
 *  - "Load more" APPENDS, so scroll position is preserved.
 *
 * The only interaction that touches the network in a way you can feel is a
 * query you have never run before — roughly one round trip, and it does not
 * grow as the table grows.
 */

interface PageState {
    rows: CaseListRow[]
    total: number
    loanVolume: number
    nextCursor: string | null
    isAdmin: boolean
    fetchedAt: number
}

const STALE_MS = 30_000
const DEBOUNCE_MS = 250

/** Module-level so switching screens and coming back costs nothing. */
const cache = new Map<string, PageState>()

/** Mounted hooks, so an invalidation can make them refetch immediately. */
const listeners = new Set<() => void>()

/** Reset on sign-out so the next user never sees the previous user's data. */
export function clearPagedCasesCache() {
    cache.clear()
}

/**
 * Drop every cached query and make mounted screens refetch.
 *
 * Call after a mutation that could change which cases match a query — clearing
 * the cache alone is not enough, because a mounted screen holds its rows in the
 * module cache and would happily keep rendering the stale copy until something
 * else caused it to re-run.
 */
export function invalidatePagedCases() {
    cache.clear()
    listeners.forEach(l => l())
}

/** Debounce a rapidly-changing value (the search box) without lagging the input
 *  itself — the field stays controlled by the caller and updates instantly. */
export function useDebouncedValue<T>(value: T, delay = DEBOUNCE_MS): T {
    const [debounced, setDebounced] = useState(value)
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), delay)
        return () => clearTimeout(t)
    }, [value, delay])
    return debounced
}

/**
 * @param options.enabled  Set false to hold off entirely — for a search box that
 *   should query nothing until something is typed. Cached results stay readable
 *   while disabled; only the request is suppressed.
 */
export function usePagedCases(query: CaseQuery, options?: { enabled?: boolean }) {
    const enabled = options?.enabled ?? true

    // Only the free-text box needs debouncing; dropdowns and date pickers should
    // respond immediately, so they are not routed through it.
    const debouncedSearch = useDebouncedValue(query.search ?? '')
    const effective: CaseQuery = { ...query, search: debouncedSearch }
    const key = caseQueryKey(effective)

    const [, forceRender] = useState(0)
    const rerender = useCallback(() => forceRender(n => n + 1), [])

    const [loading, setLoading] = useState(!cache.has(key))
    const [loadingMore, setLoadingMore] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Identifies the query a response belongs to. A slow response for an
    // abandoned query must never overwrite the current one.
    const activeKey = useRef(key)
    const abortRef = useRef<AbortController | null>(null)

    const fetchPage = useCallback(
        async (q: CaseQuery, k: string, cursor: string | null, mode: 'replace' | 'append') => {
            abortRef.current?.abort()
            const controller = new AbortController()
            abortRef.current = controller

            if (mode === 'append') setLoadingMore(true)
            else setLoading(!cache.has(k))
            setError(null)

            try {
                const res = await fetch(`/api/insurance/cases?${buildCaseParams(q, cursor)}`, {
                    signal: controller.signal,
                })
                if (!res.ok) throw new Error(`Request failed (${res.status})`)
                const body = await res.json()

                // The query moved on while this was in flight — discard it.
                if (activeKey.current !== k) return

                const previous = mode === 'append' ? cache.get(k)?.rows ?? [] : []
                cache.set(k, {
                    rows: [...previous, ...((body.rows ?? []) as CaseListRow[])],
                    total: body.total ?? 0,
                    loanVolume: body.loanVolume ?? 0,
                    nextCursor: body.nextCursor ?? null,
                    isAdmin: !!body.isAdmin,
                    fetchedAt: Date.now(),
                })
                rerender()
            } catch (err) {
                if ((err as Error)?.name === 'AbortError') return
                if (activeKey.current !== k) return
                setError('Could not load cases. Please try again.')
            } finally {
                if (activeKey.current === k) {
                    setLoading(false)
                    setLoadingMore(false)
                }
            }
        },
        [rerender],
    )

    useEffect(() => {
        activeKey.current = key

        if (!enabled) {
            // Nothing to wait for — clear the cold-load flag so the caller shows
            // its idle state rather than a spinner that never resolves.
            setLoading(false)
            return
        }

        const cached = cache.get(key)

        if (!cached) {
            fetchPage(effective, key, null, 'replace')
            return
        }
        // Cached: render instantly, and only revalidate if it has gone stale.
        setLoading(false)
        if (Date.now() - cached.fetchedAt > STALE_MS) {
            fetchPage(effective, key, null, 'replace')
        }
        // `effective` is derived from `key`; depending on the object identity
        // would refire this on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, fetchPage, enabled])

    // Held in a ref so the invalidation listener below always fetches the
    // CURRENT query rather than whichever one was active when it was registered.
    const queryRef = useRef(effective)
    queryRef.current = effective

    useEffect(() => {
        if (!enabled) return
        const listener = () => fetchPage(queryRef.current, activeKey.current, null, 'replace')
        listeners.add(listener)
        return () => { listeners.delete(listener) }
    }, [fetchPage, enabled])

    const current = cache.get(key)

    // A brand-new query has no cache entry, so `current` is undefined while it
    // loads. Rendering that directly would empty the list and flash a skeleton on
    // every new search — the exact jump this hook exists to avoid. Hold the last
    // result that did resolve and keep showing it (dimmed by the caller) until
    // the new one lands.
    const lastGood = useRef<PageState | null>(null)
    if (current) lastGood.current = current
    const displayed = current ?? lastGood.current

    const loadMore = useCallback(() => {
        const page = cache.get(activeKey.current)
        if (!page?.nextCursor || loadingMore) return
        fetchPage(effective, activeKey.current, page.nextCursor, 'append')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchPage, loadingMore, key])

    const refresh = useCallback(() => {
        cache.delete(key)
        fetchPage(effective, key, null, 'replace')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchPage, key])

    return {
        rows: displayed?.rows ?? [],
        /** Rows matching the filters server-side — may exceed rows.length. */
        total: displayed?.total ?? 0,
        /** Loan volume across ALL matching rows, not just the loaded page. */
        loanVolume: displayed?.loanVolume ?? 0,
        isAdmin: displayed?.isAdmin ?? false,
        // Paging must follow the LIVE query, not the stale rows still on screen —
        // otherwise "Load more" during a pending search would append the previous
        // query's next page.
        hasMore: !!current?.nextCursor,
        /** True only on a genuinely cold load, when there is nothing to show. */
        loading: loading && !displayed,
        /** True while a new query loads over existing rows; dim, don't blank. */
        refreshing: loading && !!displayed && !current,
        loadingMore,
        error,
        loadMore,
        refresh,
    }
}
