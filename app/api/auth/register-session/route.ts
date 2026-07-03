import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Called right after a successful login. Revokes every other active session
 * for this user at the Supabase Auth level (scope: 'others') — the previous
 * device's refresh token stops working, so its next request is authoritatively
 * rejected by supabase.auth.getUser() and middleware bounces it to login.
 */
export async function POST() {
    const supabase = await createServerSupabaseClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient()
    const { error } = await admin.auth.admin.signOut(session.access_token, 'others')

    if (error) {
        return NextResponse.json({ error: 'Failed to revoke other sessions' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
}
