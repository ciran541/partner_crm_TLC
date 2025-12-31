import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { CreateUserInput } from '@/lib/types'

export async function POST(request: Request) {
    try {
        const body: CreateUserInput = await request.json()
        const { email, name, role, password } = body

        if (!email || !name || !role || !password) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // Initialize Admin Client
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        // 1. Create Auth User
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true, // Confirm email immediately
            user_metadata: { name, role }
        })

        if (authError) {
            return NextResponse.json({ error: 'Auth Error: ' + authError.message }, { status: 400 })
        }

        if (!authUser.user) {
            return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
        }

        // 2. Create Profile Entry
        // Ensure the ID matches the Auth ID
        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .insert({
                id: authUser.user.id,
                name,
                role
            })

        if (profileError) {
            // Rollback auth user if profile creation fails strictly? 
            // Or just return error. For now, return error.
            return NextResponse.json({ error: 'Profile Error: ' + profileError.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, user: authUser.user })

    } catch (error: any) {
        console.error('Create User API Error:', error)
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}
