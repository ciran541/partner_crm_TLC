import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePropertyUser } from '@/lib/auth/requirePropertyUser'
import { calculateCommission } from '@/lib/property/commission'
import { projectAtLockinMaturity } from '@/lib/property/amortization'
import type { CreatePropertyCaseInput } from '@/lib/types/property'
import { syncCaseToSheets } from '@/lib/services/sheets-sync'
import { syncFollowUpToCalendar } from '@/lib/google/syncFollowUp'

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
    const userIsAdmin = auth.isAdmin

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

    if (auth.isAdmin) {
        return NextResponse.json({ error: 'Only agents can submit cases' }, { status: 403 })
    }

    const admin = createAdminClient()

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
        followup_preference, letter_of_offer_date, lock_in_period,
        case_category, banker_name, property_type,
        package_type, free_conversion, fixed_years,
        floating_rate_type,
    } = body as Record<string, unknown> & typeof body

    const year_rates = (body as any).year_rates as string[] | undefined

    const errors: Record<string, string> = {}
    if (!case_type) errors.case_type = 'Case type is required'
    if (!client_name?.trim()) errors.client_name = 'Client name is required'
    if (!client_mobile?.trim()) errors.client_mobile = 'Client mobile is required'

    if (Object.keys(errors).length > 0) {
        return NextResponse.json({ error: 'Validation failed', fields: errors }, { status: 400 })
    }

    // Derive a single interest rate: prefer explicit value, fall back to first year rate
    const derived_interest_rate: number | undefined =
        interest_rate != null
            ? Number(interest_rate)
            : (year_rates && year_rates.length > 0 ? parseFloat(year_rates[0]) || undefined : undefined)

    const commissionData: Record<string, number> = {}
    if (outstanding_loan_amount) {
        const c = calculateCommission(outstanding_loan_amount)
        commissionData.gross_commission_amount = c.gross
        commissionData.agent_commission_amount = c.agent
        commissionData.tlc_commission_amount = c.tlc
    }

    const lockInPeriodNum = lock_in_period ? Number(lock_in_period) : undefined

    const projectionData: Record<string, number> = {}
    if (outstanding_loan_amount && derived_interest_rate && balance_tenure_months) {
        const p = projectAtLockinMaturity({
            outstandingLoanAmount: outstanding_loan_amount,
            annualInterestRate: derived_interest_rate,
            balanceTenureMonths: balance_tenure_months,
            ...(lockInPeriodNum ? { lockinMaturityMonths: lockInPeriodNum * 12 } : {}),
        })
        projectionData.projected_remaining_balance = p.projectedRemainingBalance
        projectionData.projected_gross_commission = p.projectedGrossCommission
        projectionData.projected_agent_income = p.projectedAgentIncome
        projectionData.projected_tlc_income = p.projectedTlcIncome
    }

    // Compute follow-up date: LOO + lock_in_years − 2 months.
    // Day is set to 1 before the month arithmetic, then restored clamped to
    // the resulting month's last valid day — without this, e.g. an LOO of
    // Jan 31 silently overflows to Dec 1 instead of Nov 30, since November
    // only has 30 days and JS's Date.setMonth rolls overflow into the next
    // month rather than clamping.
    let follow_up_date: string | null = null
    if (letter_of_offer_date && lock_in_period) {
        const d = new Date(letter_of_offer_date as string)
        const targetDay = d.getDate()
        d.setDate(1)
        d.setFullYear(d.getFullYear() + Number(lock_in_period))
        d.setMonth(d.getMonth() - 2)
        const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
        d.setDate(Math.min(targetDay, lastDayOfMonth))
        follow_up_date = d.toISOString().split('T')[0]
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
            property_address: property_address?.trim() || null,
            bank_id: bank_id || null,
            interest_rate: derived_interest_rate ?? null,
            lock_in_period: lockInPeriodNum ?? null,
            balance_tenure_months: balance_tenure_months ?? null,
            outstanding_loan_amount: outstanding_loan_amount ?? null,
            subsidy_amount: subsidy_amount ?? null,
            notes: notes?.trim() || null,
            followup_preference: (followup_preference as string) || null,
            follow_up_date,
            case_category: (case_category as string) || null,
            banker_name: (banker_name as string) || null,
            property_type: (property_type as string) || null,
            package_type: (package_type as string) || null,
            free_conversion: free_conversion != null ? Number(free_conversion) : null,
            fixed_years: fixed_years != null ? Number(fixed_years) : null,
            floating_rate_type: (floating_rate_type as string) || null,
            year_rates: year_rates ?? null,
            letter_of_offer_date: (letter_of_offer_date as string) || null,
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

    // Sync follow-up date to Google Calendar (non-blocking)
    if (follow_up_date && followup_preference) {
        syncFollowUpToCalendar(
            auth.userId,
            newCase.id,
            followup_preference as 'self' | 'tlc',
            'upsert',
            follow_up_date,
            client_name,
            `${process.env.NEXT_PUBLIC_APP_URL}/property/cases/${newCase.id}`,
            client_mobile
        ).catch(err => console.error('[Calendar sync] case creation:', err))
    }

    const { data: agentProfile } = await admin
        .from('profiles')
        .select('full_name, name')
        .eq('id', auth.userId)
        .single()

    const c = newCase as Record<string, unknown>
    syncCaseToSheets({
        id: newCase.id,
        agent_id: newCase.agent_id,
        agent_name: agentProfile?.full_name ?? agentProfile?.name ?? null,
        case_type: newCase.case_type,
        status: newCase.status,
        client_name: newCase.client_name,
        client_mobile: newCase.client_mobile,
        client_email: (c.client_email as string | null) ?? null,
        property_address: (c.property_address as string | null) ?? '',
        bank_name: (newCase.banks as { name: string } | null)?.name ?? null,
        interest_rate: (c.interest_rate as number | null) ?? null,
        balance_tenure_months: (c.balance_tenure_months as number | null) ?? null,
        outstanding_loan_amount: (c.outstanding_loan_amount as number | null) ?? null,
        subsidy_amount: (c.subsidy_amount as number | null) ?? null,
        lockin_estimated_date: (c.lockin_estimated_date as string | null) ?? null,
        lockin_confirmed_date: (c.lockin_confirmed_date as string | null) ?? null,
        gross_commission_amount: (c.gross_commission_amount as number | null) ?? null,
        agent_commission_amount: (c.agent_commission_amount as number | null) ?? null,
        tlc_commission_amount: (c.tlc_commission_amount as number | null) ?? null,
        commission_status: (c.commission_status as string) ?? 'pending',
        projected_remaining_balance: (c.projected_remaining_balance as number | null) ?? null,
        projected_gross_commission: (c.projected_gross_commission as number | null) ?? null,
        projected_agent_income: (c.projected_agent_income as number | null) ?? null,
        projected_tlc_income: (c.projected_tlc_income as number | null) ?? null,
        actual_recurring_gross: (c.actual_recurring_gross as number | null) ?? null,
        actual_recurring_agent_income: (c.actual_recurring_agent_income as number | null) ?? null,
        actual_recurring_tlc_income: (c.actual_recurring_tlc_income as number | null) ?? null,
        recurring_converted: (c.recurring_converted as boolean) ?? false,
        is_duplicate: (c.is_duplicate as boolean) ?? false,
        duplicate_reason: (c.duplicate_reason as string | null) ?? null,
        notes: (c.notes as string | null) ?? null,
        created_at: newCase.created_at,
        updated_at: newCase.updated_at,
    })

    return NextResponse.json({ data: newCase }, { status: 201 })
}
