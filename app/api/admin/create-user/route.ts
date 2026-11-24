import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { CreateUserInput } from '@/lib/types/shared'
import { syncProfileToSheets } from '@/lib/services/sheets-sync'
import { sendAgentWelcomeEmail } from '@/lib/email/sendAgentAuthEmail'
import { logAdminAction } from '@/lib/auth/auditLog'

export async function POST(request: Request) {
    // 🔒 Server-side admin guard — verifies caller is authenticated admin
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    try {
        const body: CreateUserInput = await request.json()
        const { email, name, role, app_type } = body
        const effectiveAppType = app_type ?? 'insurance'

        // Insurance: never hand a typed temp password around — generate one
        // server-side (never surfaced) and email a proper set-your-password
        // link instead. Property keeps its existing admin-typed-password flow.
        const isInsurance = effectiveAppType === 'insurance'
        const password = isInsurance ? crypto.randomBytes(24).toString('hex') : body.password

        if (!email || !name || !role || !password) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        if (role !== 'agent' && role !== 'super_admin') {
            return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
        }

        const supabaseAdmin = createAdminClient()

        // 1. Create Auth User
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true, // Confirm email immediately
            user_metadata: { name, role },
        })

        if (authError) {
            return NextResponse.json({ error: 'Auth Error: ' + authError.message }, { status: 400 })
        }

        if (!authUser.user) {
            return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
        }

        // Agents start disabled (pending payment confirmation); admins are active immediately
        const initialStatus = role === 'agent' ? 'disabled' : 'active'

        // 2. Create Profile Entry
        const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
            id: authUser.user.id,
            name,
            role,
            app_type: effectiveAppType, // default to insurance for admin-created users
            status: initialStatus,
        })

        if (profileError) {
            return NextResponse.json({ error: 'Profile Error: ' + profileError.message }, { status: 500 })
        }

        syncProfileToSheets({
            id: authUser.user.id,
            email: authUser.user.email ?? null,
            full_name: null,
            name,
            role,
            mobile: null,
            cea_registration_no: null,
            agency_name: null,
            app_type: effectiveAppType,
            status: initialStatus,
            joined_at: authUser.user.created_at ?? null,
            created_at: authUser.user.created_at ?? null,
        })

        // 3. Email a secure set-password link instead of making the admin
        // share a temp password out of band.
        if (isInsurance) {
            try {
                const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
                    type: 'recovery',
                    email,
                    options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/auth/reset-password` },
                })
                if (linkError || !linkData?.properties?.action_link) {
                    throw linkError ?? new Error('No action_link returned')
                }
                await sendAgentWelcomeEmail({
                    to: email,
                    name,
                    setPasswordUrl: linkData.properties.action_link,
                    pendingActivation: initialStatus === 'disabled',
                })
            } catch (emailError) {
                console.error('Failed to send welcome email:', emailError)
            }
        }

        await logAdminAction({
            actorId: auth.userId,
            action: 'user_created',
            targetType: 'profile',
            targetId: authUser.user.id,
            details: { email, role, app_type: effectiveAppType, initial_status: initialStatus },
        })

        return NextResponse.json({ success: true, user: authUser.user })
    } catch (error: any) {
        console.error('Create User API Error:', error)
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}
