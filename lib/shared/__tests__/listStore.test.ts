import { describe, expect, it } from 'vitest'
import { createListStore, listStatus } from '../listStore'

const tick = () => new Promise(r => setTimeout(r, 0))

/** A fetch whose answers the test releases by hand, in any order. */
function setup(extra: Partial<Parameters<typeof createListStore>[0]> = {}) {
    const calls: { url: string; ok: (b: unknown) => void; fail: () => void }[] = []
    const store = createListStore({
        fetchJson: url => new Promise((res, rej) => calls.push({ url, ok: res, fail: () => rej(new Error('x')) })),
        ...extra,
    })
    return { store, calls }
}
const body = (ids: string[], nextCursor: string | null = null) => ({ rows: ids.map(id => ({ id })), nextCursor, total: ids.length })
const ids = (s: ReturnType<typeof createListStore>, k = '/k') => (s.get(k).page?.rows as { id: string }[] | undefined)?.map(r => r.id)

describe('listStore', () => {
    it('is never empty before the server answers', async () => {
        const { store, calls } = setup()
        expect(listStatus(store.get('/k'))).toBe('loading')
        store.activate('/k')
        expect(listStatus(store.get('/k'))).toBe('loading')
        calls[0].ok(body([])); await tick()
        expect(listStatus(store.get('/k'))).toBe('empty')
    })

    it('a failure is an error, not empty, and can be retried', async () => {
        const { store, calls } = setup()
        store.activate('/k')
        calls[0].fail(); await tick()
        expect(listStatus(store.get('/k'))).toBe('error')
        store.retry('/k'); calls[1].ok(body(['a'])); await tick()
        expect(listStatus(store.get('/k'))).toBe('ready')
        expect(store.get('/k').error).toBe(false)
    })

    it('a failed refresh keeps the rows', async () => {
        const { store, calls } = setup()
        store.activate('/k'); calls[0].ok(body(['a'])); await tick()
        store.invalidate(); calls[1].fail(); await tick()
        expect(ids(store)).toEqual(['a'])
        expect(store.get('/k').error).toBe(true)
    })

    it('mount, unmount, mount again (React development mode) asks once', async () => {
        const { store, calls } = setup()
        store.activate('/k')(); store.activate('/k')
        expect(calls).toHaveLength(1)
        calls[0].ok(body(['a'])); await tick()
        expect(listStatus(store.get('/k'))).toBe('ready')
    })

    it('pages append once, without repeats, and a failed page can be retried', async () => {
        const { store, calls } = setup()
        store.activate('/k'); calls[0].ok(body(['a', 'b'], 'c1')); await tick()
        void store.loadMore('/k'); void store.loadMore('/k')
        expect(calls).toHaveLength(2)
        expect(calls[1].url).toContain('cursor=c1')
        calls[1].fail(); await tick()
        expect(store.get('/k')).toMatchObject({ moreError: true, loadingMore: false })
        void store.loadMore('/k'); calls[2].ok(body(['b', 'c'])); await tick()
        expect(ids(store)).toEqual(['a', 'b', 'c'])
        expect(store.get('/k').page?.nextCursor).toBeNull()
    })

    it('an answer from before a local change is thrown away', async () => {
        const { store, calls } = setup()
        store.activate('/k'); calls[0].ok(body(['a', 'b'])); await tick()
        store.invalidate()                                   // refresh on its way…
        store.patch((_k, p) => ({ ...p, rows: p.rows.slice(1) }))   // …user saves
        calls[1].ok(body(['a', 'b'])); await tick()
        expect(ids(store)).toEqual(['b'])
    })

    it('a dropped first load is asked again', async () => {
        const { store, calls } = setup()
        store.activate('/k')
        store.patch((_k, p) => p)
        calls[0].ok(body(['old'])); await tick()
        calls[calls.length - 1].ok(body(['new'])); await tick()
        expect(ids(store)).toEqual(['new'])
    })

    it('a refresh re-reads as many rows as are loaded', async () => {
        const { store, calls } = setup()
        store.activate('/k'); calls[0].ok(body(Array.from({ length: 60 }, (_, i) => `r${i}`))); await tick()
        store.invalidate()
        expect(calls[1].url).toContain('limit=60')
    })

    it('sign-out forgets answers still on their way', async () => {
        const { store, calls } = setup()
        store.activate('/k'); store.clear()
        calls[0].ok(body(['secret'])); await tick()
        expect(store.get('/k').page).toBeUndefined()
    })

    it('one response can fill another list', async () => {
        const { store, calls } = setup({ onLoad: (_k, b, seed) => seed('/other', b.other as Record<string, unknown>) })
        store.activate('/k'); calls[0].ok({ ...body(['a']), other: body(['z']) }); await tick()
        expect(ids(store, '/other')).toEqual(['z'])
    })

    it('but never shortens a list that has been scrolled', async () => {
        const { store, calls } = setup({ onLoad: (_k, b, seed) => { if (b.other) seed('/other', b.other as Record<string, unknown>) } })
        store.activate('/other'); calls[0].ok(body(['x', 'y', 'z'])); await tick()
        store.activate('/k'); calls[1].ok({ ...body(['a']), other: body(['x']) }); await tick()
        expect(ids(store, '/other')).toEqual(['x', 'y', 'z'])
    })
})
