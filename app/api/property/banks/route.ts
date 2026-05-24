import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePropertyUser } from '@/lib/auth/requirePropertyUser'

export async function GET() {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    const admin = createAdminClient()
    const { data, error } = await admin
        .from('banks')
        .select('id, name')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

    if (error) {
        return NextResponse.json({ error: 'Failed to fetch banks' }, { status: 500 })
    }

    return NextResponse.json({ data: data ?? [] })
}
