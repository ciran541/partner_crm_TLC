import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import type { SheetsCasePayload } from '@/lib/services/sheets-sync'

export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    let body: { cases: SheetsCasePayload[]; _secret: string }
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const secret = process.env.APPS_SCRIPT_SECRET
    if (!secret || body._secret !== secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!Array.isArray(body.cases) || body.cases.length === 0) {
        return NextResponse.json({ error: 'No cases provided' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Resolve bank names to IDs
    const bankNames = [...new Set(body.cases.map(c => c.bank_name).filter(Boolean))] as string[]
    let bankNameToId: Record<string, string> = {}
    if (bankNames.length > 0) {
        const { data: banks } = await admin
            .from('banks')
            .select('id, name')
            .in('name', bankNames)
        if (banks) {
            bankNameToId = Object.fromEntries(banks.map(b => [b.name, b.id]))
        }
    }

    // Process in batches of 50
    const BATCH = 50
    let inserted = 0
    let updated = 0
    const errors: string[] = []

    for (let i = 0; i < body.cases.length; i += BATCH) {
        const batch = body.cases.slice(i, i + BATCH)
        const rows = batch.map(c => ({
            id: c.id,
            agent_id: c.agent_id,
            case_type: c.case_type,
            status: c.status,
            client_name: c.client_name,
            client_mobile: c.client_mobile,
            client_email: c.client_email || null,
            property_address: c.property_address || null,
            bank_id: c.bank_name ? (bankNameToId[c.bank_name] ?? null) : null,
            interest_rate: c.interest_rate ?? null,
            balance_tenure_months: c.balance_tenure_months ?? null,
            outstanding_loan_amount: c.outstanding_loan_amount ?? null,
            subsidy_amount: c.subsidy_amount ?? null,
            lockin_estimated_date: c.lockin_estimated_date || null,
            lockin_confirmed_date: c.lockin_confirmed_date || null,
            gross_commission_amount: c.gross_commission_amount ?? null,
            agent_commission_amount: c.agent_commission_amount ?? null,
            tlc_commission_amount: c.tlc_commission_amount ?? null,
            commission_status: c.commission_status || 'pending',
            projected_remaining_balance: c.projected_remaining_balance ?? null,
            projected_gross_commission: c.projected_gross_commission ?? null,
            projected_agent_income: c.projected_agent_income ?? null,
            projected_tlc_income: c.projected_tlc_income ?? null,
            actual_recurring_gross: c.actual_recurring_gross ?? null,
            actual_recurring_agent_income: c.actual_recurring_agent_income ?? null,
            actual_recurring_tlc_income: c.actual_recurring_tlc_income ?? null,
            recurring_converted: c.recurring_converted ?? false,
            is_duplicate: c.is_duplicate ?? false,
            duplicate_reason: c.duplicate_reason || null,
            notes: c.notes || null,
            created_at: c.created_at,
            updated_at: c.updated_at,
        }))

        const { error, data } = await admin
            .from('property_cases')
            .upsert(rows, { onConflict: 'id', ignoreDuplicates: false })
            .select('id')

        if (error) {
            console.error('[restore-from-sheets] batch error:', error)
            errors.push(`Batch ${i / BATCH + 1}: ${error.message}`)
        } else {
            // Upsert doesn't distinguish inserts from updates — count as updated for safety
            updated += data?.length ?? 0
        }
    }

    return NextResponse.json({ inserted, updated, errors, total: body.cases.length })
}
