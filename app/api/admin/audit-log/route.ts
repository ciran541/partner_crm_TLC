import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'

export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const supabaseAdmin = createAdminClient()
    const { data, error } = await supabaseAdmin
        .from('admin_audit_log')
        .select('*, actor:profiles!admin_audit_log_actor_id_fkey(name)')
        .order('created_at', { ascending: false })
        .limit(200)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}
