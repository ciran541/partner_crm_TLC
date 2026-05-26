import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePropertyUser } from '@/lib/auth/requirePropertyUser'
import { calculateCommission } from '@/lib/property/commission'
import { projectAtLockinMaturity } from '@/lib/property/amortization'
import { syncCaseToSheets } from '@/lib/services/sheets-sync'

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    const { id } = await params
    const admin = createAdminClient()

    const { data: caseData, error } = await admin
        .from('property_cases')
        .select('*, banks(id, name), property_case_documents(*), property_case_activity_logs(*)')
        .eq('id', id)
        .single()

    if (error || !caseData) {
        return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    if (!auth.isAdmin && (caseData as { agent_id: string }).agent_id !== auth.userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const raw = caseData as Record<string, unknown>
    const activityLogs = ((raw.property_case_activity_logs as { created_at: string }[]) ?? [])
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    // Generate signed URLs for each document (storage path → 1-hour signed URL)
    const rawDocs = (raw.property_case_documents as { file_url: string }[] | null) ?? []
    const documents = await Promise.all(
        rawDocs.map(async doc => {
            const { data: signed } = await admin.storage
                .from('property-documents')
                .createSignedUrl(doc.file_url, 3600)
            return { ...doc, file_url: signed?.signedUrl ?? doc.file_url }
        })
    )

    return NextResponse.json({
        data: {
            ...raw,
            documents,
            activity_logs: activityLogs,
            property_case_documents: undefined,
            property_case_activity_logs: undefined,
        },
    })
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    const { id } = await params
    const admin = createAdminClient()

    const { data: existing } = await admin
        .from('property_cases')
        .select('id, agent_id, status, outstanding_loan_amount, interest_rate, balance_tenure_months, lockin_estimated_date')
        .eq('id', id)
        .single()

    if (!existing) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    if (existing.agent_id !== auth.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!['draft', 'submitted'].includes(existing.status as string)) {
        return NextResponse.json({ error: 'This case can no longer be edited. Contact TLC if changes are needed.' }, { status: 409 })
    }

    const body = await request.json()
    const {
        case_type, client_name, client_mobile, client_email, property_address,
        bank_id, interest_rate, balance_tenure_months, outstanding_loan_amount, subsidy_amount,
        notes,
    } = body

    const update: Record<string, unknown> = {}
    if (case_type !== undefined) update.case_type = case_type
    if (client_name !== undefined) update.client_name = String(client_name).trim()
    if (client_mobile !== undefined) update.client_mobile = String(client_mobile).trim()
    if (client_email !== undefined) update.client_email = client_email ? String(client_email).trim() : null
    if (property_address !== undefined) update.property_address = String(property_address).trim()
    if (bank_id !== undefined) update.bank_id = bank_id || null
    if (interest_rate !== undefined) update.interest_rate = interest_rate ? Number(interest_rate) : null
    if (balance_tenure_months !== undefined) update.balance_tenure_months = balance_tenure_months ? Number(balance_tenure_months) : null
    if (outstanding_loan_amount !== undefined) update.outstanding_loan_amount = outstanding_loan_amount ? Number(outstanding_loan_amount) : null
    if (subsidy_amount !== undefined) update.subsidy_amount = subsidy_amount ? Number(subsidy_amount) : null
    if (notes !== undefined) update.notes = notes ? String(notes).trim() : null

    // Recalculate commission and projections from merged values
    const newLoan = outstanding_loan_amount !== undefined
        ? (outstanding_loan_amount ? Number(outstanding_loan_amount) : null)
        : (existing.outstanding_loan_amount as number | null)
    const newRate = interest_rate !== undefined
        ? (interest_rate ? Number(interest_rate) : null)
        : (existing.interest_rate as number | null)
    const newTenure = balance_tenure_months !== undefined
        ? (balance_tenure_months ? Number(balance_tenure_months) : null)
        : (existing.balance_tenure_months as number | null)

    if (newLoan != null && newLoan > 0) {
        const c = calculateCommission(newLoan)
        update.gross_commission_amount = c.gross
        update.agent_commission_amount = c.agent
        update.tlc_commission_amount = c.tlc
    } else if (outstanding_loan_amount !== undefined && !outstanding_loan_amount) {
        update.gross_commission_amount = null
        update.agent_commission_amount = null
        update.tlc_commission_amount = null
        update.projected_remaining_balance = null
        update.projected_gross_commission = null
        update.projected_agent_income = null
        update.projected_tlc_income = null
    }

    if (newLoan != null && newLoan > 0 && newRate != null && newTenure != null) {
        const proj = projectAtLockinMaturity({
            outstandingLoanAmount: newLoan,
            annualInterestRate: newRate,
            balanceTenureMonths: newTenure,
        })
        update.projected_remaining_balance = proj.projectedRemainingBalance
        update.projected_gross_commission = proj.projectedGrossCommission
        update.projected_agent_income = proj.projectedAgentIncome
        update.projected_tlc_income = proj.projectedTlcIncome
    }

    const { data: updated, error: updateError } = await admin
        .from('property_cases')
        .update(update)
        .eq('id', id)
        .select('*, banks(id, name)')
        .single()

    if (updateError) return NextResponse.json({ error: 'Failed to update case' }, { status: 500 })

    await admin.from('property_case_activity_logs').insert({
        case_id: id,
        actor_id: auth.userId,
        action: 'agent_edit',
        new_value: update,
    })

    const { data: agentProfile } = await admin
        .from('profiles')
        .select('full_name, name')
        .eq('id', auth.userId)
        .single()

    const u = updated as Record<string, unknown>
    syncCaseToSheets({
        id: u.id as string,
        agent_id: u.agent_id as string,
        agent_name: agentProfile?.full_name ?? agentProfile?.name ?? null,
        case_type: u.case_type as string,
        status: u.status as string,
        client_name: u.client_name as string,
        client_mobile: u.client_mobile as string,
        client_email: (u.client_email as string | null) ?? null,
        property_address: (u.property_address as string | null) ?? '',
        bank_name: (u.banks as { name: string } | null)?.name ?? null,
        interest_rate: (u.interest_rate as number | null) ?? null,
        balance_tenure_months: (u.balance_tenure_months as number | null) ?? null,
        outstanding_loan_amount: (u.outstanding_loan_amount as number | null) ?? null,
        subsidy_amount: (u.subsidy_amount as number | null) ?? null,
        lockin_estimated_date: (u.lockin_estimated_date as string | null) ?? null,
        lockin_confirmed_date: (u.lockin_confirmed_date as string | null) ?? null,
        gross_commission_amount: (u.gross_commission_amount as number | null) ?? null,
        agent_commission_amount: (u.agent_commission_amount as number | null) ?? null,
        tlc_commission_amount: (u.tlc_commission_amount as number | null) ?? null,
        commission_status: (u.commission_status as string) ?? 'pending',
        projected_remaining_balance: (u.projected_remaining_balance as number | null) ?? null,
        projected_gross_commission: (u.projected_gross_commission as number | null) ?? null,
        projected_agent_income: (u.projected_agent_income as number | null) ?? null,
        projected_tlc_income: (u.projected_tlc_income as number | null) ?? null,
        actual_recurring_gross: (u.actual_recurring_gross as number | null) ?? null,
        actual_recurring_agent_income: (u.actual_recurring_agent_income as number | null) ?? null,
        actual_recurring_tlc_income: (u.actual_recurring_tlc_income as number | null) ?? null,
        recurring_converted: (u.recurring_converted as boolean) ?? false,
        is_duplicate: (u.is_duplicate as boolean) ?? false,
        duplicate_reason: (u.duplicate_reason as string | null) ?? null,
        notes: (u.notes as string | null) ?? null,
        created_at: u.created_at as string,
        updated_at: u.updated_at as string,
    })

    return NextResponse.json({ data: updated })
}
