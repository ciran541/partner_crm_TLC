import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimitOrResponse } from '@/lib/rateLimit'
import { loadValidInvite, burnInvite } from '@/lib/auth/invites'

const signupSchema = z.object({
    token: z.string().min(1),
    email: z.string().trim().email(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    name: z.string().trim().min(1).max(200),
    terms_accepted: z.boolean(),
    privacy_accepted: z.boolean(),
    terms_version: z.string().optional(),
    privacy_version: z.string().optional(),
})

// Public — lets the signup page check a token before rendering the form.
// Only ever returns whether it's usable plus the (non-sensitive) prefill
// values the admin already entered when generating the invite.
export async function GET(request: Request) {
    const token = new URL(request.url).searchParams.get('token')
    if (!token) {
        return NextResponse.json({ valid: false }, { status: 400 })
    }

    const supabaseAdmin = createAdminClient()
    const { invite } = await loadValidInvite(supabaseAdmin, token, 'insurance')

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
    const limited = await rateLimitOrResponse(request, 'insurance-signup')
    if (limited) return limited

    try {
        const parsed = signupSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
        }
        const { token, email, password, name, terms_accepted, privacy_accepted, terms_version, privacy_version } = parsed.data

        if (!terms_accepted || !privacy_accepted) {
            return NextResponse.json({ error: 'You must accept the Terms and Privacy Policy' }, { status: 400 })
        }

        const supabaseAdmin = createAdminClient()

        // Re-validate server-side — never trust the client-side check the
        // signup page already did before showing the form. Scoped to
        // 'insurance' so a Basic/Starter invite can't create a Premium account.
        const { invite } = await loadValidInvite(supabaseAdmin, token, 'insurance')
        if (!invite) {
            return NextResponse.json({ error: 'This invite link is invalid or has expired.' }, { status: 400 })
        }

        // The signup page pre-fills and disables the email field when the
        // invite has one, but that's a browser-side convenience only — a
        // shared/leaked link could otherwise be completed with a different
        // email entirely by calling this API directly. Enforce the match here.
        if (invite.invited_email && invite.invited_email.toLowerCase() !== email.toLowerCase()) {
            return NextResponse.json({ error: 'This invite is registered to a different email address.' }, { status: 400 })
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
        await burnInvite(supabaseAdmin, invite.id, authUser.user.id)

        return NextResponse.json({ success: true, user: authUser.user })
    } catch (error: any) {
        console.error('Insurance Signup API Error:', error)
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}
