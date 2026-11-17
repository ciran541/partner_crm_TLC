import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Profile } from '@/lib/types/shared'

/**
 * Server-side helper: fetch the authenticated user and their profile.
 * Use in API routes and Server Components.
 * Returns { user: null, profile: null } if not authenticated OR if the
 * account is disabled (profiles.status = 'disabled').
 */
export async function getServerUser(): Promise<{
    user: { id: string; email?: string } | null
    profile: Profile | null
}> {
    try {
        const supabase = await createServerSupabaseClient()
        const {
            data: { user },
            error,
        } = await supabase.auth.getUser()

        if (error || !user) {
            return { user: null, profile: null }
        }

        const admin = createAdminClient()
        const { data: profile } = await admin
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single()

        // A disabled account is treated exactly like no session. Middleware only
        // blocks disabled users on PAGE loads; without this, someone disabled
        // while a tab was open could keep calling /api/* indefinitely. Every
        // guard (requireAdmin/Insurance/PropertyUser) and every route that
        // calls this directly goes through here, so one check covers them all.
        if ((profile as Profile | null)?.status === 'disabled') {
            return { user: null, profile: null }
        }

        return {
            user: { id: user.id, email: user.email },
            profile: profile as Profile | null,
        }
    } catch {
        return { user: null, profile: null }
    }
}
