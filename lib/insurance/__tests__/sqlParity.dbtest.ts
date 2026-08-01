/**
 * Parity between the SQL functions and the TypeScript they were mirrored from.
 *
 * Phases A–D moved filtering, paging and every total out of the browser and into
 * Postgres. That duplicated four rules into SQL — the draft rule, the loan-base
 * rule, the commission bucket, and the commission arithmetic — with nothing
 * checking that the two copies still agree. This is that check: it computes the
 * expected answer with the ACTUAL application functions and asserts the database
 * returns the same thing over the same rows.
 *
 * It is the test that would catch the failure mode that matters most here: SQL
 * that runs perfectly well and quietly returns different money.
 *
 * Read-only — it never writes. Safe against a database with real data in it.
 *
 *   npm run test:db
 *
 * Named `.dbtest.ts` so `npm test` never collects it — that run stays pure and
 * offline. Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, read
 * from .env.local; missing credentials FAIL rather than skip, because a suite
 * that silently reports green while testing nothing is worse than no suite.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { isDraftCase } from '@/lib/insurance/caseFilters'
import {
    caseLoanBase,
    commissionBucket,
    commissionTotals,
    commissionByAgent,
} from '@/lib/insurance/commission'
import { calculateCommission } from '@/lib/property/commission'
import type { Case } from '@/lib/types'

function loadEnv() {
    try {
        const raw = readFileSync(new URL('../../../.env.local', import.meta.url), 'utf8')
        for (const line of raw.split('\n')) {
            const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
            if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
        }
    } catch { /* fall back to the real environment */ }
}
loadEnv()

/** Money compared in cents: both sides round to 2dp, so anything beyond a cent
 *  is a real disagreement rather than float noise. */
const money = (n: unknown) => Math.round(Number(n ?? 0) * 100)

/** An arbitrary uuid — every call runs as admin, so the viewer id is unused. */
const ANY_UUID = '00000000-0000-0000-0000-000000000000'

/** What search_cases() returns. */
interface RpcList {
    rows: (Case & { loan_value: number; bucket: string | null })[]
    total: number
    loan_volume: number
}

/** One row of case_commission_by_agent(). */
interface AgentRow {
    agentId: string
    agentName: string
    open: number
    closedUnpaid: number
    closedPaid: number
    activeCases: number
    total: number
}

/**
 * Plain fetch rather than supabase-js: createClient() boots a realtime client
 * that needs a native WebSocket, which Node 20 does not have. Talking to
 * PostgREST directly also means these tests exercise the same wire format the
 * app's own routes do, with nothing in between.
 */
function restClient(url: string, key: string) {
    const headers = {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
    }
    return {
        // Throws rather than returning an error field: a failed RPC means the
        // test cannot say anything, so it should fail loudly at the call site.
        async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
            const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
                method: 'POST', headers, body: JSON.stringify(args),
            })
            const body = await res.text()
            if (!res.ok) throw new Error(`rpc ${fn} failed: ${res.status} ${body}`)
            return JSON.parse(body) as T
        },
        async select<T>(table: string, query: string): Promise<T[]> {
            const res = await fetch(`${url}/rest/v1/${table}?${query}`, { headers })
            const body = await res.text()
            if (!res.ok) throw new Error(`${table}: ${res.status} ${body}`)
            return JSON.parse(body) as T[]
        },
    }
}

