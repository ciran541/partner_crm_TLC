import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { UpdateUserInput } from '@/lib/types/shared'
import { syncProfileToSheets } from '@/lib/services/sheets-sync'
import { logAdminAction } from '@/lib/auth/auditLog'

// Supabase has no "ban forever" — ~100 years is the conventional stand-in.
const BAN_INDEFINITELY = '876000h'

export async function POST(request: Request) {
    // 🔒 Server-side admin guard — verifies caller is authenticated admin
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    try {
        const body: UpdateUserInput = await request.json()
        const { id, name, role, status, subscription_tier } = body

        if (!id) {
            return NextResponse.json({ error: 'Missing User ID' }, { status: 400 })
        }

        if (role && role !== 'agent' && role !== 'super_admin') {
            return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
        }
        if (status && status !== 'active' && status !== 'disabled') {
            return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
        }
        // An admin can't lock themselves out.
        if (id === auth.userId && (role === 'agent' || status === 'disabled')) {
            return NextResponse.json({ error: 'You can’t disable yourself or remove your own admin access. Ask another admin.' }, { status: 400 })
        }

        const supabaseAdmin = createAdminClient()

        // Build profile update payload
        const updates: Record<string, any> = {}
        if (name) updates.name = name
        if (role) updates.role = role
        if (status) updates.status = status
        if (subscription_tier) updates.subscription_tier = subscription_tier

        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .update(updates)
            .eq('id', id)

        if (profileError) {
            return NextResponse.json({ error: profileError.message }, { status: 500 })
        }

        // Keep Supabase Auth in step with profiles.status. getServerUser()
        // already rejects disabled users on our API routes, but the browser can
        // also query Supabase directly with its own token — only a ban stops
        // that, because a banned user's refresh token is refused, so their
        // session dies at the next refresh (≤ the JWT expiry, 1h by default).
        // Re-activating lifts the ban; 'none' is harmless on a never-banned user.
        //
        // Deliberately NOT done at account creation (create-user starts agents
        // 'disabled' pending payment): a banned user can't complete the
        // set-password email link, which would break that onboarding flow.
        if (status) {
            const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(id, {
                ban_duration: status === 'disabled' ? BAN_INDEFINITELY : 'none',
            })
            if (banError) {
                return NextResponse.json(
                    { error: `Status saved, but updating the login ban failed: ${banError.message}. Please retry.` },
                    { status: 500 }
                )
            }
        }

        // Also sync name/role to Auth metadata
        if (name || role) {
            await supabaseAdmin.auth.admin.updateUserById(id, {
                user_metadata: { name, role },
            })
        }

        const [{ data: profile }, { data: authUser }] = await Promise.all([
            supabaseAdmin.from('profiles')
                .select('id, name, role, full_name, mobile, cea_registration_no, agency_name, app_type, status, subscription_tier, joined_at, created_at')
                .eq('id', id)
                .single(),
            supabaseAdmin.auth.admin.getUserById(id),
        ])

        if (profile) {
            syncProfileToSheets({
                id: profile.id,
                email: authUser.user?.email ?? null,
                full_name: profile.full_name ?? null,
                name: profile.name ?? null,
                role: profile.role,
                mobile: profile.mobile ?? null,
                cea_registration_no: profile.cea_registration_no ?? null,
                agency_name: profile.agency_name ?? null,
                app_type: profile.app_type,
                status: profile.status,
                subscription_tier: profile.subscription_tier,
                joined_at: profile.joined_at ?? null,
                created_at: profile.created_at ?? null,
            })
        }

        await logAdminAction({
            actorId: auth.userId,
            action: 'user_updated',
            targetType: 'profile',
            targetId: id,
            details: updates,
        })

        return NextResponse.json({ success: true })
    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}
