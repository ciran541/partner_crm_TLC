import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'

/**
 * GET /api/admin/insurance/case-activity?caseId=...
 * Returns the audit trail for an insurance case (admin only; the table is
 * service-role-only, so reads must go through here).
 */
export async function GET(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const caseId = new URL(request.url).searchParams.get('caseId')
    if (!caseId) return NextResponse.json({ error: 'Missing caseId' }, { status: 400 })

    const admin = createAdminClient()
    const { data: logs, error } = await admin
        .from('insurance_case_activity_logs')
        .select('id, action, old_value, new_value, actor_id, created_at')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Attach actor names.
    const actorIds = [...new Set((logs ?? []).map(l => l.actor_id))]
    const nameById = new Map<string, string>()
    if (actorIds.length) {
        const { data: profiles } = await admin.from('profiles').select('id, name').in('id', actorIds)
        profiles?.forEach(p => nameById.set(p.id, p.name ?? 'Unknown'))
    }

    return NextResponse.json((logs ?? []).map(l => ({ ...l, actor_name: nameById.get(l.actor_id) ?? 'Unknown' })))
}
