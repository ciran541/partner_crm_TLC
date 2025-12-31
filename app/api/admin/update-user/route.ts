import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { UpdateUserInput } from '@/lib/types'

export async function POST(request: Request) {
    try {
        const body: UpdateUserInput = await request.json()
        const { id, name, role } = body

        if (!id) {
            return NextResponse.json({ error: 'Missing User ID' }, { status: 400 })
        }

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        // Update Profile
        const updates: any = {}
        if (name) updates.name = name
        if (role) updates.role = role

        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .update(updates)
            .eq('id', id)

        if (profileError) {
            return NextResponse.json({ error: profileError.message }, { status: 500 })
        }

        // Also update Auth Metadata if role/name changed (optional but good practice)
        if (name || role) {
            await supabaseAdmin.auth.admin.updateUserById(id, {
                user_metadata: { name, role }
            })
        }

        return NextResponse.json({ success: true })

    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}
