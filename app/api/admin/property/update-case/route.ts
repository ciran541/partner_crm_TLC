import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import type { PropertyCaseStatus, PropertyCommissionStatus } from '@/lib/types/property'
import { syncCaseToSheets } from '@/lib/services/sheets-sync'
import { syncFollowUpToCalendar } from '@/lib/google/syncFollowUp'

interface UpdatePropertyCaseInput {
    id: string
    status?: PropertyCaseStatus
    follow_up_date?: string | null
    commission_status?: PropertyCommissionStatus
    gross_commission_amount?: number | null
    agent_commission_amount?: number | null
    tlc_commission_amount?: number | null
    notes?: string | null
    recurring_converted?: boolean
}

export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    let body: UpdatePropertyCaseInput
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'Case ID is required' }, { status: 400 })

    const admin = createAdminClient()

    // Fetch existing values for the activity log diff
    const { data: oldCase } = await admin
        .from('property_cases')
        .select('status, commission_status')
        .eq('id', id)
        .single()

    if (!oldCase) {
        return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    // Build update payload — only include explicitly provided fields
    const payload: Record<string, unknown> = {}
    if (updates.status !== undefined) payload.status = updates.status
    if (updates.follow_up_date !== undefined) payload.follow_up_date = updates.follow_up_date
    if (updates.commission_status !== undefined) payload.commission_status = updates.commission_status
    if (updates.gross_commission_amount !== undefined) payload.gross_commission_amount = updates.gross_commission_amount
    if (updates.agent_commission_amount !== undefined) payload.agent_commission_amount = updates.agent_commission_amount
    if (updates.tlc_commission_amount !== undefined) payload.tlc_commission_amount = updates.tlc_commission_amount
    if (updates.notes !== undefined) payload.notes = updates.notes
    if (updates.recurring_converted !== undefined) payload.recurring_converted = updates.recurring_converted

    if (Object.keys(payload).length === 0) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const { data: updated, error } = await admin
        .from('property_cases')
        .update(payload)
        .eq('id', id)
        .select('*, banks(id, name)')
        .single()

    if (error || !updated) {
        console.error('Property case update error:', error)
        return NextResponse.json({ error: 'Failed to update case' }, { status: 500 })
    }

    // Determine the most descriptive action name for the log
    let action = 'admin_update'
    if (updates.status !== undefined && updates.status !== oldCase.status) {
        action = 'status_changed'
    } else if (updates.commission_status !== undefined && updates.commission_status !== oldCase.commission_status) {
        action = 'commission_updated'
    }

    await admin.from('property_case_activity_logs').insert({
        case_id: id,
        actor_id: auth.userId,
        action,
        old_value: { status: oldCase.status, commission_status: oldCase.commission_status },
        new_value: payload,
    })

    // Re-sync calendar when follow_up_date is explicitly changed
    if (updates.follow_up_date !== undefined) {
        const u2 = updated as Record<string, unknown>
        const newDate = u2.follow_up_date as string | null
        const preference = u2.followup_preference as 'self' | 'tlc' | null
        if (newDate && preference) {
            syncFollowUpToCalendar(
                u2.agent_id as string,
                id,
                preference,
                'upsert',
                newDate,
                u2.client_name as string,
                `${process.env.NEXT_PUBLIC_APP_URL}/property/cases/${id}`
            ).catch(err => console.error('[Calendar sync] admin date change:', err))
        }
    }

    const { data: agentProfile } = await admin
        .from('profiles')
        .select('full_name, name')
        .eq('id', (updated as { agent_id: string }).agent_id)
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
