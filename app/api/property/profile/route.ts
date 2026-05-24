import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePropertyUser } from '@/lib/auth/requirePropertyUser'
import type { UpdatePropertyProfileInput } from '@/lib/types/property'

export async function GET() {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    const admin = createAdminClient()

    const { data: profile, error } = await admin
        .from('profiles')
        .select('id, name, role, app_type, status, created_at, full_name, mobile, cea_registration_no, agency_name, joined_at')
        .eq('id', auth.userId)
        .single()

    if (error || !profile) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Fetch email from auth.users
    const { data: authUser } = await admin.auth.admin.getUserById(auth.userId)

    return NextResponse.json({
        data: {
            ...profile,
            email: authUser?.user?.email ?? null,
        },
    })
}

export async function POST(request: Request) {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    let body: UpdatePropertyProfileInput
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { full_name, mobile, cea_registration_no, agency_name } = body

    // Validate required fields
    const errors: Record<string, string> = {}
    if (!full_name?.trim()) errors.full_name = 'Full name is required'
    if (!mobile?.trim()) errors.mobile = 'Mobile number is required'
    if (!cea_registration_no?.trim()) errors.cea_registration_no = 'CEA registration number is required'

    if (Object.keys(errors).length > 0) {
        return NextResponse.json({ error: 'Validation failed', fields: errors }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: updated, error } = await admin
        .from('profiles')
        .update({
            full_name: full_name.trim(),
            mobile: mobile.trim(),
            cea_registration_no: cea_registration_no.trim(),
            agency_name: agency_name?.trim() ?? null,
        })
        .eq('id', auth.userId)
        .select('id, name, role, app_type, status, created_at, full_name, mobile, cea_registration_no, agency_name, joined_at')
        .single()

    if (error || !updated) {
        console.error('Profile update error:', error)
        return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
    }

    const { data: authUser } = await admin.auth.admin.getUserById(auth.userId)

    return NextResponse.json({
        data: {
            ...updated,
            email: authUser?.user?.email ?? null,
        },
    })
}
