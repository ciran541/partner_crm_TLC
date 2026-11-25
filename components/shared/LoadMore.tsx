'use client'

import { useEffect, useRef } from 'react'

/**
 * End of a paged list: loads the next page as the user nears it, with a button
 * as the fallback. After a failure it waits for a tap instead of retrying.
 */
export default function LoadMore({ hasMore, loading, failed, onLoad, auto = true, remaining }: {
    hasMore: boolean
    loading: boolean
    failed?: boolean
    onLoad: () => void
    auto?: boolean
    remaining?: number | null
}) {
    const ref = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        const el = ref.current
        if (!auto || !el || !hasMore || loading || failed || typeof IntersectionObserver === 'undefined') return
        const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) onLoad() }, { rootMargin: '600px 0px' })
        io.observe(el)
        return () => io.disconnect()
    }, [auto, hasMore, loading, failed, onLoad])

    if (!hasMore) return null
    return (
        <button ref={ref} type="button" onClick={onLoad} disabled={loading}
            className="mt-1 w-full min-h-[44px] text-xs font-semibold rounded-lg bg-white border border-slate-200 text-[#0369a1] hover:bg-slate-50 disabled:text-slate-400">
            {loading ? 'Loading…' : failed ? 'Couldn’t load more. Try again' : `Load more${remaining && remaining > 0 ? ` (${remaining} remaining)` : ''}`}
        </button>
    )
}
