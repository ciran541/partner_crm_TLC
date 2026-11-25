'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { listStatus, type ListEntry, type ListStore } from '@/lib/shared/listStore'

/**
 * Read one list from a list store. `key` is its GET url.
 * `enabled: false` reads without loading: a list another request fills, or one
 * the user has not reached yet.
 */
export function useList<R, M = unknown>(store: ListStore, key: string, { enabled = true }: { enabled?: boolean } = {}) {
    const read = useCallback(() => store.get(key), [store, key])
    const entry = useSyncExternalStore(store.subscribe, read, read) as ListEntry<R, M>

    useEffect(() => (enabled ? store.activate(key) : undefined), [store, key, enabled])

    return {
        status: listStatus(entry),
        rows: entry.page?.rows ?? [],
        total: entry.page?.total ?? null,
        meta: entry.page?.meta,
        hasMore: !!entry.page?.nextCursor,
        loadingMore: entry.loadingMore,
        moreError: entry.moreError,
        /** Rows are on screen but the last refresh failed. */
        outOfDate: !!entry.page && entry.error,
        loadMore: useCallback(() => { void store.loadMore(key) }, [store, key]),
        retry: useCallback(() => store.retry(key), [store, key]),
    }
}
