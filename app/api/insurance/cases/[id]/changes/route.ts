import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'

/** GET — what TLC changed on this case. The case's owner and admins only. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response
    const { id } = await params
    const db = createAdminClient()
    const { data: c } = await db.from('cases').select('created_by').eq('id', id).maybeSingle()
    if (!c || (c.created_by !== auth.userId && !auth.isAdmin)) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    const { data, error } = await db.from('insurance_case_activity_logs')
        .select('id, new_value, created_at').eq('case_id', id).eq('action', 'admin_edit')
        .order('created_at', { ascending: false }).limit(100)
    if (error) return NextResponse.json({ error: 'Could not load changes.' }, { status: 500 })
    return NextResponse.json({ rows: data ?? [] })
}
