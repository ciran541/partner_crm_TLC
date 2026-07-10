import { createAdminClient } from '@/lib/supabase/admin'

interface LogAdminActionParams {
    actorId: string
    action: string
    targetType?: string
    targetId?: string
    details?: Record<string, unknown>
}

/**
 * Records an admin action (user create/update, password reset, invite
 * create/revoke) for later review at /admin/audit-log. Never throws —
 * a logging failure shouldn't fail the admin action itself.
 */
export async function logAdminAction(params: LogAdminActionParams): Promise<void> {
    try {
        const supabaseAdmin = createAdminClient()
        await supabaseAdmin.from('admin_audit_log').insert({
            actor_id: params.actorId,
            action: params.action,
            target_type: params.targetType ?? null,
            target_id: params.targetId ?? null,
            details: params.details ?? {},
        })
    } catch (error) {
        console.error('Failed to write admin audit log entry:', error)
    }
}
