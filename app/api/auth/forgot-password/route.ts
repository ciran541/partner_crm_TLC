import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPasswordResetEmail } from '@/lib/email/sendAgentAuthEmail'
import { rateLimitOrResponse } from '@/lib/rateLimit'

// Shared by both /property/forgot-password and /insurance/forgot-password —
// the reset-password page already looks up profile.app_type itself to
// redirect to the right login afterward, so this route doesn't need to know
// which app the requester belongs to.
export async function POST(request: Request) {
    const limited = await rateLimitOrResponse(request, 'forgot-password')
    if (limited) return limited

    const GENERIC_MESSAGE = "If that email is registered, we've sent a password reset link to it."

    try {
        const { email } = await request.json()
        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 })
        }

        const supabaseAdmin = createAdminClient()

        // Never reveal whether the email is registered — always return the
        // same generic success message, and only actually send if it exists.
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
            type: 'recovery',
            email,
            options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/auth/reset-password` },
        })

        if (!linkError && linkData?.properties?.action_link) {
            const name = (linkData.user?.user_metadata as { name?: string } | undefined)?.name ?? null
            try {
                await sendPasswordResetEmail({ to: email, name, resetUrl: linkData.properties.action_link })
            } catch (emailError) {
                console.error('Failed to send password reset email:', emailError)
            }
        }

        return NextResponse.json({ success: true, message: GENERIC_MESSAGE })
    } catch (error: any) {
        console.error('Forgot Password API Error:', error)
        // Still return the generic message — don't leak internal errors to a public endpoint.
        return NextResponse.json({ success: true, message: GENERIC_MESSAGE })
    }
}
