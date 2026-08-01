/**
 * Query-string construction for the paged case endpoint.
 *
 * Pure and offline, unlike sqlParity.test.ts. Small surface, but it is the layer
 * every migrated screen goes through, and two of its properties are load-bearing
 * in ways that are easy to break by accident:
 *
 *   - Absent filters must be OMITTED, not sent empty. An empty `stage=` would
 *     land on the server as a filter value.
 *   - The cache key must distinguish every query that returns different rows,
 *     and must NOT include the paging cursor — a query's accumulated pages all
 *     live under one key as you load more.
 */

import { describe, it, expect } from 'vitest'
import { buildCaseParams, caseQueryKey } from '@/lib/insurance/caseQuery'

const params = (...args: Parameters<typeof buildCaseParams>) =>
    Object.fromEntries(buildCaseParams(...args))

describe('buildCaseParams', () => {
    it('omits every unset filter rather than sending it empty', () => {
        const p = params({}, null)
        expect(p).toEqual({ limit: '50' })
    })

    it('omits a whitespace-only search', () => {
        expect(params({ search: '   ' }, null).search).toBeUndefined()
    })

    it('trims the search term', () => {
        expect(params({ search: '  tan  ' }, null).search).toBe('tan')
    })

    it('serialises booleans as the literal the route checks for', () => {
        const p = params({ includeDrafts: true, draftsOnly: true, mine: true, hasFollowUp: true }, null)
        expect(p.includeDrafts).toBe('true')
        expect(p.draftsOnly).toBe('true')
        expect(p.mine).toBe('true')
        expect(p.hasFollowUp).toBe('true')
    })

    it('omits false booleans entirely', () => {
        const p = params({ includeDrafts: false, mine: false }, null)
        expect(p.includeDrafts).toBeUndefined()
        expect(p.mine).toBeUndefined()
    })

    it('joins excludeStages with commas, matching the route’s split', () => {
        expect(params({ excludeStages: ['Closed Lost', 'Closed Won'] }, null).excludeStages)
            .toBe('Closed Lost,Closed Won')
    })

    it('omits an empty excludeStages array', () => {
        expect(params({ excludeStages: [] }, null).excludeStages).toBeUndefined()
    })

    it('defaults the page size but lets a caller override it', () => {
        expect(params({}, null).limit).toBe('50')
        expect(params({ limit: 5 }, null).limit).toBe('5')
    })

    it('includes the cursor only when paging', () => {
        expect(params({}, null).cursor).toBeUndefined()
        expect(params({}, '50').cursor).toBe('50')
    })
})

describe('caseQueryKey', () => {
    it('ignores the cursor, so a query’s pages share one cache entry', () => {
        expect(caseQueryKey({ stage: 'active' })).toBe(caseQueryKey({ stage: 'active' }))
    })

    it('separates queries that return different rows', () => {
        const distinct = [
            caseQueryKey({ stage: 'active' }),
            caseQueryKey({ stage: 'all' }),
            caseQueryKey({ stage: 'active', search: 'tan' }),
            caseQueryKey({ stage: 'active', bucket: 'open' }),
            caseQueryKey({ stage: 'active', agent: 'a1' }),
            caseQueryKey({ stage: 'active', draftsOnly: true }),
            caseQueryKey({ stage: 'active', mine: true }),
            caseQueryKey({ stage: 'active', followUpTo: '2026-08-01' }),
            caseQueryKey({ stage: 'active', followUpAfter: '2026-08-01' }),
            caseQueryKey({ stage: 'active', sort: 'follow_up_date' }),
            caseQueryKey({ stage: 'active', sort: 'follow_up_date', dir: 'asc' }),
        ]
        expect(new Set(distinct).size).toBe(distinct.length)
    })

    it('separates the same query at different page sizes', () => {
        // A 5-row dashboard preview must not read the 50-row list's cache entry.
        expect(caseQueryKey({ stage: 'all', limit: 5 }))
            .not.toBe(caseQueryKey({ stage: 'all', limit: 50 }))
    })

    it('treats an untrimmed search as the same query', () => {
        expect(caseQueryKey({ search: 'tan' })).toBe(caseQueryKey({ search: '  tan  ' }))
    })

    it('distinguishes the overdue and upcoming halves of the follow-up split', () => {
        // These two make up the follow-ups screen; sharing a key would show one
        // half's rows under the other's heading.
        expect(caseQueryKey({ hasFollowUp: true, followUpTo: '2026-08-01', dir: 'desc' }))
            .not.toBe(caseQueryKey({ hasFollowUp: true, followUpAfter: '2026-08-01', dir: 'asc' }))
    })
})
