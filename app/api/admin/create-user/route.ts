import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { CreateUserInput } from '@/lib/types/shared'

export async function POST(request: Request) {
    // 🔒 Server-side admin guard — verifies caller is authenticated admin
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    try {
        const body: CreateUserInput = await request.json()
        const { email, name, role, password, app_type } = body

        if (!email || !name || !role || !password) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
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

        // 2. Create Profile Entry
        const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
            id: authUser.user.id,
            name,
            role,
            app_type: app_type ?? 'insurance', // default to insurance for admin-created users
            status: 'active',
        })

        if (profileError) {
            return NextResponse.json({ error: 'Profile Error: ' + profileError.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, user: authUser.user })
    } catch (error: any) {
        console.error('Create User API Error:', error)
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}
