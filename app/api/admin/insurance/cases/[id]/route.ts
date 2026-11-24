import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { rpcError } from '@/lib/admin/rpcError'
import { CORRECTION_FEE } from '@/lib/insurance/commission'
import { isLeadSource } from '@/lib/insurance/leadSources'
import { closedWonTotals, loanSpecsFor, packageSummary } from '@/lib/insurance/closedWon'
import { getCurrentSora } from '@/lib/insurance/sora'
import { syncInsuranceFollowUp } from '@/lib/google/syncFollowUpInsurance'
import type { Case, CaseType, ClosedWonData } from '@/lib/types'
import type { RateScheduleEntry } from '@/lib/types/rates'

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date')
const text = (max: number) => z.string().trim().max(max).nullable()
const money = z.number().min(0).max(999_999_999).nullable()

const changes = z.strictObject({
    client_name: z.string().trim().min(1, 'Client name is required').max(200),
    client_mobile: text(50), client_email: text(200),
    lead_source: z.string().nullable().refine(v => v === null || isLeadSource(v), 'Invalid lead source'),
    lead_source_other: text(200),
    referred_bankers: z.array(z.object({ bank: z.string().max(100), name: z.string().max(100) })).max(20),
    follow_up_date: DATE, follow_up_remark: text(500), remarks: text(5000),
    case_type: z.enum(['Refinancing', 'Purchase', 'Decouple', 'Equity Loan', 'Divorce']),
    stage: z.enum(['Inactive', 'Touched Base', 'Pending Docs', 'Pending Approval', 'Pending Signature']),
    loan_size: money, existing_loan_amount: money, property_price: money,
    property_type: text(100), property_address: text(500), current_bank: text(100),
    lock_in_end_date: DATE.nullable(), subsidy_provided: text(500), clawback_end_date: DATE.nullable(),
    workflow_data: z.record(z.string(), z.unknown()),
}).partial()

const closing = z.strictObject({
    loans: z.array(z.object({
        kind: z.enum(['home', 'equity', 'refi_home', 'new_purchase_home']),
        amount: z.number().positive().max(999_999_999), tenure: z.number().int().positive().max(50),
    })).min(1, 'Enter at least one loan'),
    lockin_years: z.number().min(0).max(50),
    schedule: z.array(z.record(z.string(), z.unknown())).max(60),
    bank: z.string().trim().max(100),
    property_address: z.string().trim().max(500),
    lo_documents: z.array(z.object({ path: z.string(), name: z.string(), type: z.string(), uploaded_at: z.string().optional() })).max(30),
})

const schema = z.object({
    updated_at: z.string(),
    changes: changes.default({}),
    closing: closing.optional(),
    reason: z.string().max(2000).optional(),
    charge: z.boolean().default(false),
})

/**
 * PATCH /api/admin/insurance/cases/[id] — an admin fixes a case.
 *
 * Whitelisted fields only. Closing figures are recomputed here from the loans
 * (never taken from the browser) and merged into the existing closing record.
 * admin_edit_case() applies the rules and writes the log in one transaction.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const { id } = await context.params
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    const body = parsed.data
    const db = createAdminClient()
    const { data: before } = await db.from('cases').select('*').eq('id', id).single<Case>()
    if (!before) return NextResponse.json({ error: 'Case not found' }, { status: 404 })

    const out: Record<string, unknown> = { ...body.changes }
    if (out.lead_source !== undefined && out.lead_source !== 'others') out.lead_source_other = null

    const type = (out.case_type ?? before.case_type) as CaseType
    if (before.stage === 'Closed Won' && type !== before.case_type && !body.closing) {
        return NextResponse.json({ error: 'Check the closing loans when changing the type of a Closed Won case.' }, { status: 400 })
    }
    if (body.closing) {
        if (before.stage !== 'Closed Won') return NextResponse.json({ error: 'Only a Closed Won case has closing details.' }, { status: 400 })
        const c = body.closing
        const specs = loanSpecsFor(type)
        if (c.loans.some(l => !specs.some(s => s.kind === l.kind)) || new Set(c.loans.map(l => l.kind)).size !== c.loans.length
            || specs.some(s => s.required && !c.loans.some(l => l.kind === s.kind))) {
            return NextResponse.json({ error: `Those loans don’t match a ${type} case.` }, { status: 400 })
        }
        // A new document can only sit in this case's own folder.
        const prefix = `${before.created_by}/${id}/`
        const known = new Set((before.closed_won_data?.lo_documents ?? []).map(d => d.path))
        if (c.lo_documents.some(d => !known.has(d.path) && (!d.path.startsWith(prefix) || d.path.includes('..')))) {
            return NextResponse.json({ error: 'A document is stored in the wrong place. Upload it again.' }, { status: 400 })
        }
        const schedule = c.schedule as unknown as RateScheduleEntry[]
        const old = (before.closed_won_data ?? {}) as ClosedWonData
        const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
        const pick = (ls: { kind: string; amount: number; tenure: number }[]) => ls.map(l => [l.kind, l.amount, l.tenure])
        const termsChanged = !same(pick(c.loans), pick(old.loans ?? [])) || !same(schedule, old.package?.schedule ?? [])
            || c.lockin_years !== (old.package?.lockin_years ?? 0)
        // Only re-project when the terms changed: SORA moves daily, and fixing the
        // bank's name mustn't shift the next-cycle figure.
        const totals = termsChanged ? closedWonTotals(c.loans, schedule, c.lockin_years, await getCurrentSora()) : null
        const next: Record<string, unknown> = {
            ...old,
            loans: totals ? c.loans : old.loans,
            package: totals ? { ...old.package, lockin_years: c.lockin_years, schedule } : old.package,
            // A corrected lock-in length makes the confirmed end date wrong: back to the estimate.
            lock_in_end_date: c.lockin_years === (old.package?.lockin_years ?? 0) ? old.lock_in_end_date : undefined,
            lo_documents: c.lo_documents,
            bank: c.bank || undefined,
            property_address: c.property_address || undefined,
        }
        if (totals) {
            next.original_loan_total = totals.originalLoanTotal
            next.combined_outstanding = totals.combinedOutstanding ?? undefined
            const first = schedule.find(e => !e.thereafter)
            out.closed_package_details = packageSummary(schedule, c.lockin_years) || null
            out.closed_tenure = c.loans[0].tenure
            out.closed_interest_rate = first?.type === 'fixed' ? first.rate ?? null : null
        }
        out.closed_won_data = next
    }

    const { data, error } = await db.rpc('admin_edit_case', {
        p_case: id, p_actor: auth.userId, p_expected: body.updated_at, p_changes: out,
        p_reason: body.reason ?? null, p_fee: body.charge ? CORRECTION_FEE : 0, p_reopen: false,
    })
    if (error) return rpcError('admin edit case', error, 'Could not save the changes.')
    const saved = data as Case
    if (saved.follow_up_date !== before.follow_up_date || saved.client_name !== before.client_name) {
        await syncInsuranceFollowUp(
            saved.created_by, id, saved.follow_up_date ? 'upsert' : 'delete', saved.follow_up_date ?? null, saved.client_name,
            `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/insurance/dashboard/cases/${id}`, saved.client_mobile,
        ).catch(err => console.error('[Calendar sync] admin edit:', err))
    }
    return NextResponse.json(saved)
}
