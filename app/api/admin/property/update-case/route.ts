import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import type { PropertyCaseStatus, PropertyCommissionStatus } from '@/lib/types/property'

interface UpdatePropertyCaseInput {
    id: string
    status?: PropertyCaseStatus
    lockin_confirmed_date?: string | null
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
        .select('status, lockin_confirmed_date, commission_status')
        .eq('id', id)
        .single()

    if (!oldCase) {
        return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    // Build update payload — only include explicitly provided fields
    const payload: Record<string, unknown> = {}
    if (updates.status !== undefined) payload.status = updates.status
    if (updates.lockin_confirmed_date !== undefined) payload.lockin_confirmed_date = updates.lockin_confirmed_date
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
        .select('*')
        .single()

    if (error || !updated) {
        console.error('Property case update error:', error)
        return NextResponse.json({ error: 'Failed to update case' }, { status: 500 })
    }

    // Determine the most descriptive action name for the log
    let action = 'admin_update'
    if (updates.status !== undefined && updates.status !== oldCase.status) {
        action = 'status_changed'
    } else if (updates.lockin_confirmed_date) {
        action = 'lockin_confirmed'
    } else if (updates.commission_status !== undefined && updates.commission_status !== oldCase.commission_status) {
        action = 'commission_updated'
    }

    // Auto-create 90-day reminder when lockin_confirmed_date is newly set or changed
    if (updates.lockin_confirmed_date !== undefined) {
        const oldDate = oldCase.lockin_confirmed_date as string | null
        const newDate = updates.lockin_confirmed_date
        if (newDate !== oldDate) {
            await admin.from('property_reminders').delete().eq('case_id', id).eq('is_sent', false)
            if (newDate) {
                const trigger = new Date(newDate)
                trigger.setDate(trigger.getDate() - 90)
                await admin.from('property_reminders').insert({
                    case_id: id,
                    reminder_type: 'lockin_90_day',
                    trigger_date: trigger.toISOString().split('T')[0],
                })
            }
        }
    }

    await admin.from('property_case_activity_logs').insert({
        case_id: id,
        actor_id: auth.userId,
        action,
        old_value: { status: oldCase.status, lockin_confirmed_date: oldCase.lockin_confirmed_date, commission_status: oldCase.commission_status },
        new_value: payload,
    })

    return NextResponse.json({ data: updated })
}
