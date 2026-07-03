import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'

export async function POST(request: Request) {
    // 🔒 Server-side admin guard — verifies caller is authenticated admin
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    try {
        const { id, updates } = await request.json()

        if (!id) {
            return NextResponse.json({ error: 'Missing case ID' }, { status: 400 })
        }

        const supabaseAdmin = createAdminClient()

        // Snapshot the fields we audit before the write, so we can log real changes.
        const { data: before } = await supabaseAdmin
            .from('cases')
            .select('stage, commission_status')
            .eq('id', id)
            .single()

        const { data, error } = await supabaseAdmin
            .from('cases')
            .update(updates)
            .eq('id', id)
            .select()
            .single()

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        // Audit trail — record admin changes to stage / commission payout status.
        const logs: { case_id: string; actor_id: string; action: string; old_value: unknown; new_value: unknown }[] = []
        if (before) {
            if ('stage' in updates && updates.stage !== before.stage) {
                logs.push({ case_id: id, actor_id: auth.userId, action: 'stage_change', old_value: before.stage, new_value: updates.stage })
            }
            if ('commission_status' in updates && updates.commission_status !== before.commission_status) {
                logs.push({ case_id: id, actor_id: auth.userId, action: 'commission_status_change', old_value: before.commission_status, new_value: updates.commission_status })
            }
        }
        if (logs.length) {
            await supabaseAdmin.from('insurance_case_activity_logs').insert(logs)
        }

        return NextResponse.json(data)
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
