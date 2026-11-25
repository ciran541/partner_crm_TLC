/**
 * A small client-side store for server-paged lists. Framework-free so it can be
 * tested without React; useList() in useList.ts is the hook on top.
 *
 * What every screen built on it gets:
 *  - Four honest states (listStatus): loading / error / empty / ready. "Empty"
 *    only ever means the server said so.
 *  - A failed refresh keeps the rows already loaded.
 *  - One request per list however many components use it, and first pages
 *    survive navigation (stale-while-revalidate).
 *  - Pages continue from the last row (opaque cursor), not from an offset.
 *  - A response that started before a local change is thrown away, so it can
 *    never put back what the user just changed.
 */

export interface ListPage<R = unknown, M = unknown> {
    rows: R[]
    nextCursor: string | null
    total: number | null
    meta?: M
    fetchedAt: number
}

export interface ListEntry<R = unknown, M = unknown> {
    page?: ListPage<R, M>
    /** The last first-page load failed. With a page present: it is out of date. */
    error: boolean
    loadingMore: boolean
    moreError: boolean
}

export type ListStatus = 'loading' | 'error' | 'empty' | 'ready'

const BLANK: ListEntry = { error: false, loadingMore: false, moreError: false }

export function listStatus(e: ListEntry): ListStatus {
    if (e.page) return e.page.rows.length > 0 || e.page.nextCursor ? 'ready' : 'empty'
    return e.error ? 'error' : 'loading'
}

type Body = Record<string, unknown>

export interface ListStoreOptions {
    /** GET `url`; must throw when the response is not OK. */
    fetchJson: (url: string) => Promise<unknown>
    staleMs?: number
    pageSize?: number
    /** Most rows re-read in one refresh, so a refresh keeps the scroll position. */
    maxRefresh?: number
    /** Runs after a first page lands: lets one response fill other lists (never shortening one, unless `replace`). */
    onLoad?: (key: string, body: Body, seed: (key: string, body: Body, replace?: boolean) => void) => void
    now?: () => number
}

export interface ListStore {
    get: (key: string) => ListEntry
    ensure: (key: string) => void
    retry: (key: string) => void
    loadMore: (key: string) => Promise<void>
    subscribe: (listener: () => void) => () => void
    /** A mounted screen owns loading this list (it is refetched on invalidate). */
    activate: (key: string) => () => void
    /** Edit loaded lists in place. Returning null drops a list, so it reloads. */
    patch: (fn: (key: string, page: ListPage) => ListPage | null) => void
    /** Data changed elsewhere: keep showing it, refetch what is on screen. */
    invalidate: () => void
    /** Sign-out: forget everything, including answers still on their way. */
    clear: () => void
}

function toPage(body: Body, now: number): ListPage {
    return {
        rows: (body.rows as unknown[]) ?? [],
        nextCursor: (body.nextCursor as string) ?? null,
        total: (body.total as number) ?? null,
        meta: body.meta,
        fetchedAt: now,
    }
}

const withParams = (key: string, params: Record<string, string>) =>
    `${key}${key.includes('?') ? '&' : '?'}${new URLSearchParams(params)}`

export function createListStore(opts: ListStoreOptions): ListStore {
    const { fetchJson, staleMs = 60_000, pageSize = 20, maxRefresh = 200, onLoad, now = Date.now } = opts
    const entries = new Map<string, ListEntry>()
    const inflight = new Map<string, number>()      // key → generation loading it
    const listeners = new Set<() => void>()
    const active = new Map<string, number>()        // key → mounted screens that own it
    let generation = 0

    const emit = () => listeners.forEach(l => l())
    const get = (key: string): ListEntry => entries.get(key) ?? BLANK
    const set = (key: string, patch: Partial<ListEntry>) => {
        entries.set(key, { ...get(key), ...patch })
        emit()
    }
    const isActive = (key: string) => (active.get(key) ?? 0) > 0
    const seed = (key: string, body: Body) => set(key, { page: toPage(body, now()), error: false, moreError: false })

    async function load(key: string): Promise<void> {
        if (inflight.get(key) === generation) return
        const gen = generation
        inflight.set(key, gen)
        const limit = Math.min(maxRefresh, Math.max(pageSize, get(key).page?.rows.length ?? 0))
        try {
            const body = await fetchJson(withParams(key, { limit: String(limit) })) as Body
            if (gen !== generation) return
            seed(key, body)
            onLoad?.(key, body, (other, b, replace) => {
                const rows = get(other).page?.rows.length ?? 0
                if (replace || rows <= ((b.rows as unknown[]) ?? []).length) seed(other, b)
            })
        } catch {
            if (gen !== generation) return
            set(key, { error: true })
        } finally {
            if (inflight.get(key) === gen) inflight.delete(key)
            // Data changed while this was in flight and its answer was dropped:
            // ask again if the list still has nothing to show.
            if (gen !== generation && isActive(key)) ensure(key)
        }
    }

    function ensure(key: string) {
        const page = get(key).page
        if (!page || now() - page.fetchedAt > staleMs) void load(key)
    }

    async function loadMore(key: string): Promise<void> {
        const entry = get(key)
        const cursor = entry.page?.nextCursor
        if (!cursor || entry.loadingMore) return
        const gen = generation
        set(key, { loadingMore: true, moreError: false })
        try {
            const body = await fetchJson(withParams(key, { limit: String(pageSize), cursor })) as Body
            const page = get(key).page
            if (gen !== generation || !page || page.nextCursor !== cursor) return
            const seen = new Set((page.rows as { id?: string }[]).map(r => r.id))
            const fresh = ((body.rows as { id?: string }[]) ?? []).filter(r => r.id === undefined || !seen.has(r.id))
            set(key, { page: { ...page, rows: [...page.rows, ...fresh], nextCursor: (body.nextCursor as string) ?? null } })
        } catch {
            if (gen === generation) set(key, { moreError: true })
        } finally {
            if (entries.has(key)) set(key, { loadingMore: false })
        }
    }

    return {
        get,
        ensure,
        loadMore,
        retry(key) {
            set(key, { error: false })
            void load(key)
        },
        subscribe(listener) {
            listeners.add(listener)
            return () => { listeners.delete(listener) }
        },
        activate(key) {
            active.set(key, (active.get(key) ?? 0) + 1)
            ensure(key)
            return () => { active.set(key, Math.max(0, (active.get(key) ?? 1) - 1)) }
        },
        patch(fn) {
            generation++
            for (const [key, e] of [...entries]) {
                if (!e.page) continue
                const next = fn(key, e.page)
                // Out of date either way: re-checked on the next visit.
                entries.set(key, next ? { ...e, page: { ...next, fetchedAt: 0 } } : { ...e, page: undefined })
            }
            emit()
            for (const key of [...active.keys()]) if (isActive(key) && !get(key).page) void load(key)
        },
        invalidate() {
            generation++
            for (const [key, e] of [...entries]) if (e.page) entries.set(key, { ...e, page: { ...e.page, fetchedAt: 0 } })
            for (const key of [...active.keys()]) if (isActive(key)) ensure(key)
        },
        clear() {
            generation++
            entries.clear()
            active.clear()
            emit()
        },
    }
}
