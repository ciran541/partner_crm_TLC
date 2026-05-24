import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePropertyUser } from '@/lib/auth/requirePropertyUser'
import { calculateCommission } from '@/lib/property/commission'
import { projectAtLockinMaturity } from '@/lib/property/amortization'
import { isAdmin } from '@/lib/permissions'
import type { CreatePropertyCaseInput } from '@/lib/types/property'

export async function GET(request: Request) {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const case_type = searchParams.get('case_type')
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
    const offset = (page - 1) * limit

    const admin = createAdminClient()

    const { data: profile } = await admin
        .from('profiles')
        .select('role')
        .eq('id', auth.userId)
        .single()

    const userIsAdmin = profile ? isAdmin(profile.role as 'admin' | 'super_admin' | 'agent') : false

    let query = admin
        .from('property_cases')
        .select('*, banks(id, name)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

    if (!userIsAdmin) {
        query = query.eq('agent_id', auth.userId)
    }
    if (status) query = query.eq('status', status)
    if (case_type) query = query.eq('case_type', case_type)

    const { data: cases, error, count } = await query

    if (error) {
        console.error('Cases GET error:', error)
        return NextResponse.json({ error: 'Failed to fetch cases' }, { status: 500 })
    }

    // For admin: enrich each case with the agent's display name
    let agentMap: Record<string, string | null> = {}
    if (userIsAdmin && cases && cases.length > 0) {
        const agentIds = [...new Set((cases as { agent_id: string }[]).map(c => c.agent_id))]
        const { data: profiles } = await admin
            .from('profiles')
            .select('id, name, full_name')
            .in('id', agentIds)
        if (profiles) {
            agentMap = Object.fromEntries(
                profiles.map(p => [p.id, p.full_name ?? p.name ?? null])
            )
        }
    }

    const enriched = (cases ?? []).map(c => ({
        ...c,
        ...(userIsAdmin ? { agent_name: agentMap[(c as { agent_id: string }).agent_id] ?? null } : {}),
    }))

    return NextResponse.json({ data: enriched, count: count ?? 0, page, limit, is_admin: userIsAdmin })
}

export async function POST(request: Request) {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    const admin = createAdminClient()

    const { data: profile } = await admin
        .from('profiles')
        .select('role')
        .eq('id', auth.userId)
        .single()

    if (!profile || isAdmin(profile.role as 'admin' | 'super_admin' | 'agent')) {
        return NextResponse.json({ error: 'Only agents can submit cases' }, { status: 403 })
    }

    let body: CreatePropertyCaseInput
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const {
        case_type, client_name, client_mobile, client_email,
        property_address, bank_id, interest_rate, balance_tenure_months,
        outstanding_loan_amount, subsidy_amount, notes,
    } = body

    const errors: Record<string, string> = {}
    if (!case_type) errors.case_type = 'Case type is required'
    if (!client_name?.trim()) errors.client_name = 'Client name is required'
    if (!client_mobile?.trim()) errors.client_mobile = 'Client mobile is required'
    if (!property_address?.trim()) errors.property_address = 'Property address is required'

    if (Object.keys(errors).length > 0) {
        return NextResponse.json({ error: 'Validation failed', fields: errors }, { status: 400 })
    }

    const commissionData: Record<string, number> = {}
    if (outstanding_loan_amount) {
        const c = calculateCommission(outstanding_loan_amount)
        commissionData.gross_commission_amount = c.gross
        commissionData.agent_commission_amount = c.agent
        commissionData.tlc_commission_amount = c.tlc
    }

    const projectionData: Record<string, number> = {}
    if (outstanding_loan_amount && interest_rate && balance_tenure_months) {
        const p = projectAtLockinMaturity({
            outstandingLoanAmount: outstanding_loan_amount,
            annualInterestRate: interest_rate,
            balanceTenureMonths: balance_tenure_months,
        })
        projectionData.projected_remaining_balance = p.projectedRemainingBalance
        projectionData.projected_gross_commission = p.projectedGrossCommission
        projectionData.projected_agent_income = p.projectedAgentIncome
        projectionData.projected_tlc_income = p.projectedTlcIncome
    }

    const { data: newCase, error: insertError } = await admin
        .from('property_cases')
        .insert({
            agent_id: auth.userId,
            case_type,
            status: 'submitted',
            client_name: client_name.trim(),
            client_mobile: client_mobile.trim(),
            client_email: client_email?.trim() || null,
            property_address: property_address.trim(),
            bank_id: bank_id || null,
            interest_rate: interest_rate ?? null,
            balance_tenure_months: balance_tenure_months ?? null,
            outstanding_loan_amount: outstanding_loan_amount ?? null,
            subsidy_amount: subsidy_amount ?? null,
            notes: notes?.trim() || null,
            ...commissionData,
            ...projectionData,
        })
        .select('*, banks(id, name)')
        .single()

    if (insertError || !newCase) {
        console.error('Case insert error:', insertError)
        return NextResponse.json({ error: 'Failed to create case' }, { status: 500 })
    }

    await admin.from('property_case_activity_logs').insert({
        case_id: newCase.id,
        actor_id: auth.userId,
        action: 'case_submitted',
        new_value: { status: 'submitted', case_type },
    })

    return NextResponse.json({ data: newCase }, { status: 201 })
}
