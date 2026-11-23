'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NewsArticle } from '@/lib/types/news'

/**
 * Loads a paged news endpoint ({ data, total }) one page at a time — first page
 * on mount / whenever `filters` change, more on loadMore(). Used by both the
 * agent feed and the admin console so they page the same way.
 *
 * Every request carries a sequence number and a response is dropped if a newer
 * one has started since — otherwise switching source chips quickly can let the
 * slower, older response land last and show the wrong source's articles.
 */
export function usePagedNews(endpoint: string, filters: Record<string, string | undefined>, pageSize: number) {
    const [rows, setRows] = useState<NewsArticle[]>([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const seq = useRef(0)

    // Stable key so a new-but-equal filters object doesn't refetch every render.
    const filterKey = JSON.stringify(filters)

    const fetchPage = useCallback(async (offset: number) => {
        const params = new URLSearchParams({ offset: String(offset), limit: String(pageSize) })
        for (const [k, v] of Object.entries(JSON.parse(filterKey) as Record<string, string | undefined>)) {
            if (v) params.set(k, v)
        }
        const res = await fetch(`${endpoint}?${params}`)
        if (!res.ok) throw new Error('Failed')
        return await res.json() as { data: NewsArticle[]; total: number }
    }, [endpoint, filterKey, pageSize])

    const reload = useCallback(async () => {
        const id = ++seq.current
        setLoading(true)
        setError(null)
        try {
            const page = await fetchPage(0)
            if (id !== seq.current) return
            setRows(page.data ?? [])
            setTotal(page.total ?? 0)
        } catch {
            if (id === seq.current) setError('Could not load news. Please refresh.')
        } finally {
            if (id === seq.current) setLoading(false)
        }
    }, [fetchPage])

    useEffect(() => { reload() }, [reload])

    const loadMore = useCallback(async () => {
        const id = seq.current
        setLoadingMore(true)
        try {
            const page = await fetchPage(rows.length)
            if (id !== seq.current) return
            // De-dupe by id: a new article ingested between pages shifts the
            // offsets by one, which would otherwise repeat the boundary row.
            setRows(prev => {
                const seen = new Set(prev.map(a => a.id))
                return [...prev, ...(page.data ?? []).filter(a => !seen.has(a.id))]
            })
            setTotal(page.total ?? 0)
        } catch {
            if (id === seq.current) setError('Could not load more. Please try again.')
        } finally {
            setLoadingMore(false)
        }
    }, [fetchPage, rows.length])

    return {
        rows, setRows, total, setTotal, loading, loadingMore, error, reload, loadMore,
        hasMore: rows.length < total,
    }
}

/** The HUB's standard "Load more (N remaining)" button (same as Cases / Action Centre). */
export function LoadMoreButton({ remaining, loading, onClick }: { remaining: number; loading: boolean; onClick: () => void }) {
    if (remaining <= 0) return null
    return (
        <button onClick={onClick} disabled={loading}
            className="mt-1 w-full py-2.5 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-[#0369a1] hover:bg-slate-50 disabled:text-slate-300">
            {loading ? 'Loading…' : `Load more (${remaining} remaining)`}
        </button>
    )
}
