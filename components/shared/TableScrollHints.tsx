'use client'

import { useEffect } from 'react'

/**
 * Marks horizontally-scrollable table containers so CSS can show a "there's
 * more →" fade only when it's true: the table is wider than its box AND you
 * haven't scrolled to the end. (iOS hides scrollbars until you swipe, so
 * without a cue a scrollable table looks exactly like a cut-off one.)
 *
 * Sets on each container: data-overflow="1" when content is wider than the box,
 * data-end="1" when scrolled to the right edge. Styles: app/globals.css.
 * Mounted once in the root layout; picks up tables rendered later too.
 */

const SCROLLERS = '.table-scroll, .overflow-x-auto, .overflow-auto, [style*="overflow-x: auto"], [style*="overflow: auto"]'

export default function TableScrollHints() {
    useEffect(() => {
        const tracked = new WeakSet<Element>()
        // Observed element → the scroll container to re-measure (a table maps to its wrapper).
        const owner = new WeakMap<Element, HTMLElement>()

        const update = (el: HTMLElement) => {
            const overflow = el.scrollWidth > el.clientWidth + 1
            const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2
            if (overflow) el.dataset.overflow = '1'; else delete el.dataset.overflow
            if (atEnd) el.dataset.end = '1'; else delete el.dataset.end
        }

        const resize = new ResizeObserver(entries => {
            for (const e of entries) {
                const el = owner.get(e.target)
                if (el) update(el)
            }
        })

        const scan = () => {
            document.querySelectorAll<HTMLElement>(SCROLLERS).forEach(el => {
                if (tracked.has(el) || !el.querySelector(':scope > table')) return
                tracked.add(el)
                el.addEventListener('scroll', () => update(el), { passive: true })
                owner.set(el, el)
                resize.observe(el)
                const table = el.querySelector(':scope > table')
                if (table) { owner.set(table, el); resize.observe(table) }
                update(el)
            })
        }

        let frame = 0
        const mutations = new MutationObserver(() => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(scan)
        })
        scan()
        mutations.observe(document.body, { childList: true, subtree: true })

        return () => {
            cancelAnimationFrame(frame)
            mutations.disconnect()
            resize.disconnect()
        }
    }, [])

    return null
}
