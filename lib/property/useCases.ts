'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PropertyCase } from '@/lib/types/property'

/**
 * Shared client-side cache for the property agent's case list.
 *
 * Dashboard, Cases and Earnings all render from the SAME `/api/property/cases`
 * data. Instead of each screen fetching independently (a spinner per tab), they
 * subscribe to one module-level store with stale-while-revalidate semantics:
 *
 *  - First consumer triggers a fetch.
 *  - Cached data is returned INSTANTLY on every later mount/navigation.
 *  - A background revalidation runs only when the cache is older than STALE_MS,
 *    so switching tabs is instant and never flashes a spinner once loaded.
 *
 * Call `refreshCases()` after a mutation (e.g. submitting a case) to force-refresh,
 * and `clearCasesCache()` on sign-out so the next user never sees stale data.
 */

export interface PropertyCaseWithRelations extends PropertyCase {
    agent_name?: string | null
}

interface CasesState {
    cases: PropertyCaseWithRelations[]
    isAdmin: boolean
    loading: boolean
    error: string | null
    loaded: boolean
}

const ENDPOINT = '/api/property/cases?limit=100'
const STALE_MS = 30_000

let state: CasesState = { cases: [], isAdmin: false, loading: false, error: null, loaded: false }
let inflight: Promise<void> | null = null
let lastFetched = 0
const listeners = new Set<() => void>()

function emit() {
    listeners.forEach(l => l())
}

function setState(patch: Partial<CasesState>) {
    state = { ...state, ...patch }
    emit()
}

function fetchCases(): Promise<void> {
    if (inflight) return inflight
    // Only show the loading state when we have nothing to display yet —
    // background revalidations must never blank out existing data.
    setState({ loading: !state.loaded, error: null })

    inflight = (async () => {
        try {
            const res = await fetch(ENDPOINT)
            if (!res.ok) throw new Error('Failed to load cases')
            const json = await res.json()
            lastFetched = Date.now()
            setState({
                cases: json.data ?? [],
                isAdmin: json.is_admin ?? false,
                loading: false,
                error: null,
                loaded: true,
            })
        } catch {
            setState({ loading: false, error: 'Failed to load cases. Please refresh.' })
        } finally {
            inflight = null
        }
    })()

    return inflight
}

/** Force a refetch (e.g. after creating/editing a case). */
export function refreshCases(): Promise<void> {
    lastFetched = 0
    return fetchCases()
}

/** Reset the cache so a newly signed-in user never sees the previous user's data. */
export function clearCasesCache() {
    state = { cases: [], isAdmin: false, loading: false, error: null, loaded: false }
    inflight = null
    lastFetched = 0
    emit()
}

export function useCases() {
    const [, forceRender] = useState(0)

    useEffect(() => {
        const listener = () => forceRender(n => n + 1)
        listeners.add(listener)

        const isStale = Date.now() - lastFetched > STALE_MS
        if (!state.loaded || (isStale && !inflight)) {
            fetchCases()
        }

        return () => {
            listeners.delete(listener)
        }
    }, [])

    const refresh = useCallback(() => {
        refreshCases()
    }, [])

    return {
        cases: state.cases,
        isAdmin: state.isAdmin,
        loading: state.loading,
        error: state.error,
        loaded: state.loaded,
        refresh,
    }
}
