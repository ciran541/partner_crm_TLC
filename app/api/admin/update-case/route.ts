import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'

export async function POST(request: Request) {
    // 🔒 Server-side admin guard — verifies caller is authenticated admin
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    try {
        const { id, updates } = await request.json()

        if (!id) {
            return NextResponse.json({ error: 'Missing case ID' }, { status: 400 })
        }

        const supabaseAdmin = createAdminClient()

        const { data, error } = await supabaseAdmin
            .from('cases')
            .update(updates)
            .eq('id', id)
            .select()
            .single()

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json(data)
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
