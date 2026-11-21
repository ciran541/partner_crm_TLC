import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import type { Case } from '@/lib/types'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { validateIntake, intakeToCaseRow, mobileKey, type RawIntake } from '@/lib/insurance/caseIntake'
import { loadBankNames, ownMobileIndex } from '@/lib/insurance/caseIntakeServer'
import { syncInsuranceFollowUp } from '@/lib/google/syncFollowUpInsurance'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/**
 * GET /api/insurance/cases — the server-side case list.
 *
 * Why this exists: the old client store pulled the whole table and then
 * searched/filtered/totalled it in the browser. Two things broke. The list
 * silently truncated — the project's PostgREST `max_rows` is 1000, below the
 * app's own cap — so a search reported "no results" for a client that plainly
 * exists. And every total on every screen was computed from whatever rows
 * happened to arrive, making revenue and case counts quietly wrong rather than
 * visibly broken.
 *
 * The rule now: the browser may DISPLAY rows, but the server decides WHICH rows,
 * and the server does the arithmetic.
 *
 * All of it — filters, paging, count and loan volume — comes from ONE call to
 * the search_cases() function (migration 20260801010000). Rows and totals are
 * deliberately not separate queries: two independent expressions of the same
 * filters can drift, and a total that disagrees with the list beneath it is both
 * plausible-looking and horrible to debug.
 *
 * Query params
 *   search=          client name / mobile / email (+ agent name when admin)
 *   stage=           'active' (default, excludes Closed Won/Lost and Inactive) | a stage | 'all'
 *   caseType=        exact case type
 *   agent=           created_by uuid — admin only, ignored for agents
 *   from= / to=      created_at date range, YYYY-MM-DD inclusive
 *   month=           created_at month, YYYY-MM (ignored when from/to given)
 *   includeDrafts=   'true' to include planner drafts (default: excluded)
 *   draftsOnly=      'true' for ONLY planner drafts (the planner's in-progress list)
 *   mine=            'true' to restrict to the caller's own cases even for admins
 *   updatedSince=    ISO timestamp — only rows changed since then (delta sync)
 *   excludeStages=   comma-separated stages to omit
 *   hasFollowUp=     'true' for cases with a follow-up date set
 *   followUpTo=      follow_up_date <= YYYY-MM-DD  (the "overdue" half)
 *   followUpAfter=   follow_up_date >  YYYY-MM-DD  (the "upcoming" half)
 *   missingFollowUp= 'true' for cases that still need a follow-up date (Action Centre)
 *   closedMonth=     YYYY-MM or YYYY — Closed Won cases closed in that month / year (SGT)
 *   lockInFrom= / lockInTo=  lock_in_end_date window, YYYY-MM-DD
 *   bucket=          'all' (any case with a commission bucket) | open |
 *                    closed_unpaid | closed_paid
 *   sort=            updated_at (default) | created_at | follow_up_date | lock_in_end_date
 *   dir=             desc (default) | asc
 *   limit=           default 50, max 200
 *   cursor=          opaque paging cursor from the previous response
 *
 * Response
 *   { rows, nextCursor, total, loanVolume }
 *
 * `total` and `loanVolume` describe EVERY row matching the filters, not the page —
 * that is what lets the UI show a real revenue figure and say "50 of 1,240"
 * instead of silently truncating.
 */

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

interface SearchCasesResult {
    rows: Case[]
    total: number
    loan_volume: number
    agent_share?: number
}

function parseCursor(raw: string | null): number {
    const n = Number.parseInt(raw ?? '0', 10)
    return Number.isFinite(n) && n > 0 ? n : 0
}

/** Empty string and missing are the same thing to every filter here. */
function param(searchParams: URLSearchParams, key: string): string | null {
    const v = searchParams.get(key)?.trim()
    return v ? v : null
}

