import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimitOrResponse } from '@/lib/rateLimit'
import { loadValidInvite, burnInvite, invitePlanName } from '@/lib/auth/invites'

// Basic / Starter signup — invite-only, same as Premium (/api/insurance/signup).
// There is no public signup: the invite row decides the plan (subscription_tier),
// never the request body, so nobody can self-upgrade Starter → Basic.
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
// Only returns whether it's usable plus the (non-sensitive) prefill values
// the admin entered when generating the invite.
export async function GET(request: Request) {
    const token = new URL(request.url).searchParams.get('token')
    if (!token) {
        return NextResponse.json({ valid: false }, { status: 400 })
    }

    const supabaseAdmin = createAdminClient()
    const { invite } = await loadValidInvite(supabaseAdmin, token, 'property')

    if (!invite) {
        return NextResponse.json({ valid: false })
    }

    return NextResponse.json({
        valid: true,
        invited_name: invite.invited_name,
        invited_email: invite.invited_email,
        plan: invitePlanName(invite),
    })
}

export async function POST(request: Request) {
    const limited = await rateLimitOrResponse(request, 'property-signup')
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

        // Re-validate server-side — never trust the page's earlier check.
        // Scoped to 'property' so a Premium invite can't be redeemed here.
        const { invite } = await loadValidInvite(supabaseAdmin, token, 'property')
        if (!invite) {
            return NextResponse.json({ error: 'This invite link is invalid or has expired.' }, { status: 400 })
        }

        // The page locks the email field, but that's browser-side only — a
        // leaked link could otherwise be completed with another email by
        // calling this API directly.
        if (invite.invited_email && invite.invited_email.toLowerCase() !== email.toLowerCase()) {
            return NextResponse.json({ error: 'This invite is registered to a different email address.' }, { status: 400 })
        }

        // 1. Create Auth User
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true, // the invite already proves who this is
            user_metadata: { name, role: 'agent' },
        })

        if (authError) {
            return NextResponse.json({ error: 'Auth Error: ' + authError.message }, { status: 400 })
        }

        if (!authUser.user) {
            return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
        }

        // 2. Create Profile — active immediately (payment confirmed before the
        // invite was sent), plan taken from the invite.
        const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
            id: authUser.user.id,
            name,
            role: 'agent',
            app_type: 'property',
            subscription_tier: invite.subscription_tier === 'premium' ? 'premium' : 'standard',
            status: 'active',
        })

        if (profileError) {
            // Roll back the auth user so the invite can be retried cleanly.
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
    } catch (error: unknown) {
        console.error('Property Signup API Error:', error)
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 })
    }
}
