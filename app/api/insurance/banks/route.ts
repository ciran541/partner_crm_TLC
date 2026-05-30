import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance } from '@/lib/permissions'

export async function GET() {
    const { user, profile } = await getServerUser()

    if (!user || !profile || !canAccessInsurance(profile.role, profile.app_type)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin
        .from('banks')
        .select('id, name')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

    if (error) {
        return NextResponse.json({ error: 'Failed to fetch banks' }, { status: 500 })
    }

    return NextResponse.json(
        { data: data ?? [] },
        { headers: { 'Cache-Control': 'private, max-age=300' } }
    )
}