export async function GET(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const { searchParams } = new URL(request.url)

    const limit = Math.min(
        MAX_LIMIT,
        Math.max(1, Number.parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    )
    const offset = parseCursor(searchParams.get('cursor'))

    // Postgres wants a real array; an empty one would exclude nothing but is
    // clearer sent as NULL, which the function treats as "no exclusions".
    const excludeStagesRaw = param(searchParams, 'excludeStages')
    const excludeStages = excludeStagesRaw
        ? excludeStagesRaw.split(',').map(s => s.trim()).filter(Boolean)
        : null

    const admin = createAdminClient()
    const { data, error } = await admin.rpc('search_cases', {
        // Scoping is decided HERE, from the authenticated session — never from
        // the request. The function is granted to service_role only for the same
        // reason: a caller who could set p_is_admin would read every case.
        p_viewer_id: auth.userId,
        p_is_admin: auth.isAdmin,
        p_search: param(searchParams, 'search'),
        p_stage: searchParams.get('stage') ?? 'active',
        p_case_type: param(searchParams, 'caseType'),
        p_agent: auth.isAdmin ? param(searchParams, 'agent') : null,
        p_from: param(searchParams, 'from'),
        p_to: param(searchParams, 'to'),
        p_month: param(searchParams, 'month'),
        p_include_drafts: searchParams.get('includeDrafts') === 'true',
        p_include_agent_name: auth.isAdmin,
        p_updated_since: param(searchParams, 'updatedSince'),
        p_exclude_stages: excludeStages,
        p_has_follow_up: searchParams.get('hasFollowUp') === 'true',
        p_follow_up_to: param(searchParams, 'followUpTo'),
        p_follow_up_after: param(searchParams, 'followUpAfter'),
        p_missing_follow_up: searchParams.get('missingFollowUp') === 'true',
        p_closed_month: param(searchParams, 'closedMonth'),
        p_lock_in_from: param(searchParams, 'lockInFrom'),
        p_lock_in_to: param(searchParams, 'lockInTo'),
        p_bucket: param(searchParams, 'bucket'),
        p_drafts_only: searchParams.get('draftsOnly') === 'true',
        // Set from the session, so a caller never has to know (or be trusted
        // with) its own user id to ask for "my cases".
        p_own_only: searchParams.get('mine') === 'true',
        // Both are whitelisted inside the function, so an unknown value falls
        // back to the default rather than erroring.
        p_sort: searchParams.get('sort') ?? 'updated_at',
        p_dir: searchParams.get('dir') ?? 'desc',
        p_limit: limit,
        p_offset: offset,
    })

    if (error) {
        console.error('[GET /api/insurance/cases]', error)
        return NextResponse.json({ error: 'Failed to fetch cases' }, { status: 500 })
    }

    const result = (data ?? { rows: [], total: 0, loan_volume: 0 }) as SearchCasesResult
    const rows = result.rows ?? []
    const total = result.total ?? 0
    const nextOffset = offset + rows.length

    return NextResponse.json({
        rows,
        total,
        loanVolume: Number(result.loan_volume ?? 0),
        agentShare: Number(result.agent_share ?? 0),
        nextCursor: nextOffset < total ? String(nextOffset) : null,
        // Travels with the list so a screen that renders admin-only columns does
        // not need a second round trip just to find out who it is talking to.
        isAdmin: auth.isAdmin,
    })
}

/**
 * POST /api/insurance/cases — "+ New Case": create one case from typed-in client
 * details (the Mortgage Planner remains the way to start from a workflow).
 *
 * Body: RawIntake fields (see lib/insurance/caseIntake.ts) + optional `force`.
 * Validation is the same validateIntake() the mass upload uses. A mobile the
 * agent already has returns 409 with the existing case, unless `force: true`.
 *
 * Inserted with the caller's own session (RLS: created_by = auth.uid()), so the
 * cases_protect_admin_fields trigger and every policy apply exactly as they do
 * to a browser write — this route adds validation, it never widens access.
 */
export async function POST(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    let body: RawIntake & { force?: boolean }
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const db = await createServerSupabaseClient()
    const banks = await loadBankNames(db)
    const result = validateIntake(body, banks, { requireLeadSource: true })
    if (!result.ok) return NextResponse.json({ error: result.errors.join('. '), errors: result.errors }, { status: 400 })

    if (!body.force) {
        const existing = (await ownMobileIndex(db, auth.userId)).get(mobileKey(result.value.client_mobile))
        if (existing) {
            return NextResponse.json(
                { error: 'duplicate', existing: { id: existing.id, name: existing.name } },
                { status: 409 },
            )
        }
    }

    const row = intakeToCaseRow(result.value, auth.userId)
    const { data, error } = await db
        .from('cases')
        .insert(row)
        .select('id')
        .single()

    if (error || !data) {
        console.error('[POST /api/insurance/cases]', error)
        return NextResponse.json({ error: 'Could not create the case' }, { status: 500 })
    }

    // Same calendar sync the follow-up button does, so a date set here behaves
    // identically. Never throws.
    if (row.follow_up_date) {
        await syncInsuranceFollowUp(
            auth.userId, data.id, 'upsert', row.follow_up_date,
            result.value.client_name, `${APP_URL}/insurance/dashboard/cases/${data.id}`, result.value.client_mobile,
        ).catch(err => console.error('[Calendar sync] new case:', err))
    }

    return NextResponse.json({ id: data.id })
}
