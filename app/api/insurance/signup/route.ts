import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function loadValidInvite(supabaseAdmin: ReturnType<typeof createAdminClient>, token: string) {
    const { data: invite } = await supabaseAdmin
        .from('agent_invites')
        .select('*')
        .eq('token', token)
        .single()

    if (!invite) return { invite: null, reason: 'not_found' as const }
    if (invite.status !== 'pending') return { invite: null, reason: 'used_or_revoked' as const }
    if (new Date(invite.expires_at).getTime() < Date.now()) return { invite: null, reason: 'expired' as const }

    return { invite, reason: null }
}

// Public — lets the signup page check a token before rendering the form.
// Only ever returns whether it's usable plus the (non-sensitive) prefill
// values the admin already entered when generating the invite.
export async function GET(request: Request) {
    const token = new URL(request.url).searchParams.get('token')
    if (!token) {
        return NextResponse.json({ valid: false }, { status: 400 })
    }

    const supabaseAdmin = createAdminClient()
    const { invite } = await loadValidInvite(supabaseAdmin, token)

    if (!invite) {
        return NextResponse.json({ valid: false })
    }

    return NextResponse.json({
        valid: true,
        invited_name: invite.invited_name,
        invited_email: invite.invited_email,
    })
}

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { token, email, password, name, terms_accepted, privacy_accepted, terms_version, privacy_version } = body

        if (!token || !email || !password || !name) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        if (!terms_accepted || !privacy_accepted) {
            return NextResponse.json({ error: 'You must accept the Terms and Privacy Policy' }, { status: 400 })
        }

        const supabaseAdmin = createAdminClient()

        // Re-validate server-side — never trust the client-side check the
        // signup page already did before showing the form.
        const { invite } = await loadValidInvite(supabaseAdmin, token)
        if (!invite) {
            return NextResponse.json({ error: 'This invite link is invalid or has expired.' }, { status: 400 })
        }

        // 1. Create Auth User — the agent's own chosen password, no admin-set temp password.
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { name, role: 'agent' },
        })

        if (authError) {
            return NextResponse.json({ error: 'Auth Error: ' + authError.message }, { status: 400 })
        }

        if (!authUser.user) {
            return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
        }

        // 2. Create Profile Entry — active immediately. A valid invite already
        // proves payment was confirmed offline before it was ever sent, so
        // there's no "disabled pending payment" step for this flow.
        const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
            id: authUser.user.id,
            name,
            role: 'agent',
            app_type: 'insurance',
            status: 'active',
        })

        if (profileError) {
            await supabaseAdmin.auth.admin.deleteUser(authUser.user.id)
            return NextResponse.json({ error: 'Profile Error: ' + profileError.message }, { status: 500 })
        }

        // 3. Create Consent Record
        const { error: consentError } = await supabaseAdmin.from('user_consents').insert({
            user_id: authUser.user.id,
            terms_accepted,
            privacy_accepted,
            terms_version,
            privacy_version,
        })

        if (consentError) {
            console.error('Failed to create consent record:', consentError)
        }

        // 4. Burn the invite — single-use.
        const { error: inviteError } = await supabaseAdmin
            .from('agent_invites')
            .update({ status: 'used', used_at: new Date().toISOString(), used_by: authUser.user.id })
            .eq('id', invite.id)
            .eq('status', 'pending')

        if (inviteError) {
            console.error('Failed to mark invite used:', inviteError)
        }

        return NextResponse.json({ success: true, user: authUser.user })
    } catch (error: any) {
        console.error('Insurance Signup API Error:', error)
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}
