import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { UpdateUserInput } from '@/lib/types/shared'

export async function POST(request: Request) {
    // 🔒 Server-side admin guard — verifies caller is authenticated admin
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    try {
        const body: UpdateUserInput = await request.json()
        const { id, name, role, status } = body

        if (!id) {
            return NextResponse.json({ error: 'Missing User ID' }, { status: 400 })
        }

        const supabaseAdmin = createAdminClient()

        // Build profile update payload
        const updates: Record<string, any> = {}
        if (name) updates.name = name
        if (role) updates.role = role
        if (status) updates.status = status

        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .update(updates)
            .eq('id', id)

        if (profileError) {
            return NextResponse.json({ error: profileError.message }, { status: 500 })
        }

        // Also sync name/role to Auth metadata
        if (name || role) {
            await supabaseAdmin.auth.admin.updateUserById(id, {
                user_metadata: { name, role },
            })
        }

        return NextResponse.json({ success: true })
    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}
