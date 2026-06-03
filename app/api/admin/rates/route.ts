import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { deriveFirstYearRate } from '@/lib/insurance/rateSchedule'
import type { MortgagePackageInput, RateScheduleEntry } from '@/lib/types/rates'

// Admin CRUD for mortgage rate packages. Guarded by requireAdminUser().
//   POST   { input }                 → create
//   POST   { duplicateId }           → clone an existing package as a draft copy
//   PATCH  { id, input }             → update
//   DELETE ?id=                      → delete

function toRow(input: MortgagePackageInput) {
    const schedule = (input.rate_schedule ?? []) as RateScheduleEntry[]
    return {
        bank: input.bank,
        property_type: input.property_type,
        category: input.category,
        min_loan_size: Number(input.min_loan_size) || 0,
        package_name: input.package_name,
        lockin_years: Number(input.lockin_years) || 0,
        rate_schedule: schedule,
        first_year_rate: deriveFirstYearRate(schedule),
        features: input.features ?? [],
        subsidies: input.subsidies?.trim() || null,
        remarks: input.remarks?.trim() || null,
        status: input.status ?? 'published',
        last_updated: new Date().toISOString().slice(0, 10),
    }
}

export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const admin = createAdminClient()
    const body = await request.json().catch(() => ({}))

    // Duplicate path
    if (body?.duplicateId) {
        const { data: orig, error: fErr } = await admin
            .from('mortgage_packages').select('*').eq('id', body.duplicateId).single()
        if (fErr || !orig) return NextResponse.json({ error: 'Package not found' }, { status: 404 })

        const { id, created_at, updated_at, ...rest } = orig
        const clone = {
            ...rest,
            package_name: `${orig.package_name} (Copy)`,
            status: 'draft',
            last_updated: new Date().toISOString().slice(0, 10),
        }
        const { data, error } = await admin.from('mortgage_packages').insert(clone).select().single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ data })
    }

    const input = body?.input as MortgagePackageInput | undefined
    if (!input?.bank || !input?.package_name) {
        return NextResponse.json({ error: 'Bank and package name are required' }, { status: 400 })
    }

    const { data, error } = await admin.from('mortgage_packages').insert(toRow(input)).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data })
}

export async function PATCH(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const body = await request.json().catch(() => ({}))
    const { id, input } = body as { id?: string; input?: MortgagePackageInput }
    if (!id || !input) return NextResponse.json({ error: 'Missing id or input' }, { status: 400 })

    const admin = createAdminClient()
    const { data, error } = await admin
        .from('mortgage_packages').update(toRow(input)).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data })
}

export async function DELETE(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const admin = createAdminClient()
    const { error } = await admin.from('mortgage_packages').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
}
