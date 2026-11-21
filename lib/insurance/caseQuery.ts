import type { Case } from '@/lib/types'

/**
 * The case-list query shape and its URL serialisation.
 *
 * Pure and framework-free, split out of usePagedCases.ts so it can be tested
 * without React or a network. The hook owns caching and lifecycle; this owns
 * "what does this query look like on the wire, and what is its identity".
 */

/**
 * A list row: the case columns plus two server-computed fields — the loan figure
 * and the commission bucket. Both come from SQL so the client never re-derives
 * them, which is what keeps a row's displayed value and the aggregate over those
 * rows from ever disagreeing.
 */
export type CaseListRow = Case & {
    loan_value?: number
    /** Closed Won only: the day it was marked Closed Won (SGT), YYYY-MM-DD. */
    closed_on?: string | null
    /** Closed Won only: the payouts recorded for this case, oldest first (negative = reversal). */
    payouts?: { amount: number; paid_on: string }[] | null
    bucket?: 'open' | 'closed_unpaid' | 'closed_paid' | null
}

export interface CaseQuery {
    search?: string
    /** 'active' (default) | a specific stage | 'all' */
    stage?: string
    caseType?: string
    /** Admin only — ignored by the server for agents. */
    agent?: string
    from?: string
    to?: string
    month?: string
    includeDrafts?: boolean
    /** ONLY planner drafts — the inverse of the usual filter. */
    draftsOnly?: boolean
    /** Restrict to the caller's own cases even for admins. */
    mine?: boolean
    /** Stages to omit entirely (the lock-in screen omits 'Closed Lost'). */
    excludeStages?: string[]
    /** Only cases with a follow-up date set. */
    hasFollowUp?: boolean
    /** follow_up_date <= this date — the "overdue" half. */
    followUpTo?: string
    /** follow_up_date > this date — the "upcoming" half. */
    followUpAfter?: string
    /** Only cases that still need a follow-up date (Action Centre — needsFollowUp()). */
    missingFollowUp?: boolean
    /** Closed Won cases closed in this month 'YYYY-MM' or year 'YYYY' (SGT) — the Closed Won tab. */
    closedMonth?: string
    lockInFrom?: string
    lockInTo?: string
    /**
     * Commission bucket. 'all' means every case that HAS a bucket — i.e.
     * excluding drafts and Closed Lost, which earn nothing.
     */
    bucket?: 'all' | 'open' | 'closed_unpaid' | 'closed_paid'
    /** 'updated_at' (default) | 'created_at' | 'follow_up_date' | 'lock_in_end_date' */
    sort?: string
    /** 'desc' (default) | 'asc' */
    dir?: 'asc' | 'desc'
    /** Rows per page. Defaults to PAGE_SIZE; a dashboard preview wants far fewer. */
    limit?: number
}

export const PAGE_SIZE = 50

/**
 * Every unset filter is OMITTED rather than sent empty — an empty `stage=` would
 * reach the server as a filter value rather than as "no filter".
 */
export function buildCaseParams(q: CaseQuery, cursor: string | null): URLSearchParams {
    const p = new URLSearchParams()
    if (q.search?.trim()) p.set('search', q.search.trim())
    if (q.stage) p.set('stage', q.stage)
    if (q.caseType) p.set('caseType', q.caseType)
    if (q.agent) p.set('agent', q.agent)
    if (q.from) p.set('from', q.from)
    if (q.to) p.set('to', q.to)
    if (q.month) p.set('month', q.month)
    if (q.includeDrafts) p.set('includeDrafts', 'true')
    if (q.draftsOnly) p.set('draftsOnly', 'true')
    if (q.mine) p.set('mine', 'true')
    if (q.excludeStages?.length) p.set('excludeStages', q.excludeStages.join(','))
    if (q.hasFollowUp) p.set('hasFollowUp', 'true')
    if (q.followUpTo) p.set('followUpTo', q.followUpTo)
    if (q.followUpAfter) p.set('followUpAfter', q.followUpAfter)
    if (q.missingFollowUp) p.set('missingFollowUp', 'true')
    if (q.closedMonth) p.set('closedMonth', q.closedMonth)
    if (q.lockInFrom) p.set('lockInFrom', q.lockInFrom)
    if (q.lockInTo) p.set('lockInTo', q.lockInTo)
    if (q.bucket) p.set('bucket', q.bucket)
    if (q.sort) p.set('sort', q.sort)
    if (q.dir) p.set('dir', q.dir)
    // Part of the cache key too, so a 5-row dashboard preview and a 50-row list
    // of the same query never share an entry.
    p.set('limit', String(q.limit ?? PAGE_SIZE))
    if (cursor) p.set('cursor', cursor)
    return p
}

/**
 * Cache identity for a query. The paging cursor is deliberately excluded, so a
 * query's accumulated pages stay under one key as you load more.
 */
export function caseQueryKey(q: CaseQuery): string {
    return buildCaseParams(q, null).toString()
}
