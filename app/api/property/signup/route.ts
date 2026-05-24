import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PropertySignupInput } from '@/lib/types/property'

export async function POST(request: Request) {
    try {
        const body: PropertySignupInput = await request.json()
        const { email, password, name, terms_accepted, privacy_accepted, terms_version, privacy_version } = body

        if (!email || !password || !name) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        if (!terms_accepted || !privacy_accepted) {
            return NextResponse.json({ error: 'You must accept the Terms and Privacy Policy' }, { status: 400 })
        }

        const supabaseAdmin = createAdminClient()

        // 1. Create Auth User
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true, // Instant access for property agents
            user_metadata: { name, role: 'agent' },
        })

        if (authError) {
            return NextResponse.json({ error: 'Auth Error: ' + authError.message }, { status: 400 })
        }

        if (!authUser.user) {
            return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
        }

        // 2. Create Profile Entry (Property Agent)
        const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
            id: authUser.user.id,
            name,
            role: 'agent',
            app_type: 'property', // Crucial: assigns them to the property domain
            status: 'active',
        })

        if (profileError) {
            // Rollback auth user creation if profile fails
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
            // We don't rollback for this, but log it
        }

        return NextResponse.json({ success: true, user: authUser.user })
    } catch (error: any) {
        console.error('Property Signup API Error:', error)
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}