describe('SQL ↔ TypeScript parity', () => {
    let db: ReturnType<typeof restClient>
    let allCases: Case[]

    beforeAll(async () => {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!url || !key) {
            throw new Error(
                'Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. ' +
                'These tests compare the live SQL functions against the TypeScript ' +
                'they mirror, so they cannot run without a database.',
            )
        }
        db = restClient(url.replace(/\/$/, ''), key)

        // Paged deliberately: the project's PostgREST max_rows caps a single
        // request, and this oracle has to see EVERY row or its totals would be
        // wrong in exactly the way the migration set out to fix.
        allCases = []
        const PAGE = 500
        for (let offset = 0; ; offset += PAGE) {
            const batch = await db.select<Case>('cases', `select=*&order=id.asc&limit=${PAGE}&offset=${offset}`)
            allCases.push(...batch)
            if (batch.length < PAGE) break
        }
    })

    /** Non-draft cases — the population every screen except the planner uses. */
    const pipeline = () => allCases.filter(c => !isDraftCase(c))

    it('has cases to compare (otherwise this suite proves nothing)', () => {
        expect(allCases.length).toBeGreaterThan(0)
    })

    // ─── search_cases ────────────────────────────────────────────────────────
    describe('search_cases()', () => {
        it('loan_value on every row matches caseLoanBase()', async () => {
            const data = await db.rpc<RpcList>('search_cases', {
                p_viewer_id: ANY_UUID, p_is_admin: true, p_stage: 'all', p_limit: 200,
            })

            const rows = (data?.rows ?? []) as (Case & { loan_value: number })[]
            expect(rows.length).toBeGreaterThan(0)

            const byId = new Map(allCases.map(c => [c.id, c]))
            for (const row of rows) {
                const ts = byId.get(row.id)
                if (!ts) continue
                expect(
                    money(row.loan_value),
                    `loan_value mismatch on case ${row.id} (${ts.stage} / ${ts.case_type})`,
                ).toBe(money(caseLoanBase(ts)))
            }
        })

        it('bucket on every row matches commissionBucket()', async () => {
            const data = await db.rpc<RpcList>('search_cases', {
                p_viewer_id: ANY_UUID, p_is_admin: true, p_stage: 'all',
                p_include_drafts: true, p_limit: 200,
            })

            const rows = (data?.rows ?? []) as (Case & { bucket: string | null })[]
            const byId = new Map(allCases.map(c => [c.id, c]))
            for (const row of rows) {
                const ts = byId.get(row.id)
                if (!ts) continue
                expect(
                    row.bucket ?? null,
                    `bucket mismatch on case ${row.id} (${ts.stage} / ${ts.commission_status})`,
                ).toBe(commissionBucket(ts))
            }
        })

        it('excludes drafts by default, exactly as isDraftCase() does', async () => {
            const data = await db.rpc<RpcList>('search_cases', {
                p_viewer_id: ANY_UUID, p_is_admin: true, p_stage: 'all', p_limit: 1,
            })
            expect(data.total).toBe(pipeline().length)
        })

        it('drafts-only returns exactly the drafts', async () => {
            const data = await db.rpc<RpcList>('search_cases', {
                p_viewer_id: ANY_UUID, p_is_admin: true, p_stage: 'all',
                p_drafts_only: true, p_limit: 1,
            })
            expect(data.total).toBe(allCases.filter(isDraftCase).length)
        })

        it('total and loan_volume cover every matching row, not the page', async () => {
            const data = await db.rpc<RpcList>('search_cases', {
                p_viewer_id: ANY_UUID, p_is_admin: true, p_stage: 'all', p_limit: 5,
            })

            const expected = pipeline()
            expect(data.rows.length).toBeLessThanOrEqual(5)
            expect(data.total).toBe(expected.length)
            expect(money(data.loan_volume)).toBe(
                money(expected.reduce((s, c) => s + caseLoanBase(c), 0)),
            )
        })

        it('paging returns every row exactly once, with no gaps or repeats', async () => {
            const seen: string[] = []
            const PAGE = 25
            for (let offset = 0; ; offset += PAGE) {
                const data = await db.rpc<RpcList>('search_cases', {
                    p_viewer_id: ANY_UUID, p_is_admin: true, p_stage: 'all',
                    p_limit: PAGE, p_offset: offset,
                })
                const rows = (data?.rows ?? []) as Case[]
                seen.push(...rows.map(r => r.id))
                if (rows.length < PAGE) break
                if (offset > 5000) throw new Error('paging did not terminate')
            }
            expect(new Set(seen).size, 'a row was returned on two different pages').toBe(seen.length)
            expect(seen.length).toBe(pipeline().length)
        })

        it('each bucket filter matches the TypeScript bucketing', async () => {
            for (const bucket of ['open', 'closed_unpaid', 'closed_paid'] as const) {
                const data = await db.rpc<RpcList>('search_cases', {
                    p_viewer_id: ANY_UUID, p_is_admin: true, p_stage: 'all',
                    p_bucket: bucket, p_limit: 1,
                })
                expect(data.total, `bucket=${bucket}`).toBe(
                    pipeline().filter(c => commissionBucket(c) === bucket).length,
                )
            }
        })
    })

    // ─── case_summary ────────────────────────────────────────────────────────
    describe('case_summary()', () => {
        let summary: Record<string, unknown>

        beforeAll(async () => {
            summary = await db.rpc<Record<string, unknown>>('case_summary', {
                p_viewer_id: ANY_UUID, p_is_admin: true,
            })
        })

        it('counts match', () => {
            const p = pipeline()
            expect(summary.total_cases).toBe(p.length)
            expect(summary.active_cases).toBe(
                p.filter(c => c.stage !== 'Closed Won' && c.stage !== 'Closed Lost').length,
            )
            expect(summary.closed_won).toBe(p.filter(c => c.stage === 'Closed Won').length)
            expect(summary.closed_lost).toBe(p.filter(c => c.stage === 'Closed Lost').length)
        })

        it('loan volume spans all non-draft cases, including Closed Lost', () => {
            expect(money(summary.volume)).toBe(
                money(pipeline().reduce((s, c) => s + caseLoanBase(c), 0)),
            )
        })

        it('commission totals match commissionTotals() to the cent', () => {
            const expected = commissionTotals(pipeline())
            const actual = summary.commission as Record<string, unknown>

            expect(money(actual.open)).toBe(money(expected.open))
            expect(money(actual.closed_unpaid)).toBe(money(expected.closedUnpaid))
            expect(money(actual.closed_paid)).toBe(money(expected.closedPaid))
            expect(money(actual.total)).toBe(money(expected.total))
            expect(actual.active_cases).toBe(expected.activeCases)
        })

        it('per-bucket counts sum to the bucketed population', () => {
            const c = summary.commission as Record<string, number>
            const bucketed = pipeline().filter(x => commissionBucket(x) !== null)
            expect(c.count_open + c.count_closed_unpaid + c.count_closed_paid).toBe(bucketed.length)
        })

        it('follow-up counts split cleanly around today', () => {
            const today = new Date().toISOString().slice(0, 10)
            const withFu = pipeline().filter(c => c.follow_up_date)
            const fu = summary.follow_ups as Record<string, number>

            expect(fu.total).toBe(withFu.length)
            expect(fu.overdue).toBe(withFu.filter(c => c.follow_up_date! <= today).length)
            expect(fu.upcoming).toBe(withFu.filter(c => c.follow_up_date! > today).length)
            expect(fu.overdue + fu.upcoming).toBe(fu.total)
        })

        it('stage and type counts match', () => {
            const p = pipeline()
            const stages = summary.stage_counts as Record<string, number>
            for (const [stage, n] of Object.entries(stages)) {
                expect(n, `stage ${stage}`).toBe(p.filter(c => c.stage === stage).length)
            }
            const types = summary.type_counts as Record<string, number>
            for (const [type, n] of Object.entries(types)) {
                expect(n, `type ${type}`).toBe(p.filter(c => c.case_type === type).length)
            }
        })

        const lockInWindow = () => ({
            p_viewer_id: ANY_UUID, p_is_admin: true, p_stage: 'all',
            p_exclude_stages: ['Closed Lost'],
            p_lock_in_from: new Date().toISOString().slice(0, 10),
            p_lock_in_to: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
            p_limit: 1,
        })

        it('upcoming lock-in count matches the same window over non-draft cases', async () => {
            const data = await db.rpc<RpcList>('search_cases', lockInWindow())
            expect(summary.upcoming_lock_ins).toBe(data.total)
        })

        /**
         * KNOWN DISCREPANCY, pre-dating the server-side migration and preserved
         * by it deliberately.
         *
         * The Pipeline card counts non-draft cases only (its stats were always
         * computed after filtering drafts out). The Upcoming Lock-ins screen it
         * links to never filtered drafts, so it lists a few MORE rows — one per
         * draft that happens to carry a lock-in date in the window.
         *
         * A draft has no client name, so a lock-in entry for one shows as
         * "Unnamed" and is arguably noise. This test does not assert which
         * behaviour is right; it pins the gap so that if either side changes,
         * someone has to decide on purpose rather than by accident.
         */
        it('documents that the lock-in SCREEN includes drafts while the card does not', async () => {
            const withDrafts = await db.rpc<RpcList>('search_cases', {
                ...lockInWindow(), p_include_drafts: true,
            })
            const today = new Date().toISOString().slice(0, 10)
            const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)

            const draftsInWindow = allCases.filter(c =>
                isDraftCase(c)
                && c.stage !== 'Closed Lost'
                && !!c.lock_in_end_date
                && c.lock_in_end_date >= today
                && c.lock_in_end_date <= in90,
            ).length

            expect(withDrafts.total - Number(summary.upcoming_lock_ins)).toBe(draftsInWindow)
        })
    })

    // ─── case_commission_by_agent ────────────────────────────────────────────
    describe('case_commission_by_agent()', () => {
        it('matches commissionByAgent() for every agent on the roster', async () => {
            const profiles = await db.select<{ id: string; name: string; status: string }>(
                'profiles',
                'select=id,name,role,app_type,status&app_type=eq.insurance&role=eq.agent',
            )

            const roster = profiles
                .filter(p => p.status !== 'disabled')
                .map(p => ({ id: p.id, name: p.name || 'Unnamed agent' }))

            const expected = commissionByAgent(allCases, roster)

            const data = await db.rpc<AgentRow[]>('case_commission_by_agent', {})

            const actual = (data ?? []) as {
                agentId: string; agentName: string
                open: number; closedUnpaid: number; closedPaid: number
                activeCases: number; total: number
            }[]

            // An agent with no cases still belongs in the table, as a row of zeros.
            expect(actual.length, 'roster size').toBe(expected.length)

            const byId = new Map(actual.map(r => [r.agentId, r]))
            for (const exp of expected) {
                const got = byId.get(exp.agentId)
                expect(got, `agent ${exp.agentName} missing from SQL result`).toBeDefined()
                expect(money(got!.open), `${exp.agentName} open`).toBe(money(exp.open))
                expect(money(got!.closedUnpaid), `${exp.agentName} unpaid`).toBe(money(exp.closedUnpaid))
                expect(money(got!.closedPaid), `${exp.agentName} paid`).toBe(money(exp.closedPaid))
                expect(money(got!.total), `${exp.agentName} total`).toBe(money(exp.total))
                expect(got!.activeCases, `${exp.agentName} active cases`).toBe(exp.activeCases)
            }
        })

        it('is sorted by total, highest first', async () => {
            const data = await db.rpc<AgentRow[]>('case_commission_by_agent', {})
            const totals = ((data ?? []) as { total: number }[]).map(r => Number(r.total))
            const sorted = [...totals].sort((a, b) => b - a)
            expect(totals).toEqual(sorted)
        })
    })

    // ─── the commission arithmetic itself ────────────────────────────────────
    it('per-case commission derived from loan_value matches calculateCommission()', async () => {
        const data = await db.rpc<RpcList>('search_cases', {
            p_viewer_id: ANY_UUID, p_is_admin: true, p_stage: 'all',
            p_bucket: 'all', p_limit: 100,
        })

        const byId = new Map(allCases.map(c => [c.id, c]))
        for (const row of (data?.rows ?? []) as (Case & { loan_value: number })[]) {
            const ts = byId.get(row.id)
            if (!ts) continue
            // What the earnings table renders per row, against the source of truth.
            const fromServer = calculateCommission(Number(row.loan_value))
            const fromTs = calculateCommission(caseLoanBase(ts))
            expect(money(fromServer.gross), `gross on ${row.id}`).toBe(money(fromTs.gross))
            expect(money(fromServer.agent), `agent share on ${row.id}`).toBe(money(fromTs.agent))
        }
    })
})
