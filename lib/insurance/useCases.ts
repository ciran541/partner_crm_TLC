'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { isAdmin as isAdminRole } from '@/lib/permissions'
import type { Case } from '@/lib/types'
import type { UserRole } from '@/lib/types/shared'

/**
 * Shared client-side cache for the insurance agent's case list.
 *
 * Dashboard, Cases and the Lock-in screen all render from the SAME `cases`
 * query. Instead of each screen fetching independently (a spinner per tab,
 * redundant network round-trips), they subscribe to one module-level store
 * with stale-while-revalidate semantics:
 *
 *  - First consumer triggers a fetch.
 *  - Cached data is returned INSTANTLY on every later mount/navigation.
 *  - A background revalidation runs only when the cache is older than STALE_MS,
 *    so switching tabs is instant and never flashes a spinner once loaded.
 *
 * Call `refreshCases()` after a mutation (creating/editing a case) to force a
 * refresh, and `clearCasesCache()` on sign-out so the next user never sees the
 * previous user's data.
 *
 * Mirrors lib/property/useCases.ts — the only difference is that insurance has
 * no `/api/insurance/cases` route, so we query supabase directly here.
 */

interface CasesState {
    cases: Case[]
    isAdmin: boolean
    loading: boolean
    error: string | null
    loaded: boolean
}

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
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error('Not authenticated')

            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single()

            // Every column EXCEPT workflow_data — the per-case workflow JSONB blob
            // can be tens of KB and no list screen reads it (the case detail page
            // fetches its own row with select('*')). With select('*') an admin's
            // case list was downloading every workflow of every case in the
            // company on each 30s revalidation. If you add a cases column that a
            // list screen needs, add it here too.
            const LIST_COLUMNS =
                'id, created_by, stage, case_type, client_name, client_mobile, client_email, ' +
                'loan_size, property_type, property_price, current_bank, existing_loan_amount, ' +
                'lock_in_end_date, closed_package_details, closed_interest_rate, closed_tenure, ' +
                'subsidy_provided, clawback_end_date, remarks, created_at, updated_at, ' +
                'closed_lost_reason, closed_lost_notes, follow_up_date, referred_bankers, ' +
                'closed_won_data, commission_status'

            const { data, error } = await supabase
                .from('cases')
                .select(`${LIST_COLUMNS}, profiles ( id, name, role )`)
                .order('updated_at', { ascending: false })

            if (error) throw error

            lastFetched = Date.now()
            setState({
                cases: (data as unknown as Case[]) ?? [],
                isAdmin: isAdminRole((profile?.role ?? 'agent') as UserRole),
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
