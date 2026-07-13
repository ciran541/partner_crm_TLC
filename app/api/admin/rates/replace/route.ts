import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { deriveFirstYearRate } from '@/lib/insurance/rateSchedule'
import { invalidatePackagesCache } from '@/lib/insurance/ratesCache'
import type { MortgagePackageInput } from '@/lib/types/rates'

// POST /api/admin/rates/replace  { bank, categories: string[], packages: MortgagePackageInput[] }
// Atomically replaces a bank's packages WITHIN the given categories with the
// reviewed set (via the replace_bank_packages SQL function — single transaction).
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const { bank, categories, packages } = await request.json().catch(() => ({}))

    if (!bank?.trim()) return NextResponse.json({ error: 'Missing bank' }, { status: 400 })
    if (!Array.isArray(categories) || categories.length === 0) {
        return NextResponse.json({ error: 'Select at least one category to replace' }, { status: 400 })
    }
    if (!Array.isArray(packages)) {
        return NextResponse.json({ error: 'Missing packages' }, { status: 400 })
    }

    // Every package must fall within the chosen replace scope (safety: the wipe
    // only deletes these categories, so inserting outside them would orphan rows).
    const outOfScope = packages.find((p: MortgagePackageInput) => !categories.includes(p.category))
    if (outOfScope) {
        return NextResponse.json({ error: `Package "${outOfScope.package_name}" is "${outOfScope.category}", outside the selected categories.` }, { status: 400 })
    }

    // Shape rows for the SQL function; force bank to the admin's choice, derive sort key.
    const rows = packages.map((p: MortgagePackageInput) => ({
        property_type: p.property_type,
        category: p.category,
        min_loan_size: Number(p.min_loan_size) || 0,
        package_name: p.package_name,
        lockin_years: Number(p.lockin_years) || 0,
        rate_schedule: p.rate_schedule ?? [],
        first_year_rate: deriveFirstYearRate(p.rate_schedule ?? []),
        features: p.features ?? [],
        subsidies: p.subsidies?.trim() || null,
        remarks: p.remarks?.trim() || null,
        min_loan_note: p.min_loan_note?.trim() || null,
        status: p.status ?? 'published',
    }))

    const admin = createAdminClient()
    const { data, error } = await admin.rpc('replace_bank_packages', {
        p_bank: bank,
        p_categories: categories,
        p_packages: rows,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    invalidatePackagesCache()
    return NextResponse.json({ success: true, inserted: data ?? rows.length })
}
